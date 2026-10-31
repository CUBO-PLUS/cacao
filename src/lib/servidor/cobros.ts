// Invoices and paid-story access for Cacao Media. Server only.
// Payments are simulated: the database records what the simulator says, nothing moves money.
import { DIA, firmar } from '../firma';
import { todasLasHistorias } from '../historias';
import { cotizacionUsdBtc } from './precio';
import { bd, leerError } from './bd';
import { enlaceBilleteraDePrueba, type ConfigBtcpay } from './btcpay';
import { registrarEvento } from './eventos';

export type EstadoCobro = 'pendiente' | 'pagada' | 'vencida' | 'fallida';

/** One row of media_cobros, as the server reads it. */
export interface Cobro {
  id: string;
  lector_id: string;
  slug: string;
  titulo: string;
  precio_sats: number;
  precio_usd_centavos: number;
  factura: string;
  estado: EstadoCobro;
  expira_en: string;
  motivo: string | null;
  /** 'simulado' for the demo invoices, 'btcpay' for real Lightning invoices from BTCPay Server. */
  proveedor: 'simulado' | 'btcpay';
  btcpay_factura_id: string | null;
  btcpay_tienda_id: string | null;
}

export interface HistoriaDePago {
  slug: string;
  titulo: string;
  precioSats: number;
}

export const SEGUNDOS_PARA_PAGAR = 300;
const DIAS_DE_ACCESO = 7;
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SIN_GUARDAR = { 'Cache-Control': 'no-store' };
/** Answer for a paid story whose locked text is missing from media_cerrado. */
export const TEXTO_NO_DISPONIBLE = 'El texto de esta historia no está disponible ahora. Probá en un rato.';

const CODIGOS: Record<string, number> = {
  NO_ENCONTRADA: 404,
  DATOS_INVALIDOS: 400,
  ESTADO_INVALIDO: 409,
  FUERA_DE_PLAZO: 409,
  SIN_PRECIO: 503,
  PRECIO_DISCREPANTE: 503,
};

function variable(nombre: string): string | undefined {
  const deAstro = (import.meta.env as Record<string, string | undefined>)[nombre];
  return deAstro ?? process.env[nombre];
}

/** True when the demo payment buttons are on. The payment endpoints check this at run time. */
export function modoDemo(): boolean {
  return variable('PUBLIC_DEMO') === '1';
}

/**
 * A paid story from the content collection: not gratis and a price above zero. Null when the slug is
 * unknown or free. Callers read the locked text themselves, so a missing row can answer 503, not 404.
 */
export async function historiaDePago(slug: unknown): Promise<HistoriaDePago | null> {
  if (typeof slug !== 'string') return null;
  const historia = (await todasLasHistorias()).find((h) => h.id === slug);
  if (!historia || historia.data.gratis || !(historia.data.precio > 0)) return null;
  return { slug, titulo: historia.data.titulo, precioSats: historia.data.precio };
}

/** Whether this reader has paid for the story (a row in media_accesos). */
export async function tieneAcceso(lector: string, slug: string): Promise<boolean> {
  const { data, error } = await bd()
    .from('media_accesos')
    .select('id')
    .eq('lector_id', lector)
    .eq('slug', slug)
    .maybeSingle();
  if (error) throw error;
  return data !== null;
}

/** The signed token that opens one story for seven days after its payment. */
export function tokenDeAcceso(slug: string): { token: string; expira: number } {
  const expira = Date.now() + DIAS_DE_ACCESO * DIA;
  return { token: firmar({ tipo: 'pago', slugs: [slug], exp: expira }), expira };
}

/** Marks overdue pending invoices as vencida. Runs before any read that must see the real state. */
export async function vencerCobros(): Promise<void> {
  const { error } = await bd().rpc('media_vencer_cobros');
  if (error) throw error;
}

/** The newest invoice of this reader and story, in any state. Null when there is none. */
export async function ultimoCobro(lector: string, slug: string): Promise<{ id: string } | null> {
  const { data, error } = await bd()
    .from('media_cobros')
    .select('id')
    .eq('lector_id', lector)
    .eq('slug', slug)
    .order('creado_en', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data as { id: string } | null) ?? null;
}

/** The invoice a CacaoPay notice or a poll refers to, found by its stored id. Null when this site has no such invoice. */
export async function cobroDePay(facturaId: string): Promise<Cobro | null> {
  const { data, error } = await bd().from('media_cobros').select('*').eq('btcpay_factura_id', facturaId).maybeSingle();
  if (error) throw error;
  return (data as Cobro | null) ?? null;
}

/**
 * Opens the reader's access for a pending invoice that CacaoPay reports as paid, through media_pagar_cobro.
 * Null when the database refuses it (past the deadline, or no longer pending): the invoice is then left as it is.
 */
export async function abrirAccesoPagoPay(cobro: Cobro): Promise<Cobro | null> {
  const { data, error } = await bd().rpc('media_pagar_cobro', { p_cobro: cobro.id });
  if (error) {
    const { codigo } = leerError(error);
    if (codigo === 'FUERA_DE_PLAZO' || codigo === 'ESTADO_INVALIDO') return null;
    throw error;
  }
  const pagada = (Array.isArray(data) ? data[0] : data) as Cobro;
  await registrarEvento({
    sesion: cobro.lector_id,
    nombre: 'pago',
    ruta: `/historias/${pagada.slug}/`,
    objeto: pagada.slug,
    valorUsdCentavos: pagada.precio_usd_centavos,
  });
  return pagada;
}

/** The invoice, only when it belongs to this reader. Null for anyone else. */
export async function cobroDe(id: string, lector: string): Promise<Cobro | null> {
  const { data, error } = await bd()
    .from('media_cobros')
    .select('*')
    .eq('id', id)
    .eq('lector_id', lector)
    .maybeSingle();
  if (error) throw error;
  return (data as Cobro | null) ?? null;
}

/** USD cents for a sats price at the current BTC price, rounded up. Null when no price is available. */
export async function precioUsdCentavos(sats: number): Promise<number | null> {
  try {
    const cotizacion = await cotizacionUsdBtc();
    return Math.ceil(Number(((sats * cotizacion) / 1_000_000).toFixed(6)));
  } catch {
    return null;
  }
}

/** Seconds left to pay. Zero once the invoice is no longer pending. */
export function segundosRestantes(cobro: Cobro, ahora: number = Date.now()): number {
  if (cobro.estado !== 'pendiente') return 0;
  return Math.max(0, Math.ceil((Date.parse(cobro.expira_en) - ahora) / 1000));
}

/**
 * The invoice as the browser sees it. Money in integers: cents for USD, sats for Bitcoin.
 * The test-wallet link is only for BTCPay invoices, and only when BTCPay is configured.
 */
export function vistaCobro(cobro: Cobro, config: ConfigBtcpay | null = null) {
  return {
    id: cobro.id,
    factura: cobro.factura,
    precioSats: cobro.precio_sats,
    precioUsdCentavos: cobro.precio_usd_centavos,
    estado: cobro.estado,
    expiraEn: cobro.expira_en,
    segundosRestantes: segundosRestantes(cobro),
    billeteraDePrueba:
      cobro.proveedor === 'btcpay' && config ? enlaceBilleteraDePrueba(config, cobro.factura) : null,
  };
}

/** Turns a database error into an answer: the database's own sentence, with a status from its code. */
export function respuestaError(error: unknown): Response {
  const { codigo, mensaje } = leerError(error);
  const estado = CODIGOS[codigo] ?? 500;
  return Response.json({ error: mensaje }, { status: estado, headers: SIN_GUARDAR });
}

export { SIN_GUARDAR as sinGuardar };
