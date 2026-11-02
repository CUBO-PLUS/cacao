import { test } from "node:test";
import assert from "node:assert/strict";
import { almacenDtesMemoria, almacenTicketsMemoria } from "../almacen/memoria.ts";
import { AHORA, entradaConsumidor, ticketPagadoEfectivo } from "../ayudas-prueba.ts";
import { emitirTicket } from "../emitir.ts";
import { generarParClavesPrueba } from "../firma/firma-local.ts";
import { crearTicket, registrarPago, totalDeTicket, validarEntrada, type Ticket } from "../ticket.ts";
import { pagoEfectivo } from "../pagos/efectivo.ts";
import { recepcionDePrueba } from "./recepcion.ts";
import { registrarClaveDePrueba, type ConfigHacienda } from "./transmitir.ts";

// Runs against a live svfe-mock-api. Skipped unless LEDGER_HACIENDA_URL is set, so npm test works without the mock.
//
//   LEDGER_HACIENDA_URL=http://127.0.0.1:3100 node --test src/hacienda/mock.integracion.test.ts
//
// LEDGER_HACIENDA_NIT and LEDGER_HACIENDA_CLAVE default to the seeded user of the mock. Without
// LEDGER_HACIENDA_CLAVE_FIRMA a key is generated for this run and registered in the mock before sending.
//
// Known gaps of the mock, seen here and reported, not worked around in the ledger:
// - ajv checks multipleOf 0.01 with float division, so amounts such as 1.13 or 4.52 fail although they are exact cents.
//   The CCF below uses 5.00, which passes that check.
// - Its business rule BIZ_004 adds IVA on top of ventaGravada for every document. The ledger issues factura 01 with
//   the IVA inside the price (the consumer's price), so the mock refuses a correct 01 with a total mismatch.

const url = (process.env.LEDGER_HACIENDA_URL ?? "").trim().replace(/\/+$/, "");
const claves = generarParClavesPrueba();

const config: ConfigHacienda = {
  url,
  nit: process.env.LEDGER_HACIENDA_NIT ?? "06141234567890",
  clave: process.env.LEDGER_HACIENDA_CLAVE ?? "password123",
  clavePrivadaFirma: (process.env.LEDGER_HACIENDA_CLAVE_FIRMA ?? "").trim().replace(/\\n/g, "\n") || claves.privada,
  timeoutMs: 10_000,
};

const RECEPTOR_PRUEBA = {
  nit: "06140000000011",
  nrc: "123456",
  nombre: "Cliente de prueba S.A. de C.V.",
  nombreComercial: null,
  codActividad: "46900",
  descActividad: "Venta al por mayor de otros productos",
  direccion: { departamento: "06", municipio: "14", distrito: "San Salvador Centro", complemento: "Calle de prueba 1" },
  telefono: null,
  correo: null,
};

// A CCF of one line at $5.00 (IVA added on top, the CCF convention). Paid in cash.
function ccfDePrueba(id: string): Ticket {
  const entrada = validarEntrada({
    cliente: "contribuyente",
    receptor: RECEPTOR_PRUEBA,
    lineas: [{ descripcion: "Café americano", cantidad: 1, precio: "5.00" }],
  });
  const abierto = crearTicket(entrada, AHORA, id);
  return registrarPago(abierto, pagoEfectivo(totalDeTicket(abierto).totalCentavos, AHORA), AHORA);
}

test(
  "el servicio de prueba da sello a un CCF 03",
  { skip: url === "" ? "defina LEDGER_HACIENDA_URL para correr contra el mock svfe-mock-api" : false },
  async () => {
    await registrarClaveDePrueba(config);
    const recepcion = recepcionDePrueba(config);
    const almacen = almacenTicketsMemoria();
    const dtes = almacenDtesMemoria();
    const ticket = ccfDePrueba("TK-20261102-0102");

    const r = await emitirTicket(almacen, dtes, ticket, { ahora: AHORA, recepcion });
    const guardado = await almacen.porId(ticket.id);
    const fila = await dtes.porTicket(ticket.id);
    assert.equal(r.estado, "aceptado", `el CCF fue ${r.estado}: ${JSON.stringify(fila?.motivo ?? null)}`);
    assert.match(guardado?.sello?.valor ?? "", /^[0-9a-f]{40}$/, "el sello es el selloRecibido del mock (40 caracteres hexadecimales)");
    assert.equal(guardado?.sello?.fuente, "mock-svfe");
    process.stdout.write(
      `SELLO 03 CCF | ticket ${ticket.id} | codigoGeneracion ${guardado?.dte?.codigoGeneracion} | sello ${guardado?.sello?.valor} | fuente mock-svfe | ${guardado?.sello?.momento}\n`,
    );
  },
);

test(
  "el servicio de prueba responde a una factura 01 con veredicto (la factura del mock hoy la rechaza)",
  { skip: url === "" ? "defina LEDGER_HACIENDA_URL para correr contra el mock svfe-mock-api" : false },
  async () => {
    await registrarClaveDePrueba(config);
    const recepcion = recepcionDePrueba(config);
    const almacen = almacenTicketsMemoria();
    const dtes = almacenDtesMemoria();
    const { ticket } = ticketPagadoEfectivo(entradaConsumidor(), "TK-20261102-0101");

    const r = await emitirTicket(almacen, dtes, ticket, { ahora: AHORA, recepcion });
    const fila = await dtes.porTicket(ticket.id);
    assert.notEqual(r.estado, "contingencia", "el servicio contestó: no es contingencia");
    if (r.estado === "aceptado") {
      const guardado = await almacen.porId(ticket.id);
      process.stdout.write(`SELLO 01 factura | ticket ${ticket.id} | sello ${guardado?.sello?.valor} | fuente mock-svfe\n`);
    } else {
      assert.ok(fila?.motivo, "un rechazo trae observaciones");
      process.stdout.write(`RECHAZO 01 factura | ticket ${ticket.id} | observaciones del mock:\n${fila?.motivo}\n`);
    }
  },
);
