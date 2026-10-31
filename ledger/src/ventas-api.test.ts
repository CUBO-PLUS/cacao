import { test } from "node:test";
import assert from "node:assert/strict";
import type { AlmacenDtes, RegistroDte, ReservaDte } from "./almacen/dtes.ts";
import type { AlmacenTickets, FiltrosTickets } from "./almacen/tipos.ts";
import { importarFacturaBtcpay } from "./btcpay.ts";
import { ErrorLedger } from "./errores.ts";
import type { Factura } from "./pagos/btcpay-api.ts";
import { resumen } from "./tablero.ts";
import { informeMes } from "./mes.ts";
import type { Ticket } from "./ticket.ts";
import {
  huellaVenta,
  idTicketDeVenta,
  registrarVenta,
  resumenNegocios,
  SIN_DOCUMENTO_NEGOCIO,
  ticketDeVenta,
  validarVenta,
  type FilaVenta,
  type PuertoVentas,
} from "./ventas-api.ts";

const AHORA = new Date("2026-10-30T15:00:00.000Z");
const HASH = "a".repeat(64);
const FACTURA = "INV123ABC";
const NEGOCIO = "6f1c2a3e-1b2c-4d5e-8f90-123456789abc";

function cuerpoLightning(extra: Record<string, unknown> = {}) {
  return {
    referencia: "pedido-1",
    producto: "market",
    descripcion: "Cafe de altura",
    monto_usd_centavos: 452,
    medio: "lightning",
    pago: { sats: 4000, tasa: "100000.00", factura_id: FACTURA, hash: HASH },
    ...extra,
  };
}

function almacenMemoria(): AlmacenTickets & { tickets: Map<string, Ticket>; llamadas: string[] } {
  const tickets = new Map<string, Ticket>();
  const llamadas: string[] = [];
  return {
    tickets,
    llamadas,
    async guardar(t: Ticket) {
      llamadas.push(`guardar:${t.id}`);
      for (const otro of tickets.values()) {
        if (otro.id !== t.id && t.origen && otro.origen?.numero === t.origen.numero) {
          throw new ErrorLedger(`DUPLICADO: el origen btcpay ${t.origen.numero} ya está en el ticket ${otro.id}.`);
        }
      }
      tickets.set(t.id, t);
    },
    async porId(id: string) {
      return tickets.get(id) ?? null;
    },
    async porOrigen(plataforma: string, numero: string) {
      return [...tickets.values()].find((t) => t.origen?.plataforma === plataforma && t.origen.numero === numero) ?? null;
    },
    async porHash(hash: string) {
      return [...tickets.values()].find((t) => t.pago?.rail === "lightning" && t.pago.paymentHash === hash) ?? null;
    },
    async listar(f?: FiltrosTickets) {
      return [...tickets.values()].filter((t) => !f?.estado || t.estado === f.estado);
    },
  };
}

function dtesMemoria(): AlmacenDtes & { reservas: number } {
  const filas = new Map<string, RegistroDte>();
  let numero = 0;
  const dtes = {
    reservas: 0,
    async porTicket(ticketId: string) {
      return filas.get(ticketId) ?? null;
    },
    async reservar(r: ReservaDte) {
      dtes.reservas += 1;
      if (filas.has(r.ticketId)) return null;
      numero += 1;
      filas.set(r.ticketId, {
        codigoGeneracion: r.codigoGeneracion,
        ticketId: r.ticketId,
        tipoDte: r.tipoDte,
        numeroControl: `RESERVADO-${r.codigoGeneracion}`,
        ambiente: "00",
        estado: "reservado",
        sello: null,
        motivo: null,
        documento: {},
        creado: AHORA.toISOString(),
        correlativo: numero,
      });
      return numero;
    },
    async completar(r: RegistroDte) {
      const previo = filas.get(r.ticketId);
      if (!previo || previo.estado !== "reservado") return false;
      filas.set(r.ticketId, { ...previo, ...r, correlativo: previo.correlativo });
      return true;
    },
    async reabrir() {
      return false;
    },
  };
  return dtes;
}

// A port over in-memory tables: the sales keep the key, the reference and the invoice, as the database does.
function puertoMemoria(): PuertoVentas & { ventas: FilaVenta[]; almacen: ReturnType<typeof almacenMemoria>; dtes: ReturnType<typeof dtesMemoria> } {
  const ventas: FilaVenta[] = [];
  const almacen = almacenMemoria();
  const dtes = dtesMemoria();
  return {
    ventas,
    almacen,
    dtes,
    async reservar(clienteId, clave, huella, e) {
      const previa = ventas.find((v) => v.cliente_id === clienteId && v.referencia === e.referencia);
      if (previa) return { situacion: "existente", venta: previa };
      if (e.pago && ventas.some((v) => v.factura_id === e.pago?.facturaId)) {
        throw new ErrorLedger("DUPLICADO: ese pago ya tiene una venta registrada.");
      }
      const fila: FilaVenta = {
        id: `v-${ventas.length + 1}`,
        cliente_id: clienteId,
        referencia: e.referencia,
        producto: e.producto,
        negocio_id: e.negocioId,
        descripcion: e.descripcion,
        monto_centavos: e.montoCentavos,
        medio: e.medio,
        factura_id: e.pago?.facturaId ?? null,
        payment_hash: e.pago?.hash ?? null,
        sats: e.pago?.sats ?? null,
        tasa_usd_btc: e.pago?.tasa ?? null,
        ticket_id: null,
        estado: e.producto === "negocios" ? "registrada" : "reservada",
        creado_en: AHORA.toISOString(),
      };
      void clave;
      void huella;
      ventas.push(fila);
      return { situacion: "nueva", venta: fila };
    },
    async completar(ventaId, ticketId) {
      const fila = ventas.find((v) => v.id === ventaId);
      if (!fila) throw new ErrorLedger("NO_ENCONTRADA: No encontramos esa venta.");
      fila.ticket_id = ticketId;
      fila.estado = "registrada";
      return fila;
    },
  };
}

const OPCIONES = { ahora: AHORA };

test("validarVenta acepta una venta por lightning y rechaza un hash mal formado", () => {
  const e = validarVenta(cuerpoLightning());
  assert.equal(e.medio, "lightning");
  assert.equal(e.montoCentavos, 452);
  assert.throws(() => validarVenta(cuerpoLightning({ pago: { sats: 4000, tasa: "100000.00", factura_id: FACTURA, hash: "xyz" } })), /hash/);
});

test("validarVenta: un negocio necesita negocio_id, y solo un negocio lo lleva", () => {
  assert.throws(() => validarVenta(cuerpoLightning({ producto: "negocios" })), /negocio_id/);
  assert.equal(validarVenta(cuerpoLightning({ producto: "negocios", negocio_id: NEGOCIO })).negocioId, NEGOCIO);
  assert.throws(() => validarVenta(cuerpoLightning({ negocio_id: NEGOCIO })), /Solo una venta de negocios/);
});

test("validarVenta: en efectivo no se admite el objeto pago", () => {
  const efectivo = { referencia: "caja-1", producto: "pay", descripcion: "Pupusa", monto_usd_centavos: 150, medio: "efectivo" };
  assert.equal(validarVenta(efectivo).pago, null);
  assert.throws(() => validarVenta({ ...efectivo, pago: { sats: 1 } }), /efectivo/);
});

test("la huella no depende del orden de las claves y cambia con el cuerpo", () => {
  const a = huellaVenta(validarVenta(cuerpoLightning()));
  const b = huellaVenta(validarVenta({ ...cuerpoLightning(), monto_usd_centavos: 452 }));
  const c = huellaVenta(validarVenta(cuerpoLightning({ monto_usd_centavos: 453 })));
  assert.equal(a, b);
  assert.notEqual(a, c);
});

test("el ticket de una venta por lightning lleva el origen de la factura de BTCPay", () => {
  const e = validarVenta(cuerpoLightning());
  const t = ticketDeVenta(e, idTicketDeVenta("venta-1", AHORA), AHORA);
  assert.equal(t.estado, "pagado");
  assert.deepEqual(t.origen, { plataforma: "btcpay", producto: "market", numero: FACTURA });
  assert.equal(t.pago?.rail, "lightning");
  assert.equal(t.pago?.montoCentavos, 452);
});

test("una venta de efectivo sin factura no tiene origen", () => {
  const e = validarVenta({ referencia: "caja-2", producto: "pay", descripcion: "Café", monto_usd_centavos: 300, medio: "efectivo" });
  const t = ticketDeVenta(e, idTicketDeVenta("venta-2", AHORA), AHORA);
  assert.equal(t.origen, null);
  assert.equal(t.pago?.rail, "efectivo");
});

test("una venta normal crea su ticket una vez, lo liga y emite su documento", async () => {
  const puerto = puertoMemoria();
  const r = await registrarVenta(puerto, "cliente-1", "clave-uno-de-prueba", cuerpoLightning(), OPCIONES);
  assert.equal(r.estado, "registrada");
  assert.equal(r.situacion, "nueva");
  assert.equal(puerto.almacen.tickets.size, 1);
  const ticket = [...puerto.almacen.tickets.values()][0] as Ticket;
  assert.equal(puerto.ventas[0]?.ticket_id, ticket.id);
  assert.equal(ticket.estado, "emitido");
  assert.equal(r.documento?.estado, "aceptado");
});

test("repetir la misma petición no crea otro ticket ni otro documento", async () => {
  const puerto = puertoMemoria();
  const primera = await registrarVenta(puerto, "cliente-1", "clave-uno-de-prueba", cuerpoLightning(), OPCIONES);
  const segunda = await registrarVenta(puerto, "cliente-1", "clave-uno-de-prueba", cuerpoLightning(), OPCIONES);
  assert.equal(segunda.id, primera.id);
  assert.equal(segunda.situacion, "existente");
  assert.equal(puerto.almacen.tickets.size, 1);
  assert.equal(puerto.dtes.reservas, 1);
});

test("si el sync ya importó la factura, la venta toma ese mismo ticket", async () => {
  const puerto = puertoMemoria();
  const e = validarVenta(cuerpoLightning());
  const delSync = ticketDeVenta(e, "TK-20261030-AAAA", AHORA);
  await puerto.almacen.guardar(delSync);
  const r = await registrarVenta(puerto, "cliente-1", "clave-uno-de-prueba", cuerpoLightning(), OPCIONES);
  assert.equal(puerto.almacen.tickets.size, 1);
  assert.equal(puerto.ventas[0]?.ticket_id, "TK-20261030-AAAA");
  assert.equal(r.documento?.estado, "aceptado");
});

test("un DUPLICADO sin ticket que lo explique se rechaza y no liga la venta", async () => {
  const puerto = puertoMemoria();
  puerto.almacen.guardar = async () => {
    throw new ErrorLedger("DUPLICADO: el pago ya cubre el ticket TK-20261030-BBBB.");
  };
  await assert.rejects(registrarVenta(puerto, "cliente-1", "clave-uno-de-prueba", cuerpoLightning(), OPCIONES), /otro ticket/);
  assert.equal(puerto.ventas[0]?.ticket_id, null);
});

test("una venta de negocios no crea ticket, no reserva documento y no cambia el tablero ni el libro", async () => {
  const puerto = puertoMemoria();
  const tickets: Ticket[] = [];
  const antes = { tablero: resumen(tickets, AHORA), libro: informeMes("2026-10", [], tickets) };

  const r = await registrarVenta(
    puerto,
    "cliente-pay",
    "clave-del-negocio",
    cuerpoLightning({ producto: "negocios", negocio_id: NEGOCIO, referencia: "pay-1" }),
    OPCIONES,
  );

  assert.equal(r.documento, null);
  assert.equal(r.sinDocumento, SIN_DOCUMENTO_NEGOCIO);
  assert.equal(puerto.almacen.llamadas.length, 0, "no ticket is written");
  assert.equal(puerto.dtes.reservas, 0, "no document number is reserved");
  assert.equal(puerto.ventas.length, 1);
  assert.equal(puerto.ventas[0]?.ticket_id, null);
  assert.equal(puerto.ventas[0]?.negocio_id, NEGOCIO);

  // The group's figures read the tickets only, so they are the same with the business sale in the store.
  const despues = { tablero: resumen([...puerto.almacen.tickets.values()], AHORA), libro: informeMes("2026-10", [], [...puerto.almacen.tickets.values()]) };
  assert.deepEqual(despues, antes);
});

test("resumenNegocios suma solo las ventas de negocios del mes", () => {
  const filas = [
    { producto: "negocios", monto_centavos: 452, creado_en: "2026-10-30T15:00:00.000Z" },
    { producto: "negocios", monto_centavos: 300, creado_en: "2026-09-30T15:00:00.000Z" },
    { producto: "market", monto_centavos: 900, creado_en: "2026-10-30T15:00:00.000Z" },
  ];
  assert.deepEqual(resumenNegocios(filas, "2026-10"), { ventas: 1, centavos: 452 });
});

test("el importador salta las facturas de un negocio y no las cuenta como venta del grupo", async () => {
  const almacen = almacenMemoria();
  const factura = {
    id: "INV-NEG-1",
    storeId: "tienda",
    estado: "Settled",
    sats: 4000,
    paymentHash: HASH,
    expiraEn: AHORA,
    metadata: { producto: "negocios", orderId: "pay-1", itemDesc: "Cafe", usdCentavos: 452, cotizacionUsdBtc: 100000 },
  } as unknown as Factura;
  const r = await importarFacturaBtcpay(almacen, factura, AHORA);
  assert.ok("omitida" in r);
  assert.match(r.omitida as string, /negocio/);
  assert.equal(almacen.llamadas.length, 0);
});
