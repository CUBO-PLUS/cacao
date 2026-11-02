import { test } from "node:test";
import assert from "node:assert/strict";
import { almacenDtesMemoria, almacenTicketsMemoria } from "../almacen/memoria.ts";
import { AHORA, entradaConsumidor, ticketPagadoEfectivo } from "../ayudas-prueba.ts";
import { emitirTicket } from "../emitir.ts";
import { ErrorLedger } from "../errores.ts";
import { generarParClavesPrueba, verificarJwsLocal } from "../firma/firma-local.ts";
import { recepcionDePrueba } from "./recepcion.ts";
import {
  ClienteHacienda,
  configuracionHaciendaDeEntorno,
  interpretarRecepcion,
  type ConfigHacienda,
  type FetchLike,
} from "./transmitir.ts";

// The service is replaced by a fetch stand-in: no test here opens a socket.

const CLAVES = generarParClavesPrueba();

function config(sobrescribir: Partial<ConfigHacienda> = {}): ConfigHacienda {
  return {
    url: "http://servicio.de.prueba",
    nit: "06141234567890",
    clave: "clave-de-prueba",
    clavePrivadaFirma: CLAVES.privada,
    timeoutMs: 5_000,
    ...sobrescribir,
  };
}

function json(estado: number, cuerpo: unknown): Response {
  return new Response(JSON.stringify(cuerpo), { status: estado, headers: { "Content-Type": "application/json" } });
}

// A factory: a Response body can be read only once, so every test gets its own.
const loginOk = () =>
  json(200, {
    estado: "EXITOSO",
    data: { token: "token-de-prueba", expiresAt: "2030-01-01T00:00:00.000Z", user: { nit: "06141234567890", nombre: "Prueba" } },
  });

const DOCUMENTO = {
  identificacion: { ambiente: "00", tipoDte: "01", version: 2, codigoGeneracion: "0A1B2C3D-0000-4000-8000-000000000001" },
  emisor: { nit: "06141234567890" },
};

// Records every call and answers with the given responses in order.
function servicio(respuestas: Array<Response | Error>): { fetch: FetchLike; llamadas: Array<{ url: string; init: RequestInit }> } {
  const llamadas: Array<{ url: string; init: RequestInit }> = [];
  let i = 0;
  const fetchImpl: FetchLike = async (url, init) => {
    llamadas.push({ url, init: init ?? {} });
    const siguiente = respuestas[i++];
    if (siguiente === undefined) throw new Error("sin respuesta preparada");
    if (siguiente instanceof Error) throw siguiente;
    return siguiente;
  };
  return { fetch: fetchImpl, llamadas };
}

test("sin variables de entorno no hay configuración: se conserva el simulador", () => {
  assert.equal(configuracionHaciendaDeEntorno({}), null);
  assert.equal(configuracionHaciendaDeEntorno({ LEDGER_HACIENDA_URL: "http://x", LEDGER_HACIENDA_NIT: "1" }), null);
});

test("la configuración se lee del entorno y el tiempo por defecto es de 15 segundos", () => {
  const c = configuracionHaciendaDeEntorno({
    LEDGER_HACIENDA_URL: "http://127.0.0.1:3100/",
    LEDGER_HACIENDA_NIT: "06141234567890",
    LEDGER_HACIENDA_CLAVE: "clave",
    LEDGER_HACIENDA_CLAVE_FIRMA: CLAVES.privada.replace(/\n/g, "\\n"),
  });
  assert.ok(c);
  assert.equal(c.url, "http://127.0.0.1:3100");
  assert.equal(c.timeoutMs, 15_000);
  assert.ok(c.clavePrivadaFirma.includes("\n"), "los saltos de línea escapados se restauran");
});

test("un tiempo de espera que no es un entero positivo se rechaza con un mensaje en español", () => {
  assert.throws(
    () =>
      configuracionHaciendaDeEntorno({
        LEDGER_HACIENDA_URL: "http://x",
        LEDGER_HACIENDA_NIT: "1",
        LEDGER_HACIENDA_CLAVE: "c",
        LEDGER_HACIENDA_CLAVE_FIRMA: CLAVES.privada,
        LEDGER_HACIENDA_TIMEOUT_MS: "cero",
      }),
    ErrorLedger,
  );
});

test("documento aceptado: el sello es el que devolvió el servicio, sin cambios", async () => {
  const s = servicio([
    loginOk(),
    json(200, { estado: "PROCESADO", codigoGeneracion: DOCUMENTO.identificacion.codigoGeneracion, selloRecibido: "ABCDEF0123456789ABCDEF0123456789ABCDEF01", fechaHoraRecepcion: "2026-11-02T15:00:00.000Z" }),
  ]);
  const cliente = new ClienteHacienda(config(), s.fetch, () => AHORA);
  const r = await recepcionDePrueba(config(), cliente)(DOCUMENTO, AHORA);

  assert.deepEqual(r, {
    estado: "aceptado",
    sello: "ABCDEF0123456789ABCDEF0123456789ABCDEF01",
    momento: "2026-11-02T15:00:00.000Z",
    fuente: "mock-svfe",
  });
  // The request is the envelope of section 2.11, with the signed JWS as documento and the bearer token.
  const envio = s.llamadas[1]!;
  assert.equal(envio.url, "http://servicio.de.prueba/dte/recepcion");
  const cuerpo = JSON.parse(String(envio.init.body));
  assert.equal(cuerpo.tipoDte, "01");
  assert.equal(cuerpo.version, 2);
  assert.equal(cuerpo.ambiente, "00");
  assert.equal(cuerpo.codigoGeneracion, DOCUMENTO.identificacion.codigoGeneracion);
  assert.deepEqual(verificarJwsLocal(cuerpo.documento, CLAVES.publica), DOCUMENTO);
  assert.equal((envio.init.headers as Record<string, string>).Authorization, "Bearer token-de-prueba");
});

test("documento rechazado: las observaciones son las del servicio, campo por campo", async () => {
  const s = servicio([
    loginOk(),
    json(400, {
      estado: "RECHAZADO",
      codigoGeneracion: DOCUMENTO.identificacion.codigoGeneracion,
      errores: [
        { codigo: "VAL_001", campo: "/emisor/nit", descripcion: "must match pattern", detalle: {} },
        { codigo: "VAL_002", campo: "root", descripcion: "must have required property 'resumen'", detalle: {} },
      ],
    }),
  ]);
  const cliente = new ClienteHacienda(config(), s.fetch, () => AHORA);
  const r = await recepcionDePrueba(config(), cliente)(DOCUMENTO, AHORA);

  assert.equal(r.estado, "rechazado");
  assert.deepEqual(r.estado === "rechazado" ? r.observaciones : [], [
    "/emisor/nit: must match pattern",
    "root: must have required property 'resumen'",
  ]);
  assert.equal(r.estado === "rechazado" ? r.fuente : null, "mock-svfe");
});

test("fallo de autenticación: se informa en español y no se toma como contingencia", async () => {
  const s = servicio([json(401, { estado: "ERROR", codigo: "AUTH_006", mensaje: "Credenciales inválidas" })]);
  const cliente = new ClienteHacienda(config(), s.fetch, () => AHORA);
  await assert.rejects(
    () => recepcionDePrueba(config(), cliente)(DOCUMENTO, AHORA),
    (error: unknown) => error instanceof ErrorLedger && /autenticación/.test(error.message) && /Credenciales inválidas/.test(error.message),
  );
  assert.equal(s.llamadas.length, 1, "no se intenta transmitir sin token");
});

test("tiempo de espera agotado: sin-respuesta, que es la contingencia", async () => {
  const fetchLento: FetchLike = (_url, init) =>
    new Promise<Response>((_resolver, rechazar) => {
      init?.signal?.addEventListener("abort", () => rechazar(Object.assign(new Error("aborted"), { name: "AbortError" })));
    });
  const cliente = new ClienteHacienda(config({ timeoutMs: 20 }), fetchLento, () => AHORA);
  const r = await cliente.transmitir(DOCUMENTO, "jws", AHORA);
  assert.equal(r.estado, "sin-respuesta");
  assert.match(r.estado === "sin-respuesta" ? r.motivo : "", /20 ms/);
});

test("conexión caída durante la transmisión: sin-respuesta, no rechazo", async () => {
  const s = servicio([loginOk(), new TypeError("fetch failed")]);
  const cliente = new ClienteHacienda(config(), s.fetch, () => AHORA);
  const r = await cliente.transmitir(DOCUMENTO, "jws", AHORA);
  assert.equal(r.estado, "sin-respuesta");
});

test("el token se reutiliza: dos documentos entran con un solo login", async () => {
  const sello = (n: number) => json(200, { estado: "PROCESADO", selloRecibido: `SELLO${n}`.padEnd(40, "0"), fechaHoraRecepcion: AHORA.toISOString() });
  const s = servicio([loginOk(), sello(1), sello(2)]);
  const cliente = new ClienteHacienda(config(), s.fetch, () => AHORA);
  await cliente.transmitir(DOCUMENTO, "jws-1", AHORA);
  const segundo = await cliente.transmitir(DOCUMENTO, "jws-2", AHORA);
  assert.equal(segundo.estado, "aceptado");
  assert.equal(s.llamadas.filter((l) => l.url.endsWith("/auth/login")).length, 1);
});

test("registrar la clave pública envía el PEM con el token", async () => {
  const s = servicio([loginOk(), json(200, { estado: "EXITOSO", data: { nit: "06141234567890" } })]);
  const cliente = new ClienteHacienda(config(), s.fetch, () => AHORA);
  await cliente.registrarClavePublica(CLAVES.publica);
  const envio = s.llamadas[1]!;
  assert.equal(envio.url, "http://servicio.de.prueba/emisor/clave-publica");
  assert.equal(JSON.parse(String(envio.init.body)).clavePublica, CLAVES.publica);
});

test("una respuesta que no se reconoce se informa como error, no como sello", () => {
  assert.throws(() => interpretarRecepcion(500, { estado: "ERROR", mensaje: "ya fue recibido" }, AHORA), ErrorLedger);
});

test("emisión con el servicio sin respuesta: el documento queda en contingencia, no rechazado", async () => {
  const almacen = almacenTicketsMemoria();
  const dtes = almacenDtesMemoria();
  const { ticket } = ticketPagadoEfectivo(entradaConsumidor());
  const sinRespuesta = async () => ({ estado: "sin-respuesta" as const, motivo: "sin respuesta en 15000 ms", momento: AHORA.toISOString() });
  const r = await emitirTicket(almacen, dtes, ticket, { ahora: AHORA, recepcion: sinRespuesta });
  assert.equal(r.estado, "contingencia");
  const guardado = await almacen.porId(ticket.id);
  assert.equal(guardado?.estado, "pagado");
  assert.equal(guardado?.contingencia?.simulada, false);
  assert.equal(guardado?.sello, null);
});

test("emisión con el servicio de prueba: el sello del ticket viene de fuente mock-svfe", async () => {
  const almacen = almacenTicketsMemoria();
  const dtes = almacenDtesMemoria();
  const { ticket } = ticketPagadoEfectivo(entradaConsumidor());
  const s = servicio([
    loginOk(),
    json(200, { estado: "PROCESADO", selloRecibido: "FEDCBA9876543210FEDCBA9876543210FEDCBA98", fechaHoraRecepcion: AHORA.toISOString() }),
  ]);
  const cliente = new ClienteHacienda(config(), s.fetch, () => AHORA);
  const r = await emitirTicket(almacen, dtes, ticket, { ahora: AHORA, recepcion: recepcionDePrueba(config(), cliente) });
  assert.equal(r.estado, "aceptado");
  const guardado = await almacen.porId(ticket.id);
  assert.equal(guardado?.estado, "emitido");
  assert.equal(guardado?.sello?.valor, "FEDCBA9876543210FEDCBA9876543210FEDCBA98");
  assert.equal(guardado?.sello?.fuente, "mock-svfe");
});
