import { test } from "node:test";
import assert from "node:assert/strict";
import { almacenAtestacionesMemoria, anexarAtestacion, verificarCadenaFilas } from "./almacen/atestaciones.ts";
import { almacenDtesMemoria, almacenTicketsMemoria } from "./almacen/memoria.ts";
import { clasificarCierre } from "./cierre.ts";
import { completarAtestaciones, emitirTicket, retransmitirContingencias } from "./emitir.ts";
import { entradaConsumidor, AHORA, leerFixture, ticketPagadoLightning } from "./ayudas-prueba.ts";
import { registrarVentaEfectivo } from "./venta-efectivo.ts";
import { HASH_INICIAL } from "./atestacion.ts";
import { validarEntrada } from "./ticket.ts";
import { ErrorLedger } from "./errores.ts";

const HORA = 3_600_000;

test("during the simulated outage a document is issued with tipoOperacion 2, waits, and is not sent again", async () => {
  const almacen = almacenTicketsMemoria();
  const dtes = almacenDtesMemoria();
  const { ticket } = ticketPagadoLightning(entradaConsumidor(), "blink-receive-lightning.json", "TK-20261013-0201");
  await almacen.guardar(ticket);
  const contingencia = { desde: AHORA };
  const r = await emitirTicket(almacen, dtes, ticket, { ahora: AHORA, contingencia });
  assert.equal(r.estado, "contingencia");
  const fila = dtes.filas.get(ticket.id);
  assert.equal(fila?.estado, "contingencia");
  assert.equal(fila?.sello, null);
  const doc = fila?.documento as { identificacion: { tipoOperacion: number; tipoContingencia: number; motivoContin: string } };
  assert.equal(doc.identificacion.tipoOperacion, 2);
  assert.equal(doc.identificacion.tipoContingencia, 1);
  assert.ok(doc.identificacion.motivoContin.includes("Simulación"));
  const tras = await almacen.porId(ticket.id);
  assert.equal(tras?.estado, "pagado");
  assert.equal(tras?.contingencia?.simulada, true);
  assert.equal(tras?.sello, null);
  // A second run finds the waiting document and takes nothing.
  const otra = await emitirTicket(almacen, dtes, tras!, { ahora: AHORA, contingencia });
  assert.equal(otra.estado, null);
  assert.equal(dtes.filas.get(ticket.id)?.estado, "contingencia");
});

test("the cierre puts a waiting document in the 24-hour fuse, from the start of the outage", async () => {
  const almacen = almacenTicketsMemoria();
  const dtes = almacenDtesMemoria();
  const { ticket } = ticketPagadoLightning(entradaConsumidor(), "blink-receive-lightning.json", "TK-20261013-0202");
  await almacen.guardar(ticket);
  const hace2h = new Date(AHORA.getTime() - 2 * HORA);
  await emitirTicket(almacen, dtes, ticket, { ahora: hace2h, contingencia: { desde: hace2h } });
  const tras = (await almacen.porId(ticket.id))!;
  const informe = clasificarCierre({ fecha: "2026-10-13", ahora: AHORA, tickets: [tras], atestaciones: [] });
  assert.equal(informe.grupos.plazo.length, 1);
  assert.equal(informe.grupos.plazo[0]?.minutosRestantes, 22 * 60);
  assert.equal(informe.grupos.plazo[0]?.vencido, false);
  assert.ok(informe.grupos.plazo[0]?.motivo.includes("contingencia simulada"));
  assert.equal(informe.todosConSello, false);
});

test("the reception of a retransmission gives a simulated seal, the ticket is emitted, and nothing is sent twice", async () => {
  const almacen = almacenTicketsMemoria();
  const dtes = almacenDtesMemoria();
  const { ticket } = ticketPagadoLightning(entradaConsumidor(), "blink-receive-lightning.json", "TK-20261013-0203");
  await almacen.guardar(ticket);
  await emitirTicket(almacen, dtes, ticket, { ahora: AHORA, contingencia: { desde: AHORA } });
  const despues = new Date(AHORA.getTime() + HORA);
  const primera = await retransmitirContingencias(almacen, dtes, { ahora: despues });
  assert.equal(primera.transmitidos, 1);
  const fila = dtes.filas.get(ticket.id);
  assert.equal(fila?.estado, "aceptado");
  assert.match(fila?.sello ?? "", /^SIMULADO-/);
  const tk = (await almacen.porId(ticket.id))!;
  assert.equal(tk.estado, "emitido");
  assert.equal(tk.sello?.simulado, true);
  assert.equal(tk.contingencia?.transmitida?.sello, fila?.sello);
  const segunda = await retransmitirContingencias(almacen, dtes, { ahora: despues });
  assert.equal(segunda.transmitidos, 0);
});

test("the rate attestations are chained in order, and a tampered record is found by its hash", async () => {
  const almacen = almacenTicketsMemoria();
  const dtes = almacenDtesMemoria();
  const atestaciones = almacenAtestacionesMemoria();
  const a = ticketPagadoLightning(entradaConsumidor(), "blink-receive-lightning.json", "TK-20261013-0301").ticket;
  const b = ticketPagadoLightning(validarEntrada(leerFixture("ticket-consumidor-pupusas.json")), "blink-receive-lightning-pupusas.json", "TK-20261013-0302").ticket;
  await almacen.guardar(a);
  await almacen.guardar(b);
  await emitirTicket(almacen, dtes, a, { ahora: AHORA, atestaciones });
  await emitirTicket(almacen, dtes, b, { ahora: AHORA, atestaciones });
  const cadena = await atestaciones.cadena();
  assert.equal(cadena.length, 2);
  assert.equal(cadena[0]?.anterior, HASH_INICIAL);
  assert.equal(cadena[1]?.anterior, cadena[0]?.hash);
  let v = verificarCadenaFilas(cadena);
  assert.equal(v.ok, true);
  assert.equal(v.cabeza, cadena[1]?.hash);

  // Changing a number of the first record breaks its hash.
  const alterada = structuredClone(cadena);
  (alterada[0]!.contenido as { usdCentavos: number }).usdCentavos += 1;
  v = verificarCadenaFilas(alterada);
  assert.equal(v.ok, false);
  assert.equal(v.primerRoto?.orden, cadena[0]?.orden);
  assert.match(v.primerRoto?.motivo ?? "", /alterado/);

  // Removing the first record breaks the link of the second.
  v = verificarCadenaFilas(cadena.slice(1));
  assert.equal(v.ok, false);
});

test("an attestation must follow the head: a stale anterior is refused, and a repeated record keeps the first", async () => {
  const atestaciones = almacenAtestacionesMemoria();
  const { ticket } = ticketPagadoLightning(entradaConsumidor(), "blink-receive-lightning.json", "TK-20261013-0401");
  const datos = {
    ticket: ticket.id,
    codigoGeneracion: "5A1C0E7B-3D4F-4A8E-9B2C-7F6E5D4C3B01",
    numeroControl: "DTE-01-M001P001-000000000000001",
    tipoDte: "01" as const,
    generacion: "2026",
    momentoPago: ticket.pago!.momento,
    sats: 1,
    usdCentavos: 1,
    tasaUsdPorBtc: "100000.00",
    tasaFuente: "prueba",
    paymentHash: "a".repeat(64),
    codigoFormaPago: "11",
    referencia: null,
    registrada: AHORA.toISOString(),
  };
  const fila = await anexarAtestacion(atestaciones, datos);
  const otra = await anexarAtestacion(atestaciones, { ...datos, sats: 2 });
  assert.equal(otra.hash, fila.hash);
  await assert.rejects(
    atestaciones.anexar({
      ticketId: "TK-20261013-0402",
      codigoGeneracion: datos.codigoGeneracion,
      anterior: HASH_INICIAL,
      hash: "b".repeat(64),
      contenido: datos,
    }),
    (e: unknown) => e instanceof ErrorLedger && e.message.startsWith("CADENA_DESALINEADA"),
  );
});

test("a cash sale is registered once per form token: a double submit makes one ticket and one document", async () => {
  const almacen = almacenTicketsMemoria();
  const dtes = almacenDtesMemoria();
  const entrada = validarEntrada({
    cliente: "consumidor",
    lineas: [{ descripcion: "Taza de cacao caliente", cantidad: 1, precioCentavos: 452 }],
  });
  const token = "formulario-prueba-0001";
  const primera = await registrarVentaEfectivo(almacen, dtes, entrada, token, { ahora: AHORA });
  assert.equal(primera.yaExistia, false);
  assert.equal(primera.ticket.estado, "emitido");
  assert.equal(primera.ticket.pago?.rail, "efectivo");
  assert.equal(primera.ticket.pago?.montoCentavos, 452);
  const segunda = await registrarVentaEfectivo(almacen, dtes, entrada, token, { ahora: AHORA });
  assert.equal(segunda.yaExistia, true);
  assert.equal(segunda.ticket.id, primera.ticket.id);
  assert.equal(almacen.tickets.size, 1);
  assert.equal(dtes.filas.size, 1);
});

test("a cash sale without a real form token is refused", async () => {
  await assert.rejects(
    registrarVentaEfectivo(almacenTicketsMemoria(), almacenDtesMemoria(), entradaConsumidor(), "corto", { ahora: AHORA }),
    (e: unknown) => e instanceof ErrorLedger,
  );
});

test("tickets emitted before the chain existed are chained once, oldest first, and the chain verifies", async () => {
  const almacen = almacenTicketsMemoria();
  const dtes = almacenDtesMemoria();
  const atestaciones = almacenAtestacionesMemoria();
  const a = ticketPagadoLightning(entradaConsumidor(), "blink-receive-lightning.json", "TK-20261013-0501").ticket;
  const b = ticketPagadoLightning(validarEntrada(leerFixture("ticket-consumidor-pupusas.json")), "blink-receive-lightning-pupusas.json", "TK-20261013-0502").ticket;
  // The second sale happened later: the chain follows the sales' creation order, not the save order.
  const bPosterior = { ...b, creado: "2026-10-13T14:00:00.000Z" };
  await almacen.guardar(bPosterior);
  await almacen.guardar(a);
  // Emitted without the chain, as the earlier web did.
  await emitirTicket(almacen, dtes, a, { ahora: AHORA });
  await emitirTicket(almacen, dtes, bPosterior, { ahora: AHORA });
  assert.equal((await atestaciones.cadena()).length, 0);
  const escritos = await completarAtestaciones(almacen, atestaciones, { ahora: AHORA });
  assert.equal(escritos, 2);
  const cadena = await atestaciones.cadena();
  assert.deepEqual(cadena.map((f) => f.ticketId), ["TK-20261013-0501", "TK-20261013-0502"]);
  assert.equal(verificarCadenaFilas(cadena).ok, true);
  // A second run writes nothing.
  assert.equal(await completarAtestaciones(almacen, atestaciones, { ahora: AHORA }), 0);
});
