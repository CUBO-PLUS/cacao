import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';

import { type Browser, type Page, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

// Test phones 7000 0001 to 7000 0009 accept code 123456 on the local stack (supabase/config.toml).
export const PERSONAS = {
  ana: 1, // administradora
  rosa: 2, // recibe dinero
  mario: 3,
  elena: 4,
  tomas: 5,
  lucia: 6, // envía dinero
  andres: 7,
  sofia: 8,
  diego: 9,
} as const;

export type Persona = keyof typeof PERSONAS;

// browser.newContext() ignores the config's `use`, so the address and the phone settings are repeated here.
export const OPCIONES_CONTEXTO = {
  baseURL: process.env.PAY_URL ?? 'http://localhost:4324',
  viewport: { width: 375, height: 800 },
  locale: 'es-SV',
  timezoneId: 'America/El_Salvador',
} as const;

// The local stack sends at most 30 codes per hour. A saved session per person keeps a full run
// well under that. The folder is ignored by git; it only holds test-phone cookies.
const CARPETA_SESIONES = path.join(process.cwd(), '.qa', 'e2e-sesiones');

/** Opens a browser context signed in as one of the test people, reusing a saved session when it is still valid. */
export async function sesionDe(browser: Browser, persona: Persona): Promise<Page> {
  const archivo = path.join(CARPETA_SESIONES, `${persona}.json`);
  if (existsSync(archivo)) {
    const guardada = await browser.newContext({ ...OPCIONES_CONTEXTO, storageState: archivo });
    const pagina = await guardada.newPage();
    await pagina.goto('/cuenta');
    if (!/\/entrar/.test(pagina.url())) return pagina;
    await guardada.close();
  }

  const contexto = await browser.newContext(OPCIONES_CONTEXTO);
  const pagina = await contexto.newPage();
  await pagina.goto('/entrar');
  await pagina.getByLabel('Número de celular').fill(`7000000${PERSONAS[persona]}`);
  await pagina.getByRole('button', { name: 'Enviar código' }).click();
  const campoCodigo = pagina.getByLabel('Código de seis números');
  const limite = pagina.getByText(/demasiados códigos/);
  await expect(campoCodigo.or(limite)).toBeVisible({ timeout: 20_000 });
  if (await limite.isVisible()) {
    throw new Error('Se agotó el límite de SMS del stack local (30 por hora). Esperá y volvé a correr.');
  }
  await campoCodigo.fill('123456');
  await pagina.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(pagina).not.toHaveURL(/\/entrar/, { timeout: 60_000 });
  mkdirSync(CARPETA_SESIONES, { recursive: true });
  await contexto.storageState({ path: archivo });
  return pagina;
}

/**
 * Service-role client for arranging and checking data from tests. Run Playwright with
 * `node --env-file=.env.local node_modules/@playwright/test/cli.js test` so the keys are present.
 */
export function servicio() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const clave = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !clave) throw new Error('Faltan las variables de .env.local. Usá --env-file=.env.local.');
  return createClient(url, clave, { auth: { persistSession: false, autoRefreshToken: false } });
}

/** User id of a test person, looked up by phone. */
export async function idDe(persona: Persona): Promise<string> {
  const { data, error } = await servicio()
    .from('usuarios')
    .select('id')
    .eq('telefono', `5037000000${PERSONAS[persona]}`)
    .single();
  if (error || !data) throw new Error(`No encontré a ${persona}: ${error?.message}`);
  return data.id as string;
}

/** True when the page is wider than the screen (sideways scroll). */
export async function seDesborda(pagina: Page): Promise<boolean> {
  return pagina.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
}

// ---- Arranging transfers through the database functions ------------------------------------

export type Entrega = 'lightning' | 'efectivo' | 'cuenta';
export type Moneda = 'USD' | 'EUR';

// The BTC price the local stack uses (PRECIO_FIJO_USD_BTC). Lightning quotes need it.
function precioBtcFijo(): number {
  const valor = Number(process.env.PRECIO_FIJO_USD_BTC);
  if (!Number.isFinite(valor) || valor <= 0) throw new Error('Falta PRECIO_FIJO_USD_BTC en .env.local.');
  return valor;
}

async function tasaEurUsd(): Promise<number> {
  const { data, error } = await servicio().from('pay_tasas').select('tasa').eq('par', 'EUR/USD').single();
  if (error || !data) throw new Error(`No pude leer la tasa EUR/USD: ${error?.message}`);
  return Number(data.tasa);
}

/**
 * The amounts the database expects for one transfer, worked out the way the server does: the fee
 * from pay_tarifas, the rate, and the received amount rounded down. The database checks them again,
 * so a mistake here fails the arrangement instead of creating a wrong transfer.
 */
export async function cotizarDb(monedaOrigen: Moneda, montoCentavos: number, entrega: Entrega) {
  const { data, error } = await servicio().from('pay_tarifas').select('*').eq('entrega', entrega).single();
  if (error || !data) throw new Error(`No pude leer la tarifa de ${entrega}: ${error?.message}`);
  const comision = data.fijo_centavos + Math.ceil((montoCentavos * data.porcentaje_bps) / 10_000);
  const neto = montoCentavos - comision;
  const eurUsd = await tasaEurUsd();

  if (entrega === 'lightning') {
    // Sats per one whole origin unit, with the rate kept to eight decimals as the database does.
    const satsPorUsd = 100_000_000 / precioBtcFijo();
    const tasa = monedaOrigen === 'USD' ? satsPorUsd : eurUsd * satsPorUsd;
    const tasa8 = BigInt(Math.round(tasa * 100_000_000));
    const montoDestino = Number((BigInt(neto) * tasa8) / (BigInt(100) * BigInt(100_000_000)));
    return {
      comision,
      neto,
      tasa: Number(tasa8) / 100_000_000,
      tasaFuente: 'Precio de bitcoin fijo',
      monedaDestino: 'SATS' as const,
      montoDestino,
    };
  }

  const tasa = monedaOrigen === 'EUR' ? eurUsd : 1;
  const tasa8 = BigInt(Math.round(tasa * 100_000_000));
  const montoDestino = Number((BigInt(neto) * tasa8) / BigInt(100_000_000));
  return {
    comision,
    neto,
    tasa,
    tasaFuente: monedaOrigen === 'EUR' ? 'Tasa fija de demostración' : 'Misma moneda: no hay conversión',
    monedaDestino: 'USD' as const,
    montoDestino,
  };
}

/**
 * One transfer, created through pay_crear_transferencia with the service role. `remitente` is a
 * test person; `contacto` is typed the way a person types it.
 */
export async function crearEnvioDb(input: {
  remitente: Persona;
  nombre?: string;
  contacto?: string;
  monedaOrigen?: Moneda;
  montoCentavos?: number;
  entrega?: Entrega;
  nota?: string;
}): Promise<{ id: string; codigo: string }> {
  const monedaOrigen = input.monedaOrigen ?? 'USD';
  const entrega = input.entrega ?? 'efectivo';
  const montoCentavos = input.montoCentavos ?? 10_000;
  const c = await cotizarDb(monedaOrigen, montoCentavos, entrega);
  const { data, error } = await servicio().rpc('pay_crear_transferencia', {
    p_remitente: await idDe(input.remitente),
    p_destinatario_nombre: input.nombre ?? 'Mamá Marta',
    p_destinatario_contacto: input.contacto ?? '+503 7612 3456',
    p_moneda_origen: monedaOrigen,
    p_monto_origen: montoCentavos,
    p_moneda_destino: c.monedaDestino,
    p_entrega: entrega,
    p_tasa: c.tasa,
    p_tasa_fuente: c.tasaFuente,
    p_comision: c.comision,
    p_monto_destino: c.montoDestino,
    p_nota: input.nota ?? '',
    p_clave: `e2e-${Math.random().toString(36).slice(2)}${Date.now()}`,
  });
  if (error || !data) throw new Error(`No pude crear el envío de prueba: ${error?.message}`);
  return { id: data.id as string, codigo: data.codigo as string };
}

/** The row of a transfer as the database has it. */
export async function filaEnvioDb(id: string) {
  const { data, error } = await servicio().from('pay_transferencias').select('*').eq('id', id).single();
  if (error || !data) throw new Error(`No pude leer el envío ${id}: ${error?.message}`);
  return data;
}

/** Marks a transfer as paid, the way the settled sender payment does. */
export async function pagarDb(id: string): Promise<void> {
  const { error } = await servicio()
    .from('pay_transferencias')
    .update({ pagada_en: new Date().toISOString() })
    .eq('id', id);
  if (error) throw new Error(`No pude marcar como pagado el envío: ${error.message}`);
}

/** Moves a transfer through the database function as the administrator. */
export async function avanzarDb(
  id: string,
  paso: 'procesar' | 'completar' | 'fallar',
  motivo = 'Motivo de prueba',
): Promise<void> {
  const admin = await idDe('ana');
  const llamada =
    paso === 'procesar'
      ? servicio().rpc('pay_procesar', { p_transferencia: id, p_actor: admin })
      : paso === 'completar'
        ? servicio().rpc('pay_completar', { p_transferencia: id, p_actor: admin })
        : servicio().rpc('pay_fallar', { p_transferencia: id, p_actor: admin, p_motivo: motivo });
  const { error } = await llamada;
  if (error) throw new Error(`No pude ${paso} el envío: ${error.message}`);
}
