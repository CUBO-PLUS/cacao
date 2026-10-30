import { createHmac } from 'node:crypto';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { cotizar, TARIFAS, TASA_EUR_USD, type Entrega } from '@/lib/cotizacion';
import type { Resultado } from '@/servidor/resultado';
import type { DatosNuevoEnvio } from '@/servidor/transferencias';
import type { Database } from '@/tipos/db';

// Helpers for the database tests, which run against the local Supabase stack. Each test creates its
// own users, so the tests pass on an empty database and on a seeded one. Users sign in with Clerk in
// production, so the tests sign their own session JWTs with the local JWT secret (JWT_SECRET) and send
// them the way the browser does. The sub claim is a Clerk id.

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
// Fixed BTC price, so a Lightning quote does not depend on the live sources.
process.env.PRECIO_FIJO_USD_BTC ??= '100000';

const sinSesion = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };

let servicioCache: SupabaseClient<Database> | undefined;

// Service-role client. Only the server may use it, and so may these tests.
export function servicio(): SupabaseClient<Database> {
  if (!servicioCache) {
    if (!url || !serviceKey) {
      throw new Error('Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY. Corré las pruebas con --env-file=.env.local.');
    }
    servicioCache = createClient<Database>(url, serviceKey, sinSesion);
  }
  return servicioCache;
}

export function sufijo(): string {
  return Math.random().toString(36).slice(2, 8);
}

// id is the uuid of the usuarios row; clerkId is the Clerk id that signs its session.
export type Usuario = { id: string; telefono: string; clerkId?: string; sesion?: SupabaseClient };

// Clerk ids of the users these tests create: one per call, so no two tests share a row.
function clerkIdNuevo(): string {
  return `user_test_${sufijo()}${sufijo()}`;
}

// Signs a session JWT the way Clerk's token reaches the database: the Clerk id goes in `sub`.
// Signed with the local JWT secret from the environment (see `npx supabase status -o env`).
export function firmarJwt(clerkId: string): string {
  const secreto = process.env.JWT_SECRET ?? '';
  if (!secreto) throw new Error('Falta JWT_SECRET. Corré las pruebas con la variable JWT_SECRET del Supabase local.');
  const codificar = (objeto: object) => Buffer.from(JSON.stringify(objeto)).toString('base64url');
  const ahora = Math.floor(Date.now() / 1000);
  const cabecera = codificar({ alg: 'HS256', typ: 'JWT' });
  const cuerpo = codificar({ sub: clerkId, role: 'authenticated', aud: 'authenticated', iat: ahora, exp: ahora + 3600 });
  const firma = createHmac('sha256', secreto).update(`${cabecera}.${cuerpo}`).digest('base64url');
  return `${cabecera}.${cuerpo}.${firma}`;
}

// A client with the anon key that sends the session JWT of one Clerk user, as the browser does.
export function clienteDe(clerkId: string): SupabaseClient {
  return createClient(url, anonKey, { ...sinSesion, accessToken: async () => firmarJwt(clerkId) });
}

// A fresh user with a random phone from the 5035 range, linked through vincular_clerk with a new clerk
// id. Its stored phone is digits only, as the database keeps it, so a contact "+5035..." matches it.
export async function usuarioNuevo(nombre = 'Usuaria de prueba'): Promise<Usuario> {
  const telefono = `5035${String(Math.floor(Math.random() * 1e7)).padStart(7, '0')}`;
  const clerkId = clerkIdNuevo();
  const { data, error } = await servicio().rpc('vincular_clerk', {
    p_clerk_id: clerkId,
    p_telefono: telefono,
    p_correo: '',
    p_nombre: nombre,
  });
  if (error) throw error;
  return { id: data as string, telefono, clerkId };
}

// The session of one user, made once per user object.
export async function sesionDe(usuario: Usuario): Promise<SupabaseClient> {
  if (!usuario.clerkId) throw new Error('El usuario de prueba no tiene identidad de Clerk.');
  if (!usuario.sesion) usuario.sesion = clienteDe(usuario.clerkId);
  return usuario.sesion;
}

let adminCache: Usuario | undefined;

// One administrator per test file.
export async function administrador(): Promise<Usuario> {
  if (!adminCache) {
    const usuario = await usuarioNuevo('Ana');
    const { error } = await servicio().from('usuarios').update({ es_admin: true }).eq('id', usuario.id);
    if (error) throw error;
    adminCache = usuario;
  }
  return adminCache;
}

// A phone that no test user has, in the form a person types it: +503 and eight digits.
export function contactoSinCuenta(): string {
  return `+5038${String(Math.floor(Math.random() * 1e7)).padStart(7, '0')}`;
}

// The amount and the rate the sender sees on screen for these values. The fees and the EUR rate are the ones
// the migrations seed (the constants of cotizacion.ts), and the BTC price is the fixed test price.
function mostradoDe(datos: DatosNuevoEnvio): { montoDestino: number; tasa: number } {
  const cotizado = cotizar({
    monedaOrigen: datos.monedaOrigen,
    montoOrigenCentavos: datos.montoOrigenCentavos,
    entrega: datos.entrega,
    tarifas: TARIFAS,
    eurUsd: TASA_EUR_USD,
    usdBtc: Number(process.env.PRECIO_FIJO_USD_BTC),
    fuenteBtc: 'Precio fijo de prueba',
  });
  return 'error' in cotizado ? { montoDestino: 0, tasa: 0 } : { montoDestino: cotizado.montoDestino, tasa: cotizado.tasa };
}

// The sender's form values for one transfer. Any field can be changed by the test; the amount and the rate
// the sender saw are filled in from the same quote the server makes, unless the test sets them.
export function datosEnvio(remitente: Usuario, cambios: Partial<DatosNuevoEnvio> = {}): DatosNuevoEnvio {
  const datos: DatosNuevoEnvio = {
    destinatarioNombre: 'Mamá Marta',
    destinatarioContacto: contactoSinCuenta(),
    monedaOrigen: 'USD',
    montoOrigenCentavos: 10_000,
    entrega: 'efectivo' as Entrega,
    nota: '',
    clave: `clave-${sufijo()}${sufijo()}`,
    montoDestino: 0,
    tasa: 0,
    ...cambios,
  };
  return { ...datos, ...mostradoDe(datos), ...cambios };
}

// The value of a successful result. Fails the test when the result is an error.
export function ok<T>(resultado: Resultado<T>): T {
  if (!resultado.ok) throw new Error(`Se esperaba éxito: ${resultado.codigo}: ${resultado.mensaje}`);
  return resultado.dato;
}

// The error code of a failed result, or null when it succeeded.
export function codigoDe(resultado: Resultado<unknown>): string | null {
  return resultado.ok ? null : resultado.codigo;
}

// The raw row of a transfer, as the database has it.
export async function filaEnvio(envioId: string) {
  const { data, error } = await servicio().from('pay_transferencias').select('*').eq('id', envioId).single();
  if (error) throw error;
  return data;
}

// The funnel events of one transfer, oldest first.
export async function eventosDeEnvio(envioId: string) {
  const { data, error } = await servicio()
    .from('eventos')
    .select('nombre, objeto, valor_usd_centavos, usuario_id')
    .eq('sesion', `envio-${envioId}`)
    .order('id');
  if (error) throw error;
  return data ?? [];
}

// Audit rows of a transfer, oldest first.
export async function auditoriaDeEnvio(envioId: string) {
  const { data, error } = await servicio()
    .from('auditoria')
    .select('accion, actor_id')
    .eq('entidad', 'transferencia')
    .eq('entidad_id', envioId)
    .order('id');
  if (error) throw error;
  return data ?? [];
}
