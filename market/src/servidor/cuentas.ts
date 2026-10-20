import 'server-only';

import { esDireccionLightning } from '@/lib/lightning/direccion';

import { desdeError, exito, fallo, type Resultado } from './resultado';
import { clienteServicio, clienteSesion } from './supabase';

// Accounts and shops. Pages and actions pass the signed-in user's id; the database functions
// check it again. The checks here give the user a clear sentence before the round trip.

export type DatosNegocio = {
  nombre: string;
  descripcion: string;
  ubicacion: string;
  lightningAddress: string;
};

export type Negocio = DatosNegocio & {
  id: string;
  estado: 'pendiente' | 'aprobado' | 'suspendido';
  abierto: boolean;
  tipoProveedorPago: 'manual' | 'falso' | 'nwc' | 'blink' | 'btcpay';
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Length in code points, as the database counts characters.
function largo(texto: string): number {
  return Array.from(texto).length;
}

function esUuid(texto: string): boolean {
  return UUID.test(texto);
}

const NO_ENCONTRADA = fallo('NO_ENCONTRADA', 'No encontramos tu cuenta.');

/**
 * Eight digits, spaces and dashes allowed. The +503 prefix is accepted too, because the field
 * already shows it and people type it anyway. Returns the eight digits, or null.
 */
export function normalizarCelular(texto: string): string | null {
  let digitos = texto.replace(/[\s-]/g, '');
  if (/^\+503\d{8}$/.test(digitos)) digitos = digitos.slice(4);
  else if (/^503\d{8}$/.test(digitos)) digitos = digitos.slice(3);
  return /^\d{8}$/.test(digitos) ? digitos : null;
}

/**
 * A plausible email address, trimmed and lower-cased, at most 254 characters. Returns null when it
 * does not look like one. The mail server still makes the final call.
 */
export function normalizarCorreo(texto: string): string | null {
  const limpio = texto.trim().toLowerCase();
  if (limpio.length > 254) return null;
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(limpio) ? limpio : null;
}

/**
 * Where to send the visitor after sign-in. Only a path on this site; anything else goes to
 * the home page. This is the open-redirect guard, so keep it strict.
 */
export function destinoSeguro(volver: string | string[] | undefined | null): string {
  const texto = Array.isArray(volver) ? volver[0] : volver;
  if (!texto || texto.length > 300) return '/';
  if (!texto.startsWith('/') || texto.startsWith('//') || texto.includes('\\')) return '/';
  // Control characters (tabs, newlines) can change how browsers read the URL.
  if (/[\u0000-\u001f\u007f]/.test(texto)) return '/';
  const origen = 'http://interno.invalid';
  try {
    if (new URL(texto, origen).origin !== origen) return '/';
  } catch {
    return '/';
  }
  // Sign-in must not send the visitor back to sign-in again.
  if (texto === '/entrar' || texto.startsWith('/entrar?') || texto.startsWith('/entrar/')) return '/';
  return texto;
}

/** The profile page, carrying the visitor's destination so they land there after naming themselves. */
export function rutaCuenta(volver: string): string {
  return volver === '/' ? '/cuenta' : `/cuenta?volver=${encodeURIComponent(volver)}`;
}

/** The sign-in page, with the destination kept in `volver`. */
export function rutaEntrar(volver: string): string {
  return volver === '/' ? '/entrar' : `/entrar?volver=${encodeURIComponent(volver)}`;
}

/** The sign-up page, with the destination kept in `volver`. */
export function rutaRegistrarse(volver: string): string {
  return volver === '/' ? '/registrarse' : `/registrarse?volver=${encodeURIComponent(volver)}`;
}

/** The step after sign-in, which sends the visitor on with the destination kept in `volver`. */
export function rutaContinuar(volver: string): string {
  return volver === '/' ? '/continuar' : `/continuar?volver=${encodeURIComponent(volver)}`;
}

function validarNombre(nombre: string): Resultado<string> {
  const limpio = nombre.trim();
  if (largo(limpio) < 2 || largo(limpio) > 80) {
    return fallo('DATOS_INVALIDOS', 'El nombre tiene que tener entre 2 y 80 caracteres.');
  }
  return exito(limpio);
}

function validarDatosNegocio(datos: DatosNegocio): Resultado<DatosNegocio> {
  const nombre = datos.nombre.trim();
  const descripcion = datos.descripcion.trim();
  const ubicacion = datos.ubicacion.trim();
  const lightning = datos.lightningAddress.trim().toLowerCase();

  if (largo(nombre) < 2 || largo(nombre) > 80) {
    return fallo('DATOS_INVALIDOS', 'El nombre del negocio tiene que tener entre 2 y 80 caracteres.');
  }
  if (largo(descripcion) > 600) {
    return fallo('DATOS_INVALIDOS', 'La descripción no puede pasar de 600 caracteres.');
  }
  if (largo(ubicacion) > 160) {
    return fallo('DATOS_INVALIDOS', 'La ubicación no puede pasar de 160 caracteres.');
  }
  if (!esDireccionLightning(lightning)) {
    return fallo(
      'DATOS_INVALIDOS',
      'La Lightning Address no es válida. Tiene que parecerse a usuario@billetera.com.',
    );
  }
  return exito({ nombre, descripcion, ubicacion, lightningAddress: lightning });
}

// Column names match the rows the database functions return.
type FilaNegocio = {
  id: string;
  nombre: string;
  descripcion: string;
  ubicacion: string;
  estado: Negocio['estado'];
  abierto: boolean;
  tipo_proveedor_pago: Negocio['tipoProveedorPago'];
  lightning_address: string | null;
};

function aNegocio(fila: FilaNegocio): Negocio {
  return {
    id: fila.id,
    nombre: fila.nombre,
    descripcion: fila.descripcion,
    ubicacion: fila.ubicacion,
    estado: fila.estado,
    abierto: fila.abierto,
    tipoProveedorPago: fila.tipo_proveedor_pago,
    lightningAddress: fila.lightning_address ?? '',
  };
}

/** Sets the display name shown in the header and on orders. */
export async function actualizarPerfil(usuarioId: string, nombre: string): Promise<Resultado<{ nombre: string }>> {
  if (!esUuid(usuarioId)) return NO_ENCONTRADA;
  const valido = validarNombre(nombre);
  if (!valido.ok) return valido;

  const { data, error } = await clienteServicio().rpc('actualizar_perfil', {
    p_usuario: usuarioId,
    p_nombre: valido.dato,
  });
  if (error) return desdeError(error);
  return exito({ nombre: data.nombre });
}

/** Applies to sell. The shop starts as pendiente until an administrator approves it. */
export async function solicitarNegocio(usuarioId: string, datos: DatosNegocio): Promise<Resultado<Negocio>> {
  if (!esUuid(usuarioId)) return NO_ENCONTRADA;
  const valido = validarDatosNegocio(datos);
  if (!valido.ok) return valido;
  const d = valido.dato;

  const { data, error } = await clienteServicio().rpc('solicitar_negocio', {
    p_usuario: usuarioId,
    p_nombre: d.nombre,
    p_descripcion: d.descripcion,
    p_ubicacion: d.ubicacion,
    p_lightning_address: d.lightningAddress,
  });
  if (error) return desdeError(error);
  return exito(aNegocio(data));
}

/** Edits the shop, including whether it takes orders. The state is not editable here. */
export async function actualizarNegocio(
  usuarioId: string,
  datos: DatosNegocio & { abierto: boolean },
): Promise<Resultado<Negocio>> {
  if (!esUuid(usuarioId)) return NO_ENCONTRADA;
  if (typeof datos.abierto !== 'boolean') {
    return fallo('DATOS_INVALIDOS', 'Indicá si la tienda está abierta.');
  }
  const valido = validarDatosNegocio(datos);
  if (!valido.ok) return valido;
  const d = valido.dato;

  const { data, error } = await clienteServicio().rpc('actualizar_negocio', {
    p_usuario: usuarioId,
    p_nombre: d.nombre,
    p_descripcion: d.descripcion,
    p_ubicacion: d.ubicacion,
    p_lightning_address: d.lightningAddress,
    p_abierto: datos.abierto,
  });
  if (error) return desdeError(error);
  return exito(aNegocio(data));
}

/**
 * Opens or closes the shop. The database function wants every field, so the current values are
 * read first and sent back unchanged.
 */
export async function cambiarAbierto(usuarioId: string, abierto: boolean): Promise<Resultado<Negocio>> {
  if (!esUuid(usuarioId)) return NO_ENCONTRADA;
  if (typeof abierto !== 'boolean') return fallo('DATOS_INVALIDOS', 'Indicá si la tienda está abierta.');

  const actual = await miNegocio(usuarioId);
  if (!actual.ok) return actual;
  if (!actual.dato) return fallo('NO_ENCONTRADA', 'No encontramos tu negocio.');

  return actualizarNegocio(usuarioId, { ...actual.dato, abierto });
}

/** The signed-in user's shop, or null when they have not applied. Only the owner can read it. */
export async function miNegocio(usuarioId: string): Promise<Resultado<Negocio | null>> {
  if (!esUuid(usuarioId)) return NO_ENCONTRADA;

  const supabase = await clienteSesion();
  const { data, error } = await supabase
    .from('negocios')
    .select('id, nombre, descripcion, ubicacion, estado, abierto, tipo_proveedor_pago, lightning_address')
    .eq('usuario_id', usuarioId)
    .maybeSingle();
  if (error) return desdeError(error);
  return exito(data ? aNegocio(data) : null);
}
