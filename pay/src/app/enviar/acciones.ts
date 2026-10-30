'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import type { Cotizacion, Entrega } from '@/lib/cotizacion';
import { cotizacionUsdBtc } from '@/lib/precio/fuente';
import { registrarEvento } from '@/servidor/eventos';
import { fallo, exito, type Resultado } from '@/servidor/resultado';
import { exigirSesion, sesionActual } from '@/servidor/sesion';
import { cotizarEnServidor } from '@/servidor/tasas';
import { crearEnvio } from '@/servidor/transferencias';

import { idAleatorio, NOMBRE_COOKIE_VISITA } from './visita';

// Server side of the sender's flow. The quote and the transfer are computed on the server; what the
// browser sends is only the amount and the choices.

export type CotizacionEnvio = Cotizacion & { validaHasta: string };

export type ResultadoCotizacion = { cotizacion: CotizacionEnvio; usdBtc: number | null };

/** The refusal sentence, and the new quote when the price changed (the form shows it again). */
export type EstadoCrearEnvio = { error: string | null; cotizacion?: CotizacionEnvio };

/** The quote for the amount and the way of delivery, with the BTC price when it is needed. */
export async function cotizarAccion(entrada: {
  montoCentavos: number;
  monedaOrigen: 'USD' | 'EUR';
  entrega: Entrega;
}): Promise<Resultado<ResultadoCotizacion>> {
  const sesion = await sesionActual();
  if (!sesion) return fallo('NO_PERMITIDO', 'Entrá para ver la cotización.');

  const resultado = await cotizarEnServidor({
    monedaOrigen: entrada.monedaOrigen,
    montoOrigenCentavos: entrada.montoCentavos,
    entrega: entrada.entrega,
  });
  if (!resultado.ok) return resultado;

  // The price is shown next to sats only. A failed read leaves the price out; the quote already
  // refused Lightning when the price was missing.
  let usdBtc: number | null = null;
  if (entrada.entrega === 'lightning') {
    try {
      usdBtc = await cotizacionUsdBtc();
    } catch {
      usdBtc = null;
    }
  }
  return exito({ cotizacion: resultado.dato, usdBtc });
}

// Visit steps of the funnel. The visit id comes from the cookie the browser set; without it, the
// step still counts under a new id.
async function registrarPasoDeVisita(nombre: 'vio_cotizacion' | 'inicio_envio'): Promise<void> {
  const sesion = await sesionActual();
  if (!sesion) return;
  const visita = (await cookies()).get(NOMBRE_COOKIE_VISITA)?.value;
  const sesionId = visita && visita.length >= 8 && visita.length <= 64 ? visita : idAleatorio();
  await registrarEvento({
    nombre,
    sesion: sesionId,
    usuarioId: sesion.usuario.id,
    ruta: '/enviar',
  });
}

/** Records that a quote was shown on /enviar. The client calls it once per visit. */
export async function registrarVisitaCotizacion(): Promise<void> {
  await registrarPasoDeVisita('vio_cotizacion');
}

/** Records that the person moved on to the confirmation step. */
export async function registrarInicioEnvio(): Promise<void> {
  await registrarPasoDeVisita('inicio_envio');
}

function texto(datos: FormData, campo: string): string {
  return String(datos.get(campo) ?? '');
}

/**
 * Creates the transfer as "Sin enviar" and opens its page. The server quotes the amount again and refuses
 * the creation when the amount or the rate on screen no longer match, so the numbers the browser sends are
 * checked, not trusted. The key makes a double tap one transfer.
 */
export async function crearEnvioAccion(
  _previo: EstadoCrearEnvio,
  datos: FormData,
): Promise<EstadoCrearEnvio> {
  const sesion = await exigirSesion('/enviar');
  const resultado = await crearEnvio(sesion.usuario.id, {
    destinatarioNombre: texto(datos, 'destinatarioNombre'),
    destinatarioContacto: texto(datos, 'destinatarioContacto'),
    // crearEnvio refuses anything that is not USD, EUR or a known way of delivery.
    monedaOrigen: texto(datos, 'monedaOrigen') as 'USD' | 'EUR',
    montoOrigenCentavos: Number(texto(datos, 'montoCentavos')),
    entrega: texto(datos, 'entrega') as Entrega,
    nota: texto(datos, 'nota'),
    clave: texto(datos, 'clave'),
    montoDestino: Number(texto(datos, 'montoDestino')),
    tasa: Number(texto(datos, 'tasa')),
  });
  if (!resultado.ok) return { error: resultado.mensaje, cotizacion: resultado.cotizacion };
  redirect(`/envios/${resultado.dato.id}`);
}
