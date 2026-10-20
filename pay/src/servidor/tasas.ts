import 'server-only';

import {
  cotizar,
  FUENTE_EUR_USD,
  TARIFAS,
  TASA_EUR_USD,
  type Cotizacion,
  type Entrega,
  type Tarifa,
} from '@/lib/cotizacion';
import { cotizacionUsdBtc } from '@/lib/precio/fuente';

import { desdeError, exito, fallo, type Resultado } from './resultado';
import { clienteServicio } from './supabase';

// Rates and fees, read from the database. The constants in cotizacion.ts are the fallback when a
// read fails, so the screens keep working; the database still checks the amounts on creation.

export type TarifaDetalle = Tarifa & { entrega: Entrega; descripcion: string };
export type TasaDeCambio = { par: string; tasa: number; fuente: string; actualizadaEn: string };

export type EntradaCotizacion = {
  monedaOrigen: 'USD' | 'EUR';
  montoOrigenCentavos: number;
  entrega: Entrega;
};

// Shown on the transfer as its source for the BTC price.
const FUENTE_BTC = 'Precio de bitcoin: Coinbase y Kraken';
// A quote is shown for five minutes. Creating a transfer quotes again, so an old quote cannot
// change what is stored.
export const VIGENCIA_MS = 5 * 60 * 1000;

const SIN_COTIZACION = 'No pudimos obtener el precio del bitcoin. Probá de nuevo en un momento.';

/** The fee rows as stored, or null when the database could not be read. For claims about fees on screen. */
export async function leerTarifas(): Promise<TarifaDetalle[] | null> {
  try {
    const { data, error } = await clienteServicio()
      .from('pay_tarifas')
      .select('entrega, fijo_centavos, porcentaje_bps, minutos_estimados, descripcion');
    if (error) throw error;
    return (data ?? []).map((f) => ({
      entrega: f.entrega,
      fijoCentavos: f.fijo_centavos,
      porcentajeBps: f.porcentaje_bps,
      minutosEstimados: f.minutos_estimados,
      descripcion: f.descripcion,
    }));
  } catch (error) {
    console.error('leer pay_tarifas:', error instanceof Error ? error.message : error);
    return null;
  }
}

/** Every delivery method with its fee and its description. Missing rows fall back to the constants. */
export async function tarifasDetalle(): Promise<TarifaDetalle[]> {
  const leidas = await leerTarifas();
  const porEntrega = new Map((leidas ?? []).map((t) => [t.entrega, t]));
  return (Object.keys(TARIFAS) as Entrega[]).map((entrega) => {
    const dato = porEntrega.get(entrega);
    if (dato) return dato;
    return { entrega, ...TARIFAS[entrega], descripcion: '' };
  });
}

/** The fee of each delivery method, keyed by method, as the quote needs it. */
export async function tarifas(): Promise<Record<Entrega, Tarifa>> {
  const detalle = await tarifasDetalle();
  const resultado = { ...TARIFAS };
  for (const t of detalle) {
    resultado[t.entrega] = { fijoCentavos: t.fijoCentavos, porcentajeBps: t.porcentajeBps, minutosEstimados: t.minutosEstimados };
  }
  return resultado;
}

/** Every stored rate, for the admin view. */
export async function tasasDeCambio(): Promise<TasaDeCambio[]> {
  const { data, error } = await clienteServicio().from('pay_tasas').select('par, tasa, fuente, actualizada_en');
  if (error) throw new Error(`No pudimos leer las tasas: ${error.message}`);
  return (data ?? []).map((t) => ({ par: t.par, tasa: Number(t.tasa), fuente: t.fuente, actualizadaEn: t.actualizada_en }));
}

/** USD per one EUR, with its source. Falls back to the demo rate when the read fails. */
export async function tasaEurUsd(): Promise<{ tasa: number; fuente: string; actualizadaEn: string }> {
  try {
    const { data, error } = await clienteServicio()
      .from('pay_tasas')
      .select('tasa, fuente, actualizada_en')
      .eq('par', 'EUR/USD')
      .maybeSingle();
    if (error) throw error;
    if (data) return { tasa: Number(data.tasa), fuente: data.fuente, actualizadaEn: data.actualizada_en };
  } catch (error) {
    console.error('leer pay_tasas:', error instanceof Error ? error.message : error);
  }
  return { tasa: TASA_EUR_USD, fuente: FUENTE_EUR_USD, actualizadaEn: new Date().toISOString() };
}

/**
 * The quote a signed-in sender sees. Fees and the EUR/USD rate come from the database; the BTC price
 * only matters for Lightning. Numbers never come from the browser. A caller that already has the BTC
 * price (to quote and to invoice with the same one) passes it in `usdBtc`.
 */
export async function cotizarEnServidor(
  entrada: EntradaCotizacion,
  opciones: { usdBtc?: number } = {},
): Promise<Resultado<Cotizacion & { validaHasta: string }>> {
  try {
    const [tarifasLeidas, eur] = await Promise.all([tarifas(), tasaEurUsd()]);

    let usdBtc: number | null = null;
    if (entrada.entrega === 'lightning') {
      if (opciones.usdBtc !== undefined) {
        usdBtc = opciones.usdBtc;
      } else {
        try {
          usdBtc = await cotizacionUsdBtc();
        } catch {
          return fallo('SIN_COTIZACION', SIN_COTIZACION);
        }
      }
    }

    const resultado = cotizar({
      monedaOrigen: entrada.monedaOrigen,
      montoOrigenCentavos: entrada.montoOrigenCentavos,
      entrega: entrada.entrega,
      tarifas: tarifasLeidas,
      eurUsd: eur.tasa,
      fuenteEurUsd: eur.fuente,
      usdBtc,
      fuenteBtc: FUENTE_BTC,
    });
    if ('error' in resultado) return fallo('DATOS_INVALIDOS', resultado.error);

    return exito({ ...resultado, validaHasta: new Date(Date.now() + VIGENCIA_MS).toISOString() });
  } catch (error) {
    return desdeError(error);
  }
}
