import 'server-only';

// The recipient's claim of a Lightning transfer. The recipient opens /cobrar/<token>, pastes an invoice
// for exactly the sats of the transfer, and the server pays it from the store's BTCPay wallet. Money moves
// only here: the database records the outcome (pay_iniciar_cobro, pay_terminar_cobro), and the browser
// never decides that a payment happened. A payment counts only when BTCPay says Complete.

import { configDesdeEntorno, type ConfigBtcpay } from './btcpay';
import { consultarPago, pagarFactura, type ResultadoPago } from './btcpay-pagos';
import { desdeError, exito, fallo, type Resultado } from './resultado';
import { clienteServicio } from './supabase';

export type EstadoCobroEnvio = 'pagando' | 'pagado' | 'fallido';

/** What the claim page may show: the first name of the sender, the amount and the outcome. Nothing else. */
export type DatosCobro = {
  codigo: string;
  estado: 'creada' | 'procesando' | 'completada' | 'fallida' | 'cancelada';
  sats: number;
  /** The sender's first name only. */
  remitenteNombre: string;
  cobroEstado: EstadoCobroEnvio | null;
  cobroMotivo: string | null;
  cobroHash: string | null;
  cobradaEn: string | null;
};

/** The claim state of a transfer, for the sender and the administrator. The token is never shown to the public. */
export type CobroEnvio = {
  token: string | null;
  estado: EstadoCobroEnvio | null;
  motivo: string | null;
  hash: string | null;
};

export type ResultadoCobrar = {
  /** pagado: the transfer is completada. pendiente: BTCPay has not settled it yet. fallido: try again. */
  estado: 'pagado' | 'pendiente' | 'fallido';
  motivo: string | null;
};

const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const FACTURA = /^ln(bc|tb|bcrt)[0-9a-z]+$/;
const MENSAJE_NO_ENCONTRADO = 'No encontramos ese envío.';
const SIN_BTCPAY = 'El pago con Lightning no está activo en este servidor.';
const TIENDA = /^[A-Za-z0-9]{10,64}$/;

const COLUMNAS_COBRO =
  'codigo, estado, entrega, monto_destino, cobro_estado, cobro_motivo, cobro_hash, cobrada_en, remitente:usuarios!pay_transferencias_remitente_id_fkey(nombre)';

// Amounts of a BOLT11 multiplier, as a fraction of one BTC in sats: 1 BTC = 1e8 sats.
// m = 1e-3 BTC, u = 1e-6 BTC, n = 1e-9 BTC, p = 1e-12 BTC.
const MULTIPLICADOR_SATS: Record<string, [bigint, bigint]> = {
  '': [BigInt(100_000_000), BigInt(1)],
  m: [BigInt(100_000), BigInt(1)],
  u: [BigInt(100), BigInt(1)],
  n: [BigInt(1), BigInt(10)],
  p: [BigInt(1), BigInt(10_000)],
};
const CERO = BigInt(0);

// Bech32 alphabet of BOLT11 data, in value order.
const BECH32 = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';

/**
 * Sats in a BOLT11 invoice's amount. Null when the invoice has no amount, an amount that is not a whole
 * number of sats, or is not a Lightning invoice. Reads only the human-readable part; the signature is
 * checked by BTCPay when it pays.
 */
export function satsDeFactura(bolt11: string): number | null {
  const m = /^ln(bcrt|bc|tbs|tb)(\d+)([munp]?)1/.exec(bolt11.trim().toLowerCase());
  if (!m) return null;
  const [numerador, denominador] = MULTIPLICADOR_SATS[m[3]];
  const producto = BigInt(m[2]) * numerador;
  if (producto % denominador !== CERO) return null;
  const sats = producto / denominador;
  if (sats <= CERO || sats > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return Number(sats);
}

/**
 * Payment hash of a BOLT11 invoice: the 'p' tagged field, as hex. Null when it is not there. Needed to look
 * up a payment whose answer was lost. The signature is not checked here.
 */
export function hashDeFactura(bolt11: string): string | null {
  const s = bolt11.trim().toLowerCase();
  // The bech32 separator is the last "1"; the last six characters are the checksum.
  const separador = s.lastIndexOf('1');
  if (separador < 0 || s.length - separador - 1 < 6 + 7) return null;
  const valores: number[] = [];
  for (const c of s.slice(separador + 1, s.length - 6)) {
    const v = BECH32.indexOf(c);
    if (v < 0) return null;
    valores.push(v);
  }
  // Seven values of timestamp come first, then tagged fields: type (1), length (2), data.
  let i = 7;
  while (i + 3 <= valores.length) {
    const tipo = valores[i];
    const largo = valores[i + 1] * 32 + valores[i + 2];
    i += 3;
    if (i + largo > valores.length) return null;
    if (tipo === 1 && largo === 52) {
      // 52 values of 5 bits are 260 bits; the hash is the first 256.
      let bits = '';
      for (const v of valores.slice(i, i + largo)) bits += v.toString(2).padStart(5, '0');
      let hex = '';
      for (let k = 0; k < 256; k += 8) hex += parseInt(bits.slice(k, k + 8), 2).toString(16).padStart(2, '0');
      return hex;
    }
    i += largo;
  }
  return null;
}

// Where the claim links point. The product's public address, else the one used for the demo.
function origenSitio(): string {
  const base = (process.env.NEXT_PUBLIC_SITIO_URL ?? '').trim().replace(/\/+$/, '');
  return /^https?:\/\/[^/\s]+$/.test(base) ? base : 'https://cacao-pay.vercel.app';
}

/** The claim link for the sender to share. Null when the transfer has no token (it is not Lightning). */
export function enlaceDeCobro(cobro: { token: string | null } | null): string | null {
  if (!cobro?.token || !TOKEN.test(cobro.token)) return null;
  return `${origenSitio()}/cobrar/${cobro.token}`;
}

/** The regtest test wallet, with an invoice for these sats already asked for. Null without BTCPay. */
export function enlaceFacturaDePrueba(sats: number): string | null {
  const config = configDesdeEntorno(process.env);
  if (!config || !Number.isSafeInteger(sats) || sats <= 0) return null;
  return `${config.url}/billetera/recibir?sats=${sats}`;
}

function configDePago(): { config: ConfigBtcpay; tienda: string } | null {
  const config = configDesdeEntorno(process.env);
  const tienda = (process.env.BTCPAY_STORE_ID ?? '').trim();
  if (!config || !TIENDA.test(tienda)) return null;
  return { config, tienda };
}

type FilaCobro = {
  codigo: string;
  estado: DatosCobro['estado'];
  entrega: 'efectivo' | 'cuenta' | 'lightning';
  monto_destino: number;
  cobro_estado: EstadoCobroEnvio | null;
  cobro_motivo: string | null;
  cobro_hash: string | null;
  cobrada_en: string | null;
  remitente: { nombre: string } | null;
};

async function filaDeCobro(token: string): Promise<FilaCobro | null> {
  const { data, error } = await clienteServicio()
    .from('pay_transferencias')
    .select(COLUMNAS_COBRO)
    .eq('cobro_token', token)
    .maybeSingle();
  if (error) throw new Error(`No pudimos leer el envío: ${error.message}`);
  return data as unknown as FilaCobro | null;
}

// Reads the factura too; only the server uses it, so it is not in the public columns.
async function facturaDeCobro(token: string): Promise<string | null> {
  const { data, error } = await clienteServicio()
    .from('pay_transferencias')
    .select('cobro_factura')
    .eq('cobro_token', token)
    .maybeSingle();
  if (error) throw new Error(`No pudimos leer el envío: ${error.message}`);
  return (data as { cobro_factura: string | null } | null)?.cobro_factura ?? null;
}

function primerNombre(nombre: string | null | undefined): string {
  return (nombre ?? '').trim().split(/\s+/)[0] ?? '';
}

/**
 * What the claim page shows for a token. Null for an unknown token or for a transfer that is not Lightning.
 * Only the sender's first name, the amount, the state and the outcome of the claim.
 */
export async function datosDeCobro(token: string): Promise<DatosCobro | null> {
  if (!TOKEN.test(token)) return null;
  const fila = await filaDeCobro(token);
  if (!fila || fila.entrega !== 'lightning') return null;
  return {
    codigo: fila.codigo,
    estado: fila.estado,
    sats: Number(fila.monto_destino),
    remitenteNombre: primerNombre(fila.remitente?.nombre),
    cobroEstado: fila.cobro_estado,
    cobroMotivo: fila.cobro_motivo,
    cobroHash: fila.cobro_hash,
    cobradaEn: fila.cobrada_en,
  };
}

/**
 * The claim state of a transfer, for the sender or an administrator. The caller checks the role first:
 * this function reads without a check.
 */
export async function cobroDeEnvio(envioId: string): Promise<CobroEnvio | null> {
  const { data, error } = await clienteServicio()
    .from('pay_transferencias')
    .select('cobro_token, cobro_estado, cobro_motivo, cobro_hash, entrega')
    .eq('id', envioId)
    .maybeSingle();
  if (error) throw new Error(`No pudimos leer el cobro: ${error.message}`);
  const fila = data as unknown as {
    cobro_token: string | null;
    cobro_estado: EstadoCobroEnvio | null;
    cobro_motivo: string | null;
    cobro_hash: string | null;
  } | null;
  if (!fila) return null;
  return {
    token: fila.cobro_token,
    estado: fila.cobro_estado,
    motivo: fila.cobro_motivo,
    hash: fila.cobro_hash,
  };
}

// Records how a payment ended. Only a pagado or fallido result reaches the database; pendiente waits.
async function cerrarCobro(token: string, resultado: ResultadoPago): Promise<Resultado<ResultadoCobrar>> {
  if (resultado.estado === 'pendiente') return exito({ estado: 'pendiente', motivo: null });
  const { error } = await clienteServicio().rpc('pay_terminar_cobro', {
    p_token: token,
    p_ok: resultado.estado === 'pagado',
    p_hash: resultado.hash,
    p_motivo: resultado.motivo,
  });
  if (error) return desdeError(error);
  return exito({ estado: resultado.estado, motivo: resultado.motivo });
}

/**
 * The recipient pays the transfer's sats to the invoice. The database checks the transfer and the amount
 * and marks it "pagando" first, so a second press cannot pay twice. Then BTCPay pays the invoice.
 */
export async function cobrarEnvio(token: string, facturaCruda: string): Promise<Resultado<ResultadoCobrar>> {
  try {
    if (!TOKEN.test(token)) return fallo('NO_ENCONTRADA', MENSAJE_NO_ENCONTRADO);
    const factura = facturaCruda.trim().toLowerCase();
    if (factura.length > 2000 || !FACTURA.test(factura)) {
      return fallo('DATOS_INVALIDOS', 'Pegá una factura Lightning (empieza con lnbc, lntb o lnbcrt).');
    }
    const sats = satsDeFactura(factura);
    if (sats === null) {
      return fallo('DATOS_INVALIDOS', 'La factura tiene que ser por un monto fijo, en sats enteros.');
    }
    const pago = configDePago();
    if (!pago) return fallo('NO_DISPONIBLE', SIN_BTCPAY);

    const { error } = await clienteServicio().rpc('pay_iniciar_cobro', {
      p_token: token,
      p_factura: factura,
      p_sats: sats,
    });
    if (error) return desdeError(error);

    let resultado: ResultadoPago;
    try {
      resultado = await pagarFactura(pago.config, pago.tienda, factura);
    } catch (e) {
      // BTCPay did not answer clearly. The payment may have left, so the transfer stays "pagando" and
      // the page asks again later instead of letting the recipient pay a second invoice.
      console.error('BTCPay al cobrar:', e instanceof Error ? e.message : e);
      return exito({ estado: 'pendiente', motivo: null });
    }
    return cerrarCobro(token, resultado);
  } catch (e) {
    return desdeError(e);
  }
}

/**
 * The state of a claim that is being paid. While it is "pagando", BTCPay is asked for the payment by its
 * hash, and a Complete or Failed answer closes the claim. Anything unclear leaves it "pagando".
 */
export async function estadoDeCobro(token: string): Promise<Resultado<{ cobroEstado: EstadoCobroEnvio | null }>> {
  try {
    if (!TOKEN.test(token)) return fallo('NO_ENCONTRADA', MENSAJE_NO_ENCONTRADO);
    const fila = await filaDeCobro(token);
    if (!fila || fila.entrega !== 'lightning') return fallo('NO_ENCONTRADA', MENSAJE_NO_ENCONTRADO);
    if (fila.cobro_estado !== 'pagando') return exito({ cobroEstado: fila.cobro_estado });

    const pago = configDePago();
    const factura = await facturaDeCobro(token);
    const hash = factura ? hashDeFactura(factura) : null;
    if (!pago || !hash) return exito({ cobroEstado: 'pagando' });

    let resultado: ResultadoPago | null;
    try {
      resultado = await consultarPago(pago.config, pago.tienda, hash);
    } catch (e) {
      console.error('BTCPay al revisar el cobro:', e instanceof Error ? e.message : e);
      return exito({ cobroEstado: 'pagando' });
    }
    if (!resultado || resultado.estado === 'pendiente') return exito({ cobroEstado: 'pagando' });

    const cerrado = await cerrarCobro(token, resultado);
    if (!cerrado.ok) {
      // Another request closed it first: the state in the database is the answer.
      const ahora = await filaDeCobro(token);
      return exito({ cobroEstado: ahora?.cobro_estado ?? 'pagando' });
    }
    return exito({ cobroEstado: resultado.estado === 'pagado' ? 'pagado' : 'fallido' });
  } catch (e) {
    return desdeError(e);
  }
}

/**
 * An administrator marks a claim that is stuck in "pagando" as failed, when BTCPay has no answer to give.
 * The reason is shown to the person who claims, so it is written for them. The caller checks the admin
 * role first. Only a claim that is being paid can be closed here.
 */
export async function marcarCobroFallido(token: string, motivo: string): Promise<Resultado<ResultadoCobrar>> {
  try {
    if (!TOKEN.test(token)) return fallo('NO_ENCONTRADA', MENSAJE_NO_ENCONTRADO);
    const limpio = motivo.trim();
    if (Array.from(limpio).length < 4 || Array.from(limpio).length > 200) {
      return fallo('DATOS_INVALIDOS', 'El motivo tiene que tener entre 4 y 200 caracteres.');
    }
    return await cerrarCobro(token, { estado: 'fallido', hash: null, motivo: limpio });
  } catch (e) {
    return desdeError(e);
  }
}
