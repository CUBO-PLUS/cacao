import { test } from "node:test";
import assert from "node:assert/strict";
import type { AlmacenTickets, FiltrosTickets } from "./almacen/tipos.ts";
import type { AlmacenDtes, RegistroDte, ReservaDte } from "./almacen/dtes.ts";
import { AHORA, entradaConsumidor, entradaContribuyente, ticketPagadoEfectivo, ticketPagadoLightning } from "./ayudas-prueba.ts";
import { emitirPagados, emitirTicket, generacionParaTicket } from "./emitir.ts";
import { ErrorLedger } from "./errores.ts";
import { sincronizarBtcpay } from "./sincronizar.ts";
import type { Ticket } from "./ticket.ts";

// In-memory stand-ins. The almacen follows the rules of the Supabase one (listar filters by estado). The documents
// table follows the rules of ledger_dtes: one row per ticket, and reservar() numbers the serie only when the ticket
// has no row yet, in the same step that writes the placeholder row.

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

type DtesMemoria = AlmacenDtes & {
  filas: Map<string, RegistroDte>;
  // Numbers taken per serie: the correlative sequence the database keeps.
  tomados: Record<string, number>;
  reservas: ReservaDte[];
};

function dtesMemoria(): DtesMemoria {
  const filas = new Map<string, RegistroDte>();
  const tomados: Record<string, number> = {};
  const reservas: ReservaDte[] = [];
  return {
    filas,
    tomados,
    reservas,
    async porTicket(id: string): Promise<RegistroDte | null> {
      return filas.get(id) ?? null;
    },
    async reservar(reserva: ReservaDte): Promise<number | null> {
      // Same step for the row and the number: a ticket with a row takes nothing.
      if (filas.has(reserva.ticketId)) return null;
      reservas.push(reserva);
      tomados[reserva.serie] = (tomados[reserva.serie] ?? 0) + 1;
      const numero = tomados[reserva.serie] ?? 1;
      filas.set(reserva.ticketId, {
        codigoGeneracion: reserva.codigoGeneracion,
        ticketId: reserva.ticketId,
        tipoDte: reserva.tipoDte,
        numeroControl: `RESERVADO-${reserva.codigoGeneracion}`,
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
    async completar(registro: RegistroDte): Promise<boolean> {
      const previa = [...filas.values()].find((f) => f.codigoGeneracion === registro.codigoGeneracion);
      if (!previa || previa.estado !== "reservado") return false;
      filas.set(previa.ticketId, { ...registro, correlativo: previa.correlativo });
      return true;
    },
  };
}

type CuerpoDocumento = { identificacion: { version: number }; resumen: { pagos: { codigo: string }[] } };

test("paid tickets are emitted in order: each takes the next number, gets a simulated seal and is stored", async () => {
  const almacen = almacenMemoria();
  const dtes = dtesMemoria();
  const a = ticketPagadoLightning(entradaConsumidor());
  const b = ticketPagadoEfectivo(entradaConsumidor());
  await almacen.guardar(a.ticket);
  await almacen.guardar(b.ticket);

  const r1 = await emitirTicket(almacen, dtes, a.ticket, { ahora: AHORA });
  const r2 = await emitirTicket(almacen, dtes, b.ticket, { ahora: AHORA });
  assert.deepEqual([r1.estado, r2.estado], ["aceptado", "aceptado"]);

  const emitidoA = await almacen.porId(a.ticket.id);
  const emitidoB = await almacen.porId(b.ticket.id);
  assert.equal(emitidoA?.estado, "emitido");
  assert.equal(emitidoB?.estado, "emitido");
  assert.equal(emitidoA?.sello?.simulado, true);
  assert.match(emitidoA?.sello?.valor ?? "", /^SIMULADO-[0-9A-F]{34}$/);
  assert.ok(emitidoA?.dte?.numeroControl.endsWith("-000000000000001"), emitidoA?.dte?.numeroControl);
  assert.ok(emitidoB?.dte?.numeroControl.endsWith("-000000000000002"), emitidoB?.dte?.numeroControl);
  assert.equal(dtes.reservas[0]?.serie, dtes.reservas[1]?.serie, "both tickets share one serie");

  const filaA = dtes.filas.get(a.ticket.id);
  assert.equal(filaA?.estado, "aceptado");
  assert.equal(filaA?.sello, emitidoA?.sello?.valor);
  assert.equal(filaA?.numeroControl, emitidoA?.dte?.numeroControl);
});

test("a second call on an emitted ticket does nothing and takes no number", async () => {
  const almacen = almacenMemoria();
  const dtes = dtesMemoria();
  const { ticket } = ticketPagadoEfectivo(entradaConsumidor());
  await almacen.guardar(ticket);
  await emitirTicket(almacen, dtes, ticket, { ahora: AHORA });

  const otra = await emitirTicket(almacen, dtes, (await almacen.porId(ticket.id)) as Ticket, { ahora: AHORA });
  assert.equal(otra.estado, null);
  assert.equal(dtes.reservas.length, 1);
  assert.equal(Object.values(dtes.tomados).reduce((a, b) => a + b, 0), 1, "no number taken twice");
  assert.equal(dtes.filas.size, 1);
});

test("a ticket that already has a row takes no number, even when the ticket itself is still pagado", async () => {
  const almacen = almacenMemoria();
  const dtes = dtesMemoria();
  const { ticket } = ticketPagadoEfectivo(entradaConsumidor());
  await almacen.guardar(ticket);
  // Another run already reserved and completed the row; this run sees the ticket still pagado.
  await dtes.reservar({ ticketId: ticket.id, serie: "01-M001P001", tipoDte: "01", codigoGeneracion: "9A1B2C3D-0000-4000-8000-000000000001" });
  const antes = dtes.tomados["01-M001P001"];

  const r = await emitirTicket(almacen, dtes, ticket, { ahora: AHORA });
  assert.equal(r.estado, "aceptado");
  assert.equal(dtes.tomados["01-M001P001"], antes, "the reserved row was completed, no second number");
});

test("two concurrent runs on the same pagado ticket produce one document and take one number", async () => {
  const almacen = almacenMemoria();
  const dtes = dtesMemoria();
  const { ticket } = ticketPagadoEfectivo(entradaConsumidor());
  await almacen.guardar(ticket);

  const [primera, segunda] = await Promise.all([
    emitirTicket(almacen, dtes, ticket, { ahora: AHORA }),
    emitirTicket(almacen, dtes, ticket, { ahora: AHORA }),
  ]);
  // Exactly one run emitted; the other found the ticket already reserved and left it alone.
  const emitidas = [primera.estado, segunda.estado].filter((e) => e === "aceptado");
  assert.equal(emitidas.length, 1);
  assert.ok([primera.estado, segunda.estado].includes(null));
  assert.equal(dtes.filas.size, 1);
  assert.equal(Object.values(dtes.tomados).reduce((a, b) => a + b, 0), 1);
});

test("emitirPagados emits every pagado ticket once: the next run finds nothing left", async () => {
  const almacen = almacenMemoria();
  const dtes = dtesMemoria();
  await almacen.guardar(ticketPagadoLightning(entradaConsumidor()).ticket);
  await almacen.guardar(ticketPagadoEfectivo(entradaConsumidor()).ticket);

  const primera = await emitirPagados(almacen, dtes, { ahora: AHORA });
  assert.deepEqual(primera, { emitidos: 2, rechazados: 0, fallidos: 0 });
  const segunda = await emitirPagados(almacen, dtes, { ahora: AHORA });
  assert.deepEqual(segunda, { emitidos: 0, rechazados: 0, fallidos: 0 });
});

test("an invalid ticket is refused: the row says rechazado, keeps its number, and the ticket keeps the observations", async () => {
  const almacen = almacenMemoria();
  const dtes = dtesMemoria();
  // A business sale without receptor: the 03 builder refuses it.
  const { ticket } = ticketPagadoEfectivo(entradaContribuyente(), "TK-20261013-0003");
  const invalido: Ticket = { ...ticket, receptor: null };
  await almacen.guardar(invalido);

  const r = await emitirTicket(almacen, dtes, invalido, { ahora: AHORA });
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

  const otra = await emitirTicket(almacen, dtes, guardado as Ticket, { ahora: AHORA });
  assert.equal(otra.estado, null);
  assert.equal(dtes.reservas.length, 1);
});

test("a document stored before its ticket was saved completes the ticket without taking a new number", async () => {
  const almacen = almacenMemoria({ fallarGuardarUnaVez: true });
  const dtes = dtesMemoria();
  const { ticket } = ticketPagadoLightning(entradaConsumidor());
  almacen.tickets.set(ticket.id, ticket);

  await assert.rejects(emitirTicket(almacen, dtes, ticket, { ahora: AHORA }), /Fallo simulado/);
  assert.equal(almacen.tickets.get(ticket.id)?.estado, "pagado");
  assert.equal(dtes.filas.size, 1);

  const r = await emitirTicket(almacen, dtes, ticket, { ahora: AHORA });
  assert.deepEqual(r, { ticket: ticket.id, estado: "aceptado", reparado: true });
  assert.equal(almacen.tickets.get(ticket.id)?.estado, "emitido");
  assert.equal(dtes.reservas.length, 1, "no second number was taken");
});

test("a reserved row left by a run that stopped is completed by the next run, with the number it already holds", async () => {
  const almacen = almacenMemoria();
  const dtes = dtesMemoria();
  const { ticket } = ticketPagadoEfectivo(entradaConsumidor());
  await almacen.guardar(ticket);
  // The run stopped right after reserving: only the placeholder exists.
  await dtes.reservar({ ticketId: ticket.id, serie: "01-M001P001", tipoDte: "01", codigoGeneracion: "9A1B2C3D-0000-4000-8000-000000000002" });

  const r = await emitirTicket(almacen, dtes, ticket, { ahora: AHORA });
  assert.equal(r.estado, "aceptado");
  assert.equal(dtes.reservas.length, 1, "the number was reserved once");
  assert.ok(dtes.filas.get(ticket.id)?.numeroControl.endsWith("-000000000000001"));
  assert.equal(dtes.filas.get(ticket.id)?.estado, "aceptado");
});

test("every web ticket goes on the 2026 schemas, also when LEDGER_ESQUEMAS asks for caso", async () => {
  const anterior = process.env.LEDGER_ESQUEMAS;
  process.env.LEDGER_ESQUEMAS = "caso";
  try {
    const almacen = almacenMemoria();
    const dtes = dtesMemoria();
    const { ticket } = ticketPagadoEfectivo(entradaConsumidor());
    await almacen.guardar(ticket);
    assert.equal(generacionParaTicket(ticket), "2026");

    const r = await emitirTicket(almacen, dtes, ticket, { ahora: AHORA });
    assert.equal(r.estado, "aceptado");
    const documento = dtes.filas.get(ticket.id)?.documento as CuerpoDocumento;
    assert.equal(documento.identificacion.version, 2);
  } finally {
    if (anterior === undefined) delete process.env.LEDGER_ESQUEMAS;
    else process.env.LEDGER_ESQUEMAS = anterior;
  }
});

test("a Lightning sale goes on the 2026 schemas with forma de pago 11 (Bitcoin)", async () => {
  const almacen = almacenMemoria();
  const dtes = dtesMemoria();
  const { ticket } = ticketPagadoLightning(entradaConsumidor());
  await almacen.guardar(ticket);

  const r = await emitirTicket(almacen, dtes, ticket, { ahora: AHORA });
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
