import { test } from "node:test";
import assert from "node:assert/strict";
import type { AlmacenTickets, FiltrosTickets } from "./almacen/tipos.ts";
import type { AlmacenDtes, RegistroDte } from "./almacen/dtes.ts";
import { AHORA, entradaConsumidor, entradaContribuyente, ticketPagadoEfectivo, ticketPagadoLightning } from "./ayudas-prueba.ts";
import type { FuenteCorrelativosSupabase } from "./correlativos-supabase.ts";
import { emitirPagados, emitirTicket } from "./emitir.ts";
import { ErrorLedger } from "./errores.ts";
import { sincronizarBtcpay } from "./sincronizar.ts";
import type { Ticket } from "./ticket.ts";

// In-memory stand-ins. The almacen and the document table follow the rules of the Supabase ones: one document per
// ticket (the second insert is refused, as the unique index does), and listar filters by estado.

function almacenMemoria(opciones: { fallarGuardarUnaVez?: boolean } = {}): AlmacenTickets & { tickets: Map<string, Ticket> } {
  const tickets = new Map<string, Ticket>();
  let fallar = opciones.fallarGuardarUnaVez ?? false;
  return {
    tickets,
    async guardar(t: Ticket): Promise<void> {
      if (fallar) {
        fallar = false;
        throw new ErrorLedger("Fallo simulado al guardar el ticket.");
      }
      tickets.set(t.id, t);
    },
    async porId(id: string): Promise<Ticket | null> {
      return tickets.get(id) ?? null;
    },
    async porOrigen(): Promise<Ticket | null> {
      return null;
    },
    async porHash(): Promise<Ticket | null> {
      return null;
    },
    async listar(f?: FiltrosTickets): Promise<Ticket[]> {
      return [...tickets.values()].filter((t) => f?.estado === undefined || t.estado === f.estado).slice(0, f?.limite ?? 50);
    },
  };
}

function dtesMemoria(): AlmacenDtes & { filas: Map<string, RegistroDte> } {
  const filas = new Map<string, RegistroDte>();
  return {
    filas,
    async porTicket(id: string): Promise<RegistroDte | null> {
      return filas.get(id) ?? null;
    },
    async insertar(r: RegistroDte): Promise<void> {
      if (filas.has(r.ticketId)) throw new ErrorLedger(`El ticket ${r.ticketId} ya tiene un documento guardado.`);
      filas.set(r.ticketId, r);
    },
  };
}

function correlativosMemoria(): FuenteCorrelativosSupabase & { pedidos: string[] } {
  const usados: Record<string, number> = {};
  const pedidos: string[] = [];
  return {
    pedidos,
    async tomarCorrelativo(serie: string): Promise<number> {
      pedidos.push(serie);
      usados[serie] = (usados[serie] ?? 0) + 1;
      return usados[serie] ?? 1;
    },
  };
}

type CuerpoDocumento = { identificacion: { version: number }; resumen: { pagos: { codigo: string }[] } };

test("paid tickets are emitted in order: each takes the next number, gets a simulated seal and is stored", async () => {
  const almacen = almacenMemoria();
  const dtes = dtesMemoria();
  const correlativos = correlativosMemoria();
  const a = ticketPagadoLightning(entradaConsumidor());
  const b = ticketPagadoEfectivo(entradaConsumidor());
  await almacen.guardar(a.ticket);
  await almacen.guardar(b.ticket);

  const r1 = await emitirTicket(almacen, dtes, correlativos, a.ticket, { ahora: AHORA, esquemas: "2026" });
  const r2 = await emitirTicket(almacen, dtes, correlativos, b.ticket, { ahora: AHORA, esquemas: "2026" });
  assert.deepEqual([r1.estado, r2.estado], ["aceptado", "aceptado"]);

  const emitidoA = await almacen.porId(a.ticket.id);
  const emitidoB = await almacen.porId(b.ticket.id);
  assert.equal(emitidoA?.estado, "emitido");
  assert.equal(emitidoB?.estado, "emitido");
  assert.equal(emitidoA?.sello?.simulado, true);
  assert.match(emitidoA?.sello?.valor ?? "", /^SIMULADO-[0-9A-F]{34}$/);
  assert.ok(emitidoA?.dte?.numeroControl.endsWith("-000000000000001"), emitidoA?.dte?.numeroControl);
  assert.ok(emitidoB?.dte?.numeroControl.endsWith("-000000000000002"), emitidoB?.dte?.numeroControl);
  assert.equal(correlativos.pedidos[0], correlativos.pedidos[1], "both tickets share one serie");

  const filaA = dtes.filas.get(a.ticket.id);
  assert.equal(filaA?.estado, "aceptado");
  assert.equal(filaA?.sello, emitidoA?.sello?.valor);
  assert.equal(filaA?.numeroControl, emitidoA?.dte?.numeroControl);
});

test("a second call on an emitted ticket does nothing and takes no number", async () => {
  const almacen = almacenMemoria();
  const dtes = dtesMemoria();
  const correlativos = correlativosMemoria();
  const { ticket } = ticketPagadoEfectivo(entradaConsumidor());
  await almacen.guardar(ticket);
  await emitirTicket(almacen, dtes, correlativos, ticket, { ahora: AHORA, esquemas: "2026" });

  const otra = await emitirTicket(almacen, dtes, correlativos, (await almacen.porId(ticket.id)) as Ticket, { ahora: AHORA, esquemas: "2026" });
  assert.equal(otra.estado, null);
  assert.equal(correlativos.pedidos.length, 1);
  assert.equal(dtes.filas.size, 1);
});

test("emitirPagados emits every pagado ticket once: the next run finds nothing left", async () => {
  const almacen = almacenMemoria();
  const dtes = dtesMemoria();
  const correlativos = correlativosMemoria();
  await almacen.guardar(ticketPagadoLightning(entradaConsumidor()).ticket);
  await almacen.guardar(ticketPagadoEfectivo(entradaConsumidor()).ticket);

  const primera = await emitirPagados(almacen, dtes, correlativos, { ahora: AHORA, esquemas: "2026" });
  assert.deepEqual(primera, { emitidos: 2, rechazados: 0, fallidos: 0 });
  const segunda = await emitirPagados(almacen, dtes, correlativos, { ahora: AHORA, esquemas: "2026" });
  assert.deepEqual(segunda, { emitidos: 0, rechazados: 0, fallidos: 0 });
});

test("an invalid ticket is refused: the row says rechazado, keeps its number, and the ticket keeps the observations", async () => {
  const almacen = almacenMemoria();
  const dtes = dtesMemoria();
  const correlativos = correlativosMemoria();
  // A business sale without receptor: the 03 builder refuses it.
  const { ticket } = ticketPagadoEfectivo(entradaContribuyente(), "TK-20261013-0003");
  const invalido: Ticket = { ...ticket, receptor: null };
  await almacen.guardar(invalido);

  const r = await emitirTicket(almacen, dtes, correlativos, invalido, { ahora: AHORA, esquemas: "2026" });
  assert.equal(r.estado, "rechazado");

  const fila = dtes.filas.get(invalido.id);
  assert.equal(fila?.estado, "rechazado");
  assert.equal(fila?.sello, null);
  assert.match(fila?.motivo ?? "", /receptor/);
  assert.ok(fila?.numeroControl.endsWith("-000000000000001"), "the refused document kept its number");

  const guardado = await almacen.porId(invalido.id);
  assert.equal(guardado?.estado, "rechazado");
  assert.match(guardado?.rechazo?.observaciones[0] ?? "", /receptor/);
  assert.equal(guardado?.dte?.numeroControl, fila?.numeroControl);

  const otra = await emitirTicket(almacen, dtes, correlativos, guardado as Ticket, { ahora: AHORA, esquemas: "2026" });
  assert.equal(otra.estado, null);
  assert.equal(correlativos.pedidos.length, 1);
});

test("a document stored before its ticket was saved completes the ticket without taking a new number", async () => {
  const almacen = almacenMemoria({ fallarGuardarUnaVez: true });
  const dtes = dtesMemoria();
  const correlativos = correlativosMemoria();
  const { ticket } = ticketPagadoLightning(entradaConsumidor());
  almacen.tickets.set(ticket.id, ticket);

  await assert.rejects(emitirTicket(almacen, dtes, correlativos, ticket, { ahora: AHORA, esquemas: "2026" }), /Fallo simulado/);
  assert.equal(almacen.tickets.get(ticket.id)?.estado, "pagado");
  assert.equal(dtes.filas.size, 1);

  const r = await emitirTicket(almacen, dtes, correlativos, ticket, { ahora: AHORA, esquemas: "2026" });
  assert.deepEqual(r, { ticket: ticket.id, estado: "aceptado", reparado: true });
  assert.equal(almacen.tickets.get(ticket.id)?.estado, "emitido");
  assert.equal(correlativos.pedidos.length, 1, "no second number was taken");
});

test("a Lightning sale goes on the 2026 schemas by default, with forma de pago 11 (Bitcoin)", async () => {
  const almacen = almacenMemoria();
  const dtes = dtesMemoria();
  const { ticket } = ticketPagadoLightning(entradaConsumidor());
  await almacen.guardar(ticket);

  const r = await emitirTicket(almacen, dtes, correlativosMemoria(), ticket, { ahora: AHORA });
  assert.equal(r.estado, "aceptado");
  const documento = dtes.filas.get(ticket.id)?.documento as CuerpoDocumento;
  assert.equal(documento.identificacion.version, 2);
  assert.equal(documento.resumen.pagos[0]?.codigo, "11");
});

test("the sync log row carries the emission counts when the run emitted documents", async () => {
  const registros: { emitidos?: number; rechazados?: number }[] = [];
  const vacio = (async () => new Response("[]", { status: 200 })) as unknown as typeof fetch;
  const r = await sincronizarBtcpay(
    almacenMemoria(),
    { url: "https://btcpay.test", clave: "k", tiendas: ["TiendaPrueba"], fetch: vacio },
    {
      ahora: AHORA,
      registrar: async (x) => {
        registros.push(x);
      },
      emitir: async () => ({ emitidos: 3, rechazados: 1 }),
    },
  );
  assert.equal(r.emitidos, 3);
  assert.equal(r.rechazados, 1);
  assert.equal(registros[0]?.emitidos, 3);
  assert.equal(registros[0]?.rechazados, 1);
});
