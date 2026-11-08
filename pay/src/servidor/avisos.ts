import 'server-only';

import { createHash, timingSafeEqual } from 'node:crypto';
import { promises as dns } from 'node:dns';
import { request as pedirHttp } from 'node:http';
import { request as pedirHttps } from 'node:https';

import { after } from 'next/server';

import { esIpPrivada, firmarAviso, validarUrlAviso } from '@/lib/api-cobros';

import { configLedger, enviarVentaLedger } from './ledger';
import { exito, fallo, type Resultado } from './resultado';
import { clienteServicio } from './supabase';

// The notices to clients (avisos). pay_avisos is the queue, and the database decides every state: a state change writes
// its notice in the same transaction. This file sends the due notices and records each outcome (pay_cerrar_aviso). A
// failed notice never touches a charge. Delivery is at least once: every attempt carries the same Cacao-Aviso-Id.

/** Seconds a sender keeps its claim. A sender that dies loses the notice after this, and another one takes it. */
const DURACION_RECLAMO_SEG = 120;
/** Notices taken after a response (small, so the response is not slowed) and by the scheduled route. */
const LOTE_DRENAJE = 3;
export const LOTE_PROGRAMADO = 20;
/** Time allowed for one POST to a client. */
const TIEMPO_MAXIMO_MS = 5000;

const MSG_RED_INTERNA = 'La dirección del aviso apunta a una red privada o interna.';
const NULO_UUID = null as unknown as string;
const NULO_TEXTO = null as unknown as string;

export type Direccion = { address: string; family: number };
/** Looks up every address of a host name. The server uses DNS; tests replace it. */
export type Resolutor = (host: string) => Promise<Direccion[]>;
export type OpcionesEnvio = { desarrollo: boolean; resolutor?: Resolutor; tiempoMs?: number };
/** destino: 'cliente' (the charge's address) or 'ledger' (a paid business charge, reported to CacaoLedger). */
export type AvisoReclamado = {
  aviso_id: string;
  cobro_id: string;
  estado_cobro: string;
  token: string;
  intentos: number;
  destino: string;
};
export type Resumen = { reclamados: number; entregados: number; pendientes: number; muertos: number };
type Desenlace = 'entregado' | 'pendiente' | 'muerto' | 'reclamo_ajeno' | 'ninguno';

const resolutorDns: Resolutor = (host) => dns.lookup(host, { all: true, verbatim: true });

/** Development (and tests) may use http and localhost. Production never does. */
export function esDesarrollo(): boolean {
  return process.env.NODE_ENV !== 'production';
}

function hostDeUrl(url: URL): string {
  return url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
}

function esLocalDeDesarrollo(host: string, desarrollo: boolean): boolean {
  return desarrollo && (host === 'localhost' || host === '127.0.0.1' || host === '::1');
}

function mensajeDe(error: unknown): string {
  return (error instanceof Error ? error.message : 'Error desconocido.').slice(0, 200);
}

/** True for every address that is not public. esIpPrivada covers the list of the rules; these are the rest. */
export function esDireccionNoPublica(ip: string): boolean {
  if (esIpPrivada(ip)) return true;
  const h = ip.toLowerCase().replace(/^\[|\]$/g, '');
  // Every IPv4-mapped address is refused, public or not, and so is every "::" form (loopback, unspecified, compatible).
  if (h.startsWith('::')) return true;
  // IPv6 site-local (fec0::/10), discard (100::/64), Teredo (2001:0::/32), documentation (2001:db8::/32).
  if (/^fe[c-f]/.test(h) || h.startsWith('100:') || h.startsWith('2001:0:') || h.startsWith('2001:db8:')) return true;
  // IPv4 documentation ranges.
  return /^192\.0\.2\.|^198\.51\.100\.|^203\.0\.113\./.test(h);
}

/**
 * Checks an address before it is saved with a charge: the text rules first (validarUrlAviso), then every address the
 * host resolves to must be public. The local address of development is accepted without a lookup.
 */
export async function comprobarAvisoGuardable(valor: string, opciones: OpcionesEnvio): Promise<Resultado<string>> {
  const texto = validarUrlAviso(valor, { desarrollo: opciones.desarrollo });
  if (!texto.ok) return texto;
  const host = hostDeUrl(new URL(texto.dato));
  if (esLocalDeDesarrollo(host, opciones.desarrollo)) return texto;

  let direcciones: Direccion[];
  try {
    direcciones = await (opciones.resolutor ?? resolutorDns)(host);
  } catch {
    return fallo('DATOS_INVALIDOS', 'No pudimos resolver la dirección del aviso.');
  }
  if (direcciones.length === 0 || direcciones.some((d) => esDireccionNoPublica(d.address))) {
    return fallo('DATOS_INVALIDOS', MSG_RED_INTERNA);
  }
  return exito(texto.dato);
}

/**
 * Posts one notice, signed (Cacao-Firma) and labelled (Cacao-Aviso-Id). The address is checked when each connection is
 * made: the connection asks for the host's addresses itself, and a private one is refused before any byte is sent. So
 * a host that changes its address between the save and the send is still refused. No redirect is followed: a 3xx is
 * a failed attempt. The response body is never read, and the whole attempt has a time limit. Errors carry no body and
 * no secret.
 */
export async function publicarAviso(
  url: string,
  cuerpo: string,
  secreto: string,
  avisoId: string,
  opciones: OpcionesEnvio,
): Promise<void> {
  const checada = validarUrlAviso(url, { desarrollo: opciones.desarrollo });
  if (!checada.ok) throw new Error('La dirección del aviso ya no es válida.');
  const destino = new URL(checada.dato);
  const local = esLocalDeDesarrollo(hostDeUrl(destino), opciones.desarrollo);
  const resolutor = opciones.resolutor ?? resolutorDns;

  // The lookup of every new connection. Its answer is the only address the connection may use.
  const buscar = (
    nombre: string,
    busqueda: { all?: boolean },
    devolver: (error: Error | null, direccion?: unknown, familia?: number) => void,
  ) => {
    resolutor(nombre).then(
      (direcciones) => {
        if (direcciones.length === 0 || (!local && direcciones.some((d) => esDireccionNoPublica(d.address)))) {
          devolver(new Error(MSG_RED_INTERNA));
        } else if (busqueda.all) {
          devolver(null, direcciones);
        } else {
          devolver(null, direcciones[0].address, direcciones[0].family);
        }
      },
      (error: Error) => devolver(error),
    );
  };

  const pedir = destino.protocol === 'https:' ? pedirHttps : pedirHttp;
  await new Promise<void>((entregar, rechazar) => {
    let terminado = false;
    // Assigned once the request is started, below; the finish handler needs it declared before that.
    // eslint-disable-next-line prefer-const -- set after the handler is declared, so it stays a let
    let reloj: ReturnType<typeof setTimeout> | undefined;
    const terminar = (error?: Error) => {
      if (terminado) return;
      terminado = true;
      clearTimeout(reloj);
      if (error) rechazar(error);
      else entregar();
    };

    const peticion = pedir(
      destino,
      {
        method: 'POST',
        // The connection's own lookup: see buscar above.
        lookup: buscar as never,
        headers: {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(cuerpo),
          'cacao-firma': firmarAviso(secreto, cuerpo, Date.now() / 1000),
          'cacao-aviso-id': avisoId,
        },
      },
      (respuesta) => {
        const estado = respuesta.statusCode ?? 0;
        respuesta.destroy();
        if (estado >= 300 && estado < 400) {
          return terminar(new Error(`El receptor respondió ${estado} con una redirección, que no se sigue.`));
        }
        if (estado < 200 || estado >= 300) return terminar(new Error(`El receptor respondió ${estado}.`));
        terminar();
      },
    );
    reloj = setTimeout(() => peticion.destroy(new Error('El receptor no respondió a tiempo.')), opciones.tiempoMs ?? TIEMPO_MAXIMO_MS);
    peticion.on('error', (error) => terminar(error));
    peticion.end(cuerpo);
  });
}

/** Takes due notices for one sender. A claim is a token and a lease; the database decides who gets which notice. */
async function reclamar(limite: number, avisoId: string | null): Promise<AvisoReclamado[]> {
  const { data, error } = await clienteServicio().rpc('pay_reclamar_avisos', {
    p_limite: limite,
    p_duracion_segundos: DURACION_RECLAMO_SEG,
    p_aviso: avisoId ?? NULO_UUID,
  });
  if (error) throw new Error(`No pudimos reclamar los avisos: ${error.message}`);
  return (data ?? []) as unknown as AvisoReclamado[];
}

/** Sends a client's notice: the charge's address, signed with the client's secret. */
async function enviarAvisoCliente(aviso: AvisoReclamado): Promise<void> {
  const servicio = clienteServicio();
  const { data: cobro, error: errorCobro } = await servicio
    .from('pay_cobros')
    .select('cliente_id, aviso_url')
    .eq('id', aviso.cobro_id)
    .single();
  if (errorCobro || !cobro?.aviso_url) throw new Error('El cobro no tiene una dirección de aviso.');
  const { data: cliente, error: errorCliente } = await servicio
    .from('pay_api_clientes')
    .select('aviso_secreto')
    .eq('id', cobro.cliente_id)
    .single();
  if (errorCliente || !cliente) throw new Error('No pudimos leer el cliente del aviso.');

  const cuerpo = JSON.stringify({ aviso: aviso.aviso_id, tipo: 'cobro.estado', id: aviso.cobro_id, estado: aviso.estado_cobro });
  await publicarAviso(cobro.aviso_url, cuerpo, cliente.aviso_secreto, aviso.aviso_id, { desarrollo: esDesarrollo() });
}

/** Reports a paid business charge to CacaoLedger. The sale is read here; the request is made by ledger.ts. */
async function enviarAvisoLedger(aviso: AvisoReclamado): Promise<void> {
  const config = configLedger();
  if (!config) throw new Error('Faltan LEDGER_API_URL o LEDGER_API_KEY en Pay.');
  const servicio = clienteServicio();
  const { data: cobro, error: errorCobro } = await servicio
    .from('pay_cobros')
    .select(
      'cliente_id, estado, pago_tardio_en, descripcion, usd_centavos, sats, cotizacion_usd_btc, btcpay_factura_id, hash_pago',
    )
    .eq('id', aviso.cobro_id)
    .single();
  if (errorCobro || !cobro) throw new Error('No pudimos leer el cobro del aviso a CacaoLedger.');
  // A late payment is a sale too: its charge was cancelled, but the money came in.
  const pagado = cobro.estado === 'pagado' || cobro.pago_tardio_en !== null;
  if (!pagado || !cobro.btcpay_factura_id || !cobro.hash_pago) {
    throw new Error('El cobro no está pagado por Lightning.');
  }
  const { data: negocio, error: errorNegocio } = await servicio
    .from('pay_negocios')
    .select('negocio_id')
    .eq('cliente_id', cobro.cliente_id)
    .single();
  if (errorNegocio || !negocio) throw new Error('No pudimos leer el negocio del cobro.');
  await enviarVentaLedger(config, aviso.aviso_id, {
    cobroId: aviso.cobro_id,
    negocioId: negocio.negocio_id,
    descripcion: cobro.descripcion,
    usdCentavos: cobro.usd_centavos,
    sats: cobro.sats,
    tasa: Number(cobro.cotizacion_usd_btc).toFixed(2),
    facturaId: cobro.btcpay_factura_id,
    hash: cobro.hash_pago,
  });
}

/** Sends one claimed notice and records the outcome. Never throws: a failed notice is recorded, not raised. */
async function enviarReclamado(aviso: AvisoReclamado): Promise<Desenlace> {
  const servicio = clienteServicio();
  let error: string | null = null;
  try {
    if (aviso.destino === 'ledger') await enviarAvisoLedger(aviso);
    else await enviarAvisoCliente(aviso);
  } catch (fallido) {
    error = mensajeDe(fallido);
  }

  const { data, error: errorCierre } = await servicio.rpc('pay_cerrar_aviso', {
    p_aviso: aviso.aviso_id,
    p_token: aviso.token,
    p_ok: error === null,
    p_error: error ?? NULO_TEXTO,
  });
  if (errorCierre) {
    // The claim's lease ends, and the notice is due again: nothing is lost.
    console.error('No pudimos registrar el resultado de un aviso:', errorCierre.message);
    return 'ninguno';
  }
  return data as Desenlace;
}

/** Sends the notice of a state change right after the change, in the background. The queue keeps it if this fails. */
export function programarAviso(avisoId: string): void {
  const tarea = async () => {
    for (const aviso of await reclamar(1, avisoId)) await enviarReclamado(aviso);
  };
  const seguro = () => tarea().catch((error) => console.error('Aviso de cobro:', mensajeDe(error)));
  try {
    after(seguro);
  } catch {
    void seguro();
  }
}

/** After a response, sends a few due notices. Outside a request nothing is sent: the scheduled route does that. */
export function drenarAvisosDespues(): void {
  try {
    after(() => procesarAvisos(LOTE_DRENAJE).catch((error) => console.error('Avisos pendientes:', mensajeDe(error))));
  } catch {
    // Outside a request.
  }
}

/** Takes up to `limite` due notices and sends them together. Returns counts only. */
export async function procesarAvisos(limite: number): Promise<Resumen> {
  const reclamados = await reclamar(limite, null);
  const desenlaces = await Promise.all(reclamados.map((aviso) => enviarReclamado(aviso)));
  return {
    reclamados: reclamados.length,
    entregados: desenlaces.filter((d) => d === 'entregado').length,
    pendientes: desenlaces.filter((d) => d === 'pendiente').length,
    muertos: desenlaces.filter((d) => d === 'muerto').length,
  };
}

/**
 * The bearer secret of the scheduled route, PAY_AVISOS_SECRET. Both sides are hashed first, so the comparison takes the
 * same time whatever the header is. An unset secret refuses every request.
 */
export function autorizaProcesado(cabecera: string | null): boolean {
  const secreto = (process.env.PAY_AVISOS_SECRET ?? '').trim();
  if (!secreto || !cabecera) return false;
  const recibido = createHash('sha256').update(cabecera, 'utf8').digest();
  const esperado = createHash('sha256').update(`Bearer ${secreto}`, 'utf8').digest();
  return timingSafeEqual(recibido, esperado);
}
