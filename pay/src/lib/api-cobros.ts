// The payments API (v1), the pure part: checks of what a client sends, API keys, the address of a notice and the
// signature of a notice. No 'server-only' here: nothing in this file reads a secret from the environment.

import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

import { exito, fallo, type Resultado } from '@/servidor/resultado';

/** The product a client is bound to. Set when the client is made; a request cannot choose it. */
export const PRODUCTOS = ['media', 'travel', 'market', 'pay', 'negocios'] as const;
export type Producto = (typeof PRODUCTOS)[number];

export const MONEDAS = ['USD', 'SATS'] as const;
export type Moneda = (typeof MONEDAS)[number];

export const LIMITES = {
  /** US cents: $1.00 to $10,000.00. */
  usdMinCentavos: 100,
  usdMaxCentavos: 1_000_000,
  /** Sats: 1,000 to 1 BTC. */
  satsMin: 1,
  satsMax: 100_000_000,
  /** Invoice life in seconds: 5 minutes to 24 hours, one hour by default. */
  venceMin: 300,
  venceMax: 86_400,
  venceDefault: 3_600,
  descripcionMax: 200,
  referenciaMax: 120,
  avisoUrlMax: 500,
  /** The client's datos: a JSON object of at most this many bytes, kept as sent. */
  datosMaxBytes: 2_000,
  cuerpoMaxBytes: 8_192,
};

/** A key is "cp_" and 32 characters of URL-safe base64 (24 random bytes). Only its prefix is shown afterwards. */
export const FORMATO_CLAVE = /^cp_[A-Za-z0-9_-]{32}$/;
export const LONGITUD_PREFIJO = 11;
const IDEMPOTENCIA = /^[A-Za-z0-9_-]{8,128}$/;
const TIENDA = /^[A-Za-z0-9]{10,64}$/;
const HEX64 = /^[0-9a-f]{64}$/;

/** The tolerance for the time of a notice, in seconds: a notice older than this is refused (replay). */
export const TOLERANCIA_AVISO_SEG = 300;

/** What a client may send to create a charge, after checks. Null store and notice mean "use the default". */
export type CuerpoCobro = {
  monto: number;
  moneda: Moneda;
  descripcion: string;
  referencia: string;
  tienda: string | null;
  vence_en_segundos: number;
  aviso_url: string | null;
  /** The client's datos in canonical JSON (see canonicoJson), or null. Stored and returned, never interpreted. */
  datos: string | null;
};

// The product is not a field: the client's product labels every charge (pay_api_clientes.producto).
const CAMPOS_COBRO = new Set(['monto', 'moneda', 'descripcion', 'referencia', 'tienda', 'vence_en_segundos', 'aviso_url', 'datos']);

/**
 * The canonical text of a JSON value: object keys sorted at every level, no spaces. The same datos always gives the
 * same text, so the fingerprint and the stored value do not depend on the order of the keys the client sent.
 */
export function canonicoJson(valor: unknown): string {
  if (Array.isArray(valor)) return `[${valor.map((v) => canonicoJson(v)).join(',')}]`;
  if (typeof valor === 'object' && valor !== null) {
    const o = valor as Record<string, unknown>;
    const claves = Object.keys(o).sort();
    return `{${claves.map((k) => `${JSON.stringify(k)}:${canonicoJson(o[k])}`).join(',')}}`;
  }
  return JSON.stringify(valor);
}

export type OpcionesAviso = {
  /** True in development: http and localhost are allowed. Never in production. */
  desarrollo: boolean;
};

function textoRecortado(valor: unknown): string {
  return typeof valor === 'string' ? valor.trim() : '';
}

/**
 * Checks the body of a charge request. Strict: an unknown field is refused, so a misspelled field never silently
 * changes what is charged. The amount is whole US cents or whole sats, by currency.
 */
export function validarCuerpoCobro(cuerpo: unknown, opciones: OpcionesAviso): Resultado<CuerpoCobro> {
  if (typeof cuerpo !== 'object' || cuerpo === null || Array.isArray(cuerpo)) {
    return fallo('DATOS_INVALIDOS', 'El cuerpo tiene que ser un objeto JSON.');
  }
  const campos = cuerpo as Record<string, unknown>;
  for (const clave of Object.keys(campos)) {
    if (!CAMPOS_COBRO.has(clave)) return fallo('DATOS_INVALIDOS', `El campo "${clave}" no existe en la API.`);
  }

  const moneda = campos.moneda;
  if (moneda !== 'USD' && moneda !== 'SATS') return fallo('DATOS_INVALIDOS', 'La moneda tiene que ser "USD" o "SATS".');

  const monto = campos.monto;
  if (typeof monto !== 'number' || !Number.isSafeInteger(monto)) {
    return fallo('DATOS_INVALIDOS', 'El monto tiene que ser un número entero.');
  }
  if (moneda === 'USD' && (monto < LIMITES.usdMinCentavos || monto > LIMITES.usdMaxCentavos)) {
    return fallo('DATOS_INVALIDOS', 'El monto en USD tiene que estar entre 100 y 1000000 centavos.');
  }
  if (moneda === 'SATS' && (monto < LIMITES.satsMin || monto > LIMITES.satsMax)) {
    return fallo('DATOS_INVALIDOS', 'El monto en sats tiene que estar entre 1 y 100000000.');
  }

  const descripcion = textoRecortado(campos.descripcion);
  if (descripcion.length < 1 || descripcion.length > LIMITES.descripcionMax) {
    return fallo('DATOS_INVALIDOS', 'La descripción tiene que tener entre 1 y 200 caracteres.');
  }
  const referencia = textoRecortado(campos.referencia);
  if (referencia.length < 1 || referencia.length > LIMITES.referenciaMax) {
    return fallo('DATOS_INVALIDOS', 'La referencia tiene que tener entre 1 y 120 caracteres.');
  }

  let tienda: string | null = null;
  if (campos.tienda !== undefined && campos.tienda !== null) {
    if (typeof campos.tienda !== 'string' || !TIENDA.test(campos.tienda)) {
      return fallo('DATOS_INVALIDOS', 'La tienda no es válida.');
    }
    tienda = campos.tienda;
  }

  let venceEnSegundos = LIMITES.venceDefault;
  if (campos.vence_en_segundos !== undefined) {
    const vence = campos.vence_en_segundos;
    if (typeof vence !== 'number' || !Number.isSafeInteger(vence) || vence < LIMITES.venceMin || vence > LIMITES.venceMax) {
      return fallo('DATOS_INVALIDOS', 'El plazo tiene que estar entre 300 y 86400 segundos.');
    }
    venceEnSegundos = vence;
  }

  let avisoUrl: string | null = null;
  if (campos.aviso_url !== undefined && campos.aviso_url !== null) {
    if (typeof campos.aviso_url !== 'string') return fallo('DATOS_INVALIDOS', 'La dirección de aviso no es válida.');
    const url = validarUrlAviso(campos.aviso_url, opciones);
    if (!url.ok) return url;
    avisoUrl = url.dato;
  }

  let datos: string | null = null;
  if (campos.datos !== undefined && campos.datos !== null) {
    if (typeof campos.datos !== 'object' || Array.isArray(campos.datos)) {
      return fallo('DATOS_INVALIDOS', 'Los datos tienen que ser un objeto JSON.');
    }
    datos = canonicoJson(campos.datos);
    if (Buffer.byteLength(datos, 'utf8') > LIMITES.datosMaxBytes) {
      return fallo('DATOS_INVALIDOS', 'Los datos pasan de 2000 bytes.');
    }
  }

  return exito({
    monto,
    moneda,
    descripcion,
    referencia,
    tienda,
    vence_en_segundos: venceEnSegundos,
    aviso_url: avisoUrl,
    datos,
  });
}

/** The Idempotency-Key header: 8 to 128 characters of letters, digits, "-" and "_". Required on a charge. */
export function validarClaveIdempotencia(valor: string | null): Resultado<string> {
  const limpio = (valor ?? '').trim();
  if (!IDEMPOTENCIA.test(limpio)) {
    return fallo('DATOS_INVALIDOS', 'Falta el encabezado Idempotency-Key, o no es válido (8 a 128 caracteres: letras, números, "-" y "_").');
  }
  return exito(limpio);
}

/** True for an address that is local or internal: it must never be the target of a notice. */
export function esHostInterno(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (h.includes(':')) return esIpPrivada(h);
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h)) return esIpPrivada(h);
  if (!h.includes('.')) return true;
  return h === 'localhost' || /\.(localhost|local|internal|localdomain|home\.arpa)$/.test(h);
}

/** True for a private, loopback, link-local, shared, multicast or reserved IPv4 or IPv6 address. */
export function esIpPrivada(ip: string): boolean {
  const h = ip.toLowerCase().replace(/^\[|\]$/g, '');
  const v4 = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(h);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (a > 255 || Number(v4[2]) > 255 || Number(v4[3]) > 255 || Number(v4[4]) > 255) return true;
    return (
      a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0) ||
      (a === 198 && (b === 18 || b === 19))
    );
  }
  if (!h.includes(':')) return true;
  // IPv4-mapped IPv6 (::ffff:a.b.c.d or ::ffff:hex): judged by the IPv4 address it carries.
  const mapeado = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(h);
  if (mapeado) return esIpPrivada(mapeado[1]);
  return (
    h === '::' || h === '::1' ||
    /^f[cd]/.test(h) ||
    /^fe[89ab]/.test(h) ||
    /^ff/.test(h) ||
    h.startsWith('::ffff:') ||
    h.startsWith('64:ff9b:') ||
    h.startsWith('2002:')
  );
}

/**
 * The address a notice is posted to. https only; http only for localhost in development. No user name or
 * password, no internal or private address, and a public host name with a dot. The server checks the resolved
 * address again before each notice (pay/src/servidor/api-cobros.ts).
 */
export function validarUrlAviso(valor: string, opciones: OpcionesAviso): Resultado<string> {
  const texto = valor.trim();
  if (texto.length === 0 || texto.length > LIMITES.avisoUrlMax) {
    return fallo('DATOS_INVALIDOS', 'La dirección de aviso no es válida.');
  }
  let url: URL;
  try {
    url = new URL(texto);
  } catch {
    return fallo('DATOS_INVALIDOS', 'La dirección de aviso no es válida.');
  }
  if (url.username || url.password) return fallo('DATOS_INVALIDOS', 'La dirección de aviso no puede llevar usuario ni clave.');
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  const local = host === 'localhost' || host === '127.0.0.1' || host === '::1';
  if (url.protocol === 'https:') {
    if (local) return fallo('DATOS_INVALIDOS', 'La dirección de aviso no puede ser local.');
  } else if (url.protocol === 'http:') {
    if (!(opciones.desarrollo && local)) {
      return fallo('DATOS_INVALIDOS', 'La dirección de aviso tiene que ser https.');
    }
  } else {
    return fallo('DATOS_INVALIDOS', 'La dirección de aviso tiene que ser https.');
  }
  // An IP literal is never a notice target, except the local address of development. WHATWG has already turned the
  // decimal, hex and octal forms of an IPv4 address into dotted form, so this sees every spelling.
  const literal = host.includes(':') || /^\d+\.\d+\.\d+\.\d+$/.test(host);
  if (literal && !(opciones.desarrollo && local)) {
    return fallo('DATOS_INVALIDOS', 'La dirección de aviso no puede ser una dirección IP.');
  }
  // Only the default port: 443 for https. A local development address may use any port.
  if (url.port !== '' && !(opciones.desarrollo && local)) {
    return fallo('DATOS_INVALIDOS', 'La dirección de aviso solo puede usar el puerto 443.');
  }
  if (!local && esHostInterno(host)) {
    return fallo('DATOS_INVALIDOS', 'La dirección de aviso apunta a una red privada o interna.');
  }
  return exito(url.toString());
}

/** SHA-256 of the key in hex: what the database keeps. */
export function hashClave(clave: string): string {
  return createHash('sha256').update(clave, 'utf8').digest('hex');
}

/** Reads "Authorization: Bearer cp_..." and returns the key, or null when the header is missing or malformed. */
export function leerBearer(cabecera: string | null): string | null {
  if (!cabecera) return null;
  const partes = /^Bearer\s+(\S+)$/i.exec(cabecera.trim());
  if (!partes || !FORMATO_CLAVE.test(partes[1])) return null;
  return partes[1];
}

/** The part of a key that is stored in clear and shown in lists. */
export function prefijoDeClave(clave: string): string {
  return clave.slice(0, LONGITUD_PREFIJO);
}

/** True when the key matches the stored hash. The comparison takes the same time whatever the key is. */
export function claveCoincide(clave: string, hashGuardado: string): boolean {
  if (!HEX64.test(hashGuardado)) return false;
  const a = Buffer.from(hashClave(clave), 'hex');
  const b = Buffer.from(hashGuardado, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Fingerprint of a charge request: the same key with the same fingerprint is a repeat of the same charge.
 * The store is the one resolved for the client, so a default store is part of the fingerprint, and so are the datos.
 * Without datos the list is the one older charges were fingerprinted with, so a key in flight keeps matching.
 */
export function huellaCobro(cuerpo: CuerpoCobro, tiendaResuelta: string): string {
  const base: unknown[] = [
    cuerpo.monto,
    cuerpo.moneda,
    cuerpo.descripcion,
    cuerpo.referencia,
    tiendaResuelta,
    cuerpo.vence_en_segundos,
    cuerpo.aviso_url,
  ];
  if (typeof cuerpo.datos === 'string') base.push(cuerpo.datos);
  const canonico = JSON.stringify(base);
  return createHash('sha256').update(canonico, 'utf8').digest('hex');
}

/**
 * The Cacao-Firma header of a notice: "t=<unix seconds>,v1=<HMAC-SHA256 hex of "<t>.<body>">. The key is the
 * client's notice secret, as text. The time is inside the signed text, so an old notice cannot be replayed.
 */
export function firmarAviso(secreto: string, cuerpo: string, ahoraSeg: number): string {
  const t = Math.floor(ahoraSeg);
  const v1 = createHmac('sha256', secreto).update(`${t}.${cuerpo}`, 'utf8').digest('hex');
  return `t=${t},v1=${v1}`;
}

/** Checks a Cacao-Firma header against the body, the secret and the time. False for any doubt. */
export function verificarFirmaAviso(
  cabecera: string | null,
  cuerpo: string,
  secreto: string,
  ahoraSeg: number,
  toleranciaSeg: number = TOLERANCIA_AVISO_SEG,
): boolean {
  if (!cabecera || !secreto) return false;
  const partes = /^t=(\d{1,12}),v1=([0-9a-f]{64})$/.exec(cabecera.trim());
  if (!partes) return false;
  const t = Number(partes[1]);
  if (Math.abs(Math.floor(ahoraSeg) - t) > toleranciaSeg) return false;
  const esperada = createHmac('sha256', secreto).update(`${t}.${cuerpo}`, 'utf8').digest('hex');
  const a = Buffer.from(partes[2], 'hex');
  const b = Buffer.from(esperada, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}
