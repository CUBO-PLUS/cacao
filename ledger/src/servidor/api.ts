import { createHash, timingSafeEqual } from "node:crypto";
import { createAlmacenDtesSupabase, type AlmacenDtes } from "../almacen/dtes.ts";
import { createAlmacenSupabase } from "../almacen/supabase.ts";
import type { AlmacenTickets } from "../almacen/tipos.ts";
import type { InformeMes } from "../mes.ts";
import { fechaHoraSalvador } from "../tiempo.ts";
import { supabaseDeEntorno, type ConfigSupabaseWeb } from "./configuracion.ts";
import { informeDelMes } from "./informe.ts";
import { registrarVenta, resumenNegocios, type FilaVenta, type PuertoVentas, type ResultadoVenta } from "../ventas-api.ts";
import { opcionesDeEmision } from "./simulacion.ts";

// The API v1 on the server: the clients and their keys, the rate limit, and the sales. Every call goes to Supabase
// through PostgREST with the service role key. The browser never sees it, and the key of a client never leaves here
// except once, when scripts/cliente-api.mjs makes it.

export const CUOTA_POR_MINUTO = 120;
const FORMATO_CLAVE = /^cl_[A-Za-z0-9_-]{32}$/;

export type ClienteApi = { id: string; nombre: string; grupo: boolean };

// A failure the route answers with a code. The codes are the ones the API documents.
export class ErrorApi extends Error {
  readonly codigo: string;
  constructor(codigo: string, mensaje: string) {
    super(mensaje);
    this.name = "ErrorApi";
    this.codigo = codigo;
  }
}

const CODIGOS_BD = /^(NO_AUTORIZADO|DATOS_INVALIDOS|NO_ENCONTRADA|IDEMPOTENCIA_CONFLICTO|IDEMPOTENCIA_EN_CURSO|DUPLICADO|ESTADO_INVALIDO|NO_PERMITIDO): (.*)$/s;

function configurada(): ConfigSupabaseWeb {
  const config = supabaseDeEntorno();
  if (config === null) throw new ErrorApi("NO_DISPONIBLE", "Falta la configuración de la base de datos en el servidor.");
  return config;
}

// Calls a database function through PostgREST. A message with a code (see the migration) becomes an ErrorApi.
async function rpc<T>(nombre: string, cuerpo: Record<string, unknown>, config = configurada()): Promise<T> {
  let r: Response;
  try {
    r = await fetch(`${config.url}/rest/v1/rpc/${nombre}`, {
      method: "POST",
      headers: {
        apikey: config.clave,
        authorization: `Bearer ${config.clave}`,
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify(cuerpo),
      cache: "no-store",
    });
  } catch {
    throw new ErrorApi("NO_DISPONIBLE", "No se pudo conectar con la base de datos.");
  }
  if (!r.ok) {
    let mensaje = "";
    try {
      mensaje = String(((await r.json()) as { message?: unknown }).message ?? "");
    } catch {
      mensaje = "";
    }
    const m = CODIGOS_BD.exec(mensaje);
    if (m) throw new ErrorApi(m[1] as string, m[2] as string);
    throw new ErrorApi("NO_DISPONIBLE", `La base de datos no respondió bien (HTTP ${r.status}).`);
  }
  return (await r.json()) as T;
}

// Reads rows of a table through PostgREST.
async function leer<T>(ruta: string, config = configurada()): Promise<T[]> {
  let r: Response;
  try {
    r = await fetch(`${config.url}/rest/v1/${ruta}`, {
      headers: { apikey: config.clave, authorization: `Bearer ${config.clave}`, accept: "application/json" },
      cache: "no-store",
    });
  } catch {
    throw new ErrorApi("NO_DISPONIBLE", "No se pudo conectar con la base de datos.");
  }
  if (!r.ok) throw new ErrorApi("NO_DISPONIBLE", `La base de datos no respondió bien (HTTP ${r.status}).`);
  return (await r.json()) as T[];
}

// Who the key belongs to. The key's prefix finds the row; the whole key is compared with the stored hash in constant time.
// A revoked client is refused like an unknown one.
export async function autenticar(cabecera: string | null): Promise<ClienteApi | null> {
  if (!cabecera || !cabecera.startsWith("Bearer ")) return null;
  const clave = cabecera.slice("Bearer ".length).trim();
  if (!FORMATO_CLAVE.test(clave)) return null;
  const filas = await leer<{ id: string; nombre: string; grupo: boolean; clave_hash: string; revocado_en: string | null }>(
    `ledger_clientes_api?select=id,nombre,grupo,clave_hash,revocado_en&prefijo=eq.${clave.slice(0, 11)}&limit=1`,
  );
  const fila = filas[0];
  const hashNuevo = createHash("sha256").update(clave, "utf8").digest();
  const hashGuardado = Buffer.from(fila?.clave_hash ?? "0".repeat(64), "hex");
  const coincide = hashGuardado.length === hashNuevo.length && timingSafeEqual(hashNuevo, hashGuardado);
  if (!fila || !coincide || fila.revocado_en !== null) return null;
  return { id: fila.id, nombre: fila.nombre, grupo: fila.grupo };
}

// Counts one request under the client. False when the client is over its limit this minute.
export async function cuotaCliente(clienteId: string): Promise<boolean> {
  return rpc<boolean>("ledger_api_cuota", { p_cliente: clienteId, p_maximo: CUOTA_POR_MINUTO });
}

// The sales port over the database functions. The key of the request is the idempotency key.
export function puertoVentas(): PuertoVentas {
  const config = configurada();
  const almacen: AlmacenTickets = createAlmacenSupabase(config);
  const dtes: AlmacenDtes = createAlmacenDtesSupabase(config);
  return {
    almacen,
    dtes,
    async reservar(clienteId, clave, huella, e) {
      const r = await rpc<{ situacion: "nueva" | "existente"; venta: FilaVenta }>("ledger_reservar_venta_api", {
        p_cliente: clienteId,
        p_clave: clave,
        p_huella: huella,
        p_referencia: e.referencia,
        p_producto: e.producto,
        p_negocio: e.negocioId,
        p_descripcion: e.descripcion,
        p_monto: e.montoCentavos,
        p_medio: e.medio,
        p_factura: e.pago?.facturaId ?? null,
        p_hash: e.pago?.hash ?? null,
        p_sats: e.pago?.sats ?? null,
        p_tasa: e.pago ? Number(e.pago.tasa) : null,
      });
      return r;
    },
    async completar(ventaId, ticketId) {
      return rpc<FilaVenta>("ledger_completar_venta_api", { p_id: ventaId, p_ticket: ticketId });
    },
  };
}

export function claveDeCabecera(valor: string | null): string {
  const clave = (valor ?? "").trim();
  if (clave.length < 8 || clave.length > 128) {
    throw new ErrorApi("DATOS_INVALIDOS", "Falta el encabezado Idempotency-Key (entre 8 y 128 caracteres).");
  }
  return clave;
}

// Registers a sale for the client. The sale is the one the key names; see registrarVenta.
export async function registrarVentaApi(cliente: ClienteApi, clave: string, cuerpo: unknown): Promise<ResultadoVenta> {
  const ahora = new Date();
  return registrarVenta(puertoVentas(), cliente.id, clave, cuerpo, await opcionesDeEmision(ahora));
}

// The sale of this client, or null. Only the client that made it can read it.
export async function ventaDeCliente(clienteId: string, id: string): Promise<FilaVenta | null> {
  const filas = await leer<FilaVenta>(`ledger_ventas_api?select=*&id=eq.${encodeURIComponent(id)}&cliente_id=eq.${clienteId}&limit=1`);
  return filas[0] ?? null;
}

export type FiltrosVentas = { desde?: string; hasta?: string; despues?: string; limite: number };

// The sales of this client, newest first. `despues` is the creado_en of the last row of the previous page.
export async function ventasDeCliente(clienteId: string, f: FiltrosVentas): Promise<FilaVenta[]> {
  const q = new URLSearchParams({
    select: "*",
    cliente_id: `eq.${clienteId}`,
    order: "creado_en.desc,id.desc",
    limit: String(f.limite),
  });
  if (f.desde) q.append("creado_en", `gte.${f.desde}`);
  if (f.hasta) q.append("creado_en", `lt.${f.hasta}`);
  if (f.despues) q.append("creado_en", `lt.${f.despues}`);
  return leer<FilaVenta>(`ledger_ventas_api?${q}`);
}

// The month's books, group only (see informe.ts). Business sales are not in it: they are not tickets.
export async function informeMesApi(mes: string): Promise<InformeMes> {
  return informeDelMes(createAlmacenSupabase(configurada()), mes);
}

// The business sales of a month, for the owner's tablero. Separate from the group's figures on purpose.
export async function negociosDelMes(mes: string): Promise<{ ventas: number; centavos: number }> {
  const [anio, m] = mes.split("-").map(Number) as [number, number];
  // A day of margin each side; resumenNegocios keeps only the El Salvador month.
  const desde = new Date(Date.UTC(anio, m - 1, 1) - 86_400_000).toISOString();
  const hasta = new Date(Date.UTC(anio, m, 1) + 86_400_000).toISOString();
  const filas = await leer<{ producto: string; monto_centavos: number; creado_en: string }>(
    `ledger_ventas_api?select=producto,monto_centavos,creado_en&producto=eq.negocios&creado_en=gte.${desde}&creado_en=lt.${hasta}`,
  );
  return resumenNegocios(filas, mes);
}

export type ClienteApiVista = { id: string; nombre: string; prefijo: string; grupo: boolean; creado_en: string; revocado_en: string | null };

// The API clients for the owner's /comercios page. Only the key prefix leaves here; the hash is not selected.
export async function clientesApi(): Promise<ClienteApiVista[]> {
  return leer<ClienteApiVista>("ledger_clientes_api?select=id,nombre,prefijo,grupo,creado_en,revocado_en&order=creado_en.asc");
}

export function mesActualSv(ahora: Date): string {
  return fechaHoraSalvador(ahora).fecEmi.slice(0, 7);
}
