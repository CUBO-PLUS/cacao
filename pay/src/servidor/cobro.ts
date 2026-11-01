import 'server-only';

// The recipient's claim of a Lightning transfer. The recipient opens /cobrar/<token>, pastes an invoice
// for exactly the sats of the transfer, and the server pays it from the store's BTCPay wallet. Money moves
// only here: the database records the outcome (pay_iniciar_cobro, pay_terminar_cobro), and the browser
// never decides that a payment happened. A payment counts only when BTCPay says Complete.

import type { ConfigBtcpay } from './btcpay';
import { consultarPago, pagarFactura, type ResultadoPago } from './btcpay-pagos';
import { desdeError, exito, fallo, type Resultado } from './resultado';
import { clienteServicio } from './supabase';
import { configBtcpay, esPausaBtcpay, MENSAJE_PAUSA } from './url-btcpay';

export type EstadoCobroEnvio = 'pagando' | 'pagado' | 'fallido';

/** The refund of a transfer the sender takes back: the same states as a claim. */
export type EstadoDevolucion = 'pagando' | 'pagado' | 'fallido';

/** What the claim page may show: the first name of the sender, the amount and the outcome. Nothing else. */
export type DatosCobro = {
  codigo: string;
  estado: 'creada' | 'procesando' | 'completada' | 'fallida' | 'cancelada' | 'devuelta';
  sats: number;
  /** The sender's first name only. */
  remitenteNombre: string;
  cobroEstado: EstadoCobroEnvio | null;
  cobroMotivo: string | null;
  cobroHash: string | null;
  cobradaEn: string | null;
  /** True once the claim window has closed: the link no longer takes an invoice. */
  vencido: boolean;
};

/** The claim state of a transfer, for the sender and the administrator. The token is never shown to the public. */
export type CobroEnvio = {
  token: string | null;
  estado: EstadoCobroEnvio | null;
  motivo: string | null;
  hash: string | null;
  /** The refund of the transfer, when the sender took the money back. */
  devolucion: EstadoDevolucion | null;
  devolucionMotivo: string | null;
};

export type ResultadoCobrar = {
  /** pagado: the transfer is completada. pendiente: BTCPay has not settled it yet. fallido: try again. */
  estado: 'pagado' | 'pendiente' | 'fallido';
  motivo: string | null;
};

const TOKEN = /^[A-Za-z0-9_-]{43}$/;
// The database takes a null for the optional parameters, but the generated types say string.
const NULO = null as unknown as string;
const FACTURA = /^ln(bc|tb|bcrt)[0-9a-z]+$/;
const MENSAJE_NO_ENCONTRADO = 'No encontramos ese envío.';
const SIN_BTCPAY = 'El cobro por Lightning no está disponible ahora. Probá más tarde.';
const TIENDA = /^[A-Za-z0-9]{10,64}$/;
const MENSAJE_EN_CURSO = 'El pago anterior todavía está en curso en BTCPay; revisalo de nuevo en unos minutos.';
export const MOTIVO_SIN_PAGO = 'No encontramos el pago de esta factura. Pedí otra factura a tu billetera y probá de nuevo.';

// A payment BTCPay has never seen is given this long before it counts as failed: the request that started it
// may still be on its way.
export const ESPERA_SIN_PAGO_MS = 10 * 60 * 1000;

const COLUMNAS_COBRO =
  'codigo, estado, entrega, monto_destino, cobro_estado, cobro_motivo, cobro_hash, cobrada_en, cobro_vence_en, remitente:usuarios!pay_transferencias_remitente_id_fkey(nombre)';

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

const VALORES_DE_FIRMA = 104;

// The 5-bit values of a BOLT11 invoice's tagged data: timestamp and tags, with the checksum and the 104 values
// of the signature left out. Null when it is not bech32.
function valoresDeFactura(bolt11: string): number[] | null {
  const s = bolt11.trim().toLowerCase();
  // The bech32 separator is the last "1"; the last six characters are the checksum.
  const separador = s.lastIndexOf('1');
  if (separador < 0 || s.length - separador - 1 < 6 + VALORES_DE_FIRMA + 7) return null;
  const valores: number[] = [];
  for (const c of s.slice(separador + 1, s.length - 6 - VALORES_DE_FIRMA)) {
    const v = BECH32.indexOf(c);
    if (v < 0) return null;
    valores.push(v);
  }
  return valores;
}

/**
 * Payment hash of a BOLT11 invoice: the 'p' tagged field, as hex. Null when it is not there. Needed to look
 * up a payment whose answer was lost. The signature is not checked here.
 */
export function hashDeFactura(bolt11: string): string | null {
  const valores = valoresDeFactura(bolt11);
  if (!valores) return null;
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

/**
 * Unix time, in seconds, after which a BOLT11 invoice can no longer be paid: its timestamp plus its expiry
 * tag (one hour when the invoice has none). Null when the invoice does not carry a readable timestamp.
 */
export function vencimientoDeFactura(bolt11: string): number | null {
  const valores = valoresDeFactura(bolt11);
  if (!valores || valores.length < 7) return null;
  const emision = valores.slice(0, 7).reduce((acumulado, v) => acumulado * 32 + v, 0);
  let vigencia = 3600;
  let i = 7;
  while (i + 3 <= valores.length) {
    const tipo = valores[i];
    const largo = valores[i + 1] * 32 + valores[i + 2];
    i += 3;
    if (i + largo > valores.length) return null;
    // Tag 'x' (6) is the expiry, in seconds, written in 5-bit groups.
    if (tipo === 6) vigencia = valores.slice(i, i + largo).reduce((acumulado, v) => acumulado * 32 + v, 0);
    i += largo;
  }
  return emision + vigencia;
}

/**
 * Checks what a payer pastes: a Lightning invoice, for a whole number of sats, that has a payment hash and has
 * not expired. Nothing is sent anywhere. The database then checks the amount against the transfer.
 */
export function leerFacturaDePago(facturaCruda: string): Resultado<{ factura: string; sats: number; hash: string }> {
  const factura = facturaCruda.trim().toLowerCase();
  if (factura.length > 2000 || !FACTURA.test(factura)) {
    return fallo('DATOS_INVALIDOS', 'Ese código no parece de pago de bitcoin. Copialo completo: empieza con "lnbc".');
  }
  const sats = satsDeFactura(factura);
  if (sats === null) {
    return fallo('DATOS_INVALIDOS', 'El código tiene que ser por una cantidad exacta, sin centavos de bitcoin. Pedí otro código a tu billetera.');
  }
  const hash = hashDeFactura(factura);
  if (!hash) return fallo('DATOS_INVALIDOS', 'Ese código no sirve para cobrar. Pedí otro código a tu billetera.');
  const vence = vencimientoDeFactura(factura);
  if (vence === null || vence * 1000 <= Date.now()) {
    return fallo('DATOS_INVALIDOS', 'Ese código ya venció. Pedí otro código a tu billetera.');
  }
  return exito({ factura, sats, hash });
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
export async function enlaceFacturaDePrueba(sats: number): Promise<string | null> {
  const config = await configBtcpay();
  if (!config || !Number.isSafeInteger(sats) || sats <= 0) return null;
  return `${config.url}/billetera/recibir?sats=${sats}`;
}

/** The BTCPay address, key and store that pay out. Null when any of them is missing or malformed. */
export async function configDePago(): Promise<{ config: ConfigBtcpay; tienda: string } | null> {
  const config = await configBtcpay();
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
  cobro_vence_en: string | null;
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

// The attempt being paid: its invoice, its payment hash (stored before BTCPay was asked) and when it started.
// Only the server reads these.
type Intento = {
  factura: string | null;
  hash: string | null;
  intentoEn: string | null;
};

async function intentoDeCobro(token: string): Promise<Intento | null> {
  const { data, error } = await clienteServicio()
    .from('pay_transferencias')
    .select('cobro_factura, cobro_hash, cobro_intento_en')
    .eq('cobro_token', token)
    .maybeSingle();
  if (error) throw new Error(`No pudimos leer el envío: ${error.message}`);
  if (!data) return null;
  const fila = data as unknown as { cobro_factura: string | null; cobro_hash: string | null; cobro_intento_en: string | null };
  return { factura: fila.cobro_factura, hash: fila.cobro_hash, intentoEn: fila.cobro_intento_en };
}

// The hash of the attempt: the one stored when it started, or the one read from its invoice.
function hashDelIntento(intento: Intento): string | null {
  return intento.hash ?? (intento.factura ? hashDeFactura(intento.factura) : null);
}

// True when BTCPay has had the whole waiting time to show the payment and still does not know it.
function intentoVencido(intento: Intento): boolean {
  if (intento.intentoEn === null) return true;
  return Date.now() - Date.parse(intento.intentoEn) > ESPERA_SIN_PAGO_MS;
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
    vencido: fila.cobro_vence_en !== null && Date.now() >= Date.parse(fila.cobro_vence_en),
  };
}

/**
 * True when a Lightning transfer has this claim token. Only the existence is read: the proxy uses it to answer
 * 404 for an unknown link before the page streams.
 */
export async function existeCobro(token: string): Promise<boolean> {
  if (!TOKEN.test(token)) return false;
  const { data, error } = await clienteServicio()
    .from('pay_transferencias')
    .select('id')
    .eq('cobro_token', token)
    .eq('entrega', 'lightning')
    .maybeSingle();
  if (error) throw new Error(`No pudimos leer el cobro: ${error.message}`);
  return data !== null;
}

/**
 * The claim token of a transfer, for its recipient only: a Lightning transfer that is paid and not yet
 * collected (or whose last claim failed). Null for anyone else, so the token never reaches another account.
 * The caller reads the transfer as its recipient first.
 */
export async function tokenDeCobroDelDestinatario(envioId: string, usuarioId: string): Promise<string | null> {
  const { data, error } = await clienteServicio()
    .from('pay_transferencias')
    .select('cobro_token, cobro_estado, cobro_vence_en, entrega, estado, destinatario_id')
    .eq('id', envioId)
    .maybeSingle();
  if (error) throw new Error(`No pudimos leer el cobro: ${error.message}`);
  const fila = data as unknown as {
    cobro_token: string | null;
    cobro_estado: EstadoCobroEnvio | null;
    cobro_vence_en: string | null;
    entrega: 'efectivo' | 'cuenta' | 'lightning';
    estado: DatosCobro['estado'];
    destinatario_id: string | null;
  } | null;
  if (!fila || fila.destinatario_id !== usuarioId) return null;
  if (fila.entrega !== 'lightning' || fila.estado !== 'procesando') return null;
  if (fila.cobro_estado === 'pagado' || fila.cobro_estado === 'pagando') return null;
  if (fila.cobro_vence_en !== null && Date.now() >= Date.parse(fila.cobro_vence_en)) return null;
  if (!fila.cobro_token || !TOKEN.test(fila.cobro_token)) return null;
  return fila.cobro_token;
}

/**
 * The claim state of a transfer, for the sender or an administrator. The caller checks the role first:
 * this function reads without a check.
 */
export async function cobroDeEnvio(envioId: string): Promise<CobroEnvio | null> {
  const { data, error } = await clienteServicio()
    .from('pay_transferencias')
    .select('cobro_token, cobro_estado, cobro_motivo, cobro_hash, devolucion_estado, devolucion_motivo, entrega')
    .eq('id', envioId)
    .maybeSingle();
  if (error) throw new Error(`No pudimos leer el cobro: ${error.message}`);
  const fila = data as unknown as {
    cobro_token: string | null;
    cobro_estado: EstadoCobroEnvio | null;
    cobro_motivo: string | null;
    cobro_hash: string | null;
    devolucion_estado: EstadoDevolucion | null;
    devolucion_motivo: string | null;
  } | null;
  if (!fila) return null;
  return {
    token: fila.cobro_token,
    estado: fila.cobro_estado,
    motivo: fila.cobro_motivo,
    hash: fila.cobro_hash,
    devolucion: fila.devolucion_estado,
    devolucionMotivo: fila.devolucion_motivo,
  };
}

// Records how a payment ended. Only a pagado or fallido result reaches the database; pendiente waits.
async function cerrarCobro(token: string, resultado: ResultadoPago): Promise<Resultado<ResultadoCobrar>> {
  if (resultado.estado === 'pendiente') return exito({ estado: 'pendiente', motivo: null });
  const { error } = await clienteServicio().rpc('pay_terminar_cobro', {
    p_token: token,
    p_ok: resultado.estado === 'pagado',
    p_hash: resultado.hash ?? NULO,
    p_motivo: resultado.motivo ?? NULO,
  });
  if (error) return desdeError(error);
  return exito({ estado: resultado.estado, motivo: resultado.motivo });
}

/**
 * The recipient pays the transfer's sats to the invoice. The database checks the transfer and the amount,
 * counts the attempt and stores the invoice's payment hash, and marks the claim "pagando" first, so a second
 * press cannot pay twice. Then BTCPay pays the invoice.
 */
export async function cobrarEnvio(token: string, facturaCruda: string): Promise<Resultado<ResultadoCobrar>> {
  try {
    if (!TOKEN.test(token)) return fallo('NO_ENCONTRADA', MENSAJE_NO_ENCONTRADO);
    const leida = leerFacturaDePago(facturaCruda);
    if (!leida.ok) return leida;
    const { factura, sats, hash } = leida.dato;
    const pago = await configDePago();
    if (!pago) return fallo('NO_DISPONIBLE', SIN_BTCPAY);

    // The hash is stored before BTCPay is asked, so a crash after this point can still be reconciled.
    const { error } = await clienteServicio().rpc('pay_iniciar_cobro', {
      p_token: token,
      p_factura: factura,
      p_sats: sats,
      p_hash: hash,
    });
    if (error) return desdeError(error);

    let resultado: ResultadoPago;
    try {
      resultado = await pagarFactura(pago.config, pago.tienda, factura);
    } catch (e) {
      // BTCPay did not answer clearly. The payment may have left, so the transfer stays "pagando" and
      // the page asks again later instead of letting the recipient pay a second invoice.
      console.error('BTCPay al cobrar:', e instanceof Error ? e.message : e);
      // BTCPay down or failing: the payer is asked to come back later, and the state is kept.
      if (esPausaBtcpay(e)) return fallo('NO_DISPONIBLE', MENSAJE_PAUSA);
      return exito({ estado: 'pendiente', motivo: null });
    }
    return cerrarCobro(token, resultado);
  } catch (e) {
    return desdeError(e);
  }
}

/**
 * The state of a claim that is being paid. While it is "pagando", BTCPay is asked for the payment by its
 * hash, and a Complete or Failed answer closes the claim. A payment BTCPay does not know, after the waiting
 * time, is failed. Anything unclear leaves it "pagando".
 */
export async function estadoDeCobro(token: string): Promise<Resultado<{ cobroEstado: EstadoCobroEnvio | null }>> {
  try {
    if (!TOKEN.test(token)) return fallo('NO_ENCONTRADA', MENSAJE_NO_ENCONTRADO);
    const fila = await filaDeCobro(token);
    if (!fila || fila.entrega !== 'lightning') return fallo('NO_ENCONTRADA', MENSAJE_NO_ENCONTRADO);
    if (fila.cobro_estado !== 'pagando') return exito({ cobroEstado: fila.cobro_estado });

    const pago = await configDePago();
    const intento = await intentoDeCobro(token);
    const hash = intento ? hashDelIntento(intento) : null;
    if (!pago || !intento || !hash) return exito({ cobroEstado: 'pagando' });

    let resultado: ResultadoPago | null;
    try {
      resultado = await consultarPago(pago.config, pago.tienda, hash);
    } catch (e) {
      console.error('BTCPay al revisar el cobro:', e instanceof Error ? e.message : e);
      return exito({ cobroEstado: 'pagando' });
    }
    if (resultado?.estado === 'pendiente') return exito({ cobroEstado: 'pagando' });
    if (!resultado) {
      // BTCPay does not know this payment. Only after the waiting time is it counted as failed.
      if (!intentoVencido(intento)) return exito({ cobroEstado: 'pagando' });
      resultado = { estado: 'fallido', hash: null, motivo: MOTIVO_SIN_PAGO };
    }

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
 * An administrator closes a claim that is stuck in "pagando". First BTCPay is asked for the attempt's payment:
 * a Complete payment closes the claim as paid; a Pending one, or one BTCPay has not seen within the waiting
 * time, refuses the change; a Failed one, or one BTCPay does not know after the waiting time, closes it as
 * failed with the reason written here. A claim is never failed while BTCPay cannot be asked. The caller checks
 * the admin role first.
 */
export async function marcarCobroFallido(token: string, motivo: string): Promise<Resultado<ResultadoCobrar>> {
  try {
    if (!TOKEN.test(token)) return fallo('NO_ENCONTRADA', MENSAJE_NO_ENCONTRADO);
    const limpio = motivo.trim();
    if (Array.from(limpio).length < 4 || Array.from(limpio).length > 200) {
      return fallo('DATOS_INVALIDOS', 'El motivo tiene que tener entre 4 y 200 caracteres.');
    }
    const intento = await intentoDeCobro(token);
    if (!intento) return fallo('NO_ENCONTRADA', MENSAJE_NO_ENCONTRADO);

    const hash = hashDelIntento(intento);
    if (hash) {
      const pago = await configDePago();
      if (!pago) {
        return fallo('NO_DISPONIBLE', 'El cobro con bitcoin no está disponible ahora. Probá más tarde.');
      }
      let resultado: ResultadoPago | null;
      try {
        resultado = await consultarPago(pago.config, pago.tienda, hash);
      } catch (e) {
        console.error('BTCPay al marcar el cobro:', e instanceof Error ? e.message : e);
        return fallo('BTCPAY', 'No pudimos revisar el pago con la billetera, así que no lo damos por fallido. Probá de nuevo en un momento.');
      }
      if (resultado?.estado === 'pagado') {
        return await cerrarCobro(token, resultado);
      }
      if (resultado?.estado === 'pendiente') return fallo('ESTADO_INVALIDO', MENSAJE_EN_CURSO);
      if (!resultado && !intentoVencido(intento)) return fallo('ESTADO_INVALIDO', MENSAJE_EN_CURSO);
    }

    return await cerrarCobro(token, { estado: 'fallido', hash: null, motivo: limpio });
  } catch (e) {
    return desdeError(e);
  }
}
