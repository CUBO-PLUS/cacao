import { createHash, randomBytes } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { huellaCobro, validarCuerpoCobro } from '@/lib/api-cobros';

import { servicio } from './ayuda';

// The datos of a charge in the database: the owner reads them, another client does not, a repeat of the key with other
// datos is refused, and the database refuses a datos that is not an object or is too big.

const NULO = null as unknown as string;

function aleatorio(bytes = 9): string {
  return randomBytes(bytes).toString('base64url').replace(/[^A-Za-z0-9]/g, 'x');
}

type Cliente = { id: string; tienda: string };

async function clienteNuevo(): Promise<Cliente> {
  const clave = `cp_${randomBytes(24).toString('base64url')}`;
  const tienda = `T${aleatorio(12)}`;
  const { data, error } = await servicio().rpc('pay_crear_cliente_api', {
    p_nombre: 'Cliente de datos',
    p_prefijo: clave.slice(0, 11),
    p_clave_hash: createHash('sha256').update(clave).digest('hex'),
    p_tienda: tienda,
    p_puede_elegir: false,
    p_aviso_secreto: randomBytes(32).toString('hex'),
    p_producto: 'travel',
    p_tiendas: [],
  });
  if (error) throw error;
  return { id: data as unknown as string, tienda };
}

// The fingerprint the server computes for a body with these datos (the same function the route uses).
function huellaDe(tienda: string, datos: unknown, referencia = 'ABCDEF12'): string {
  const r = validarCuerpoCobro(
    { monto: 1500, moneda: 'USD', descripcion: 'Reserva de prueba', referencia, datos },
    { desarrollo: false },
  );
  if (!r.ok) throw new Error(r.mensaje);
  return huellaCobro(r.dato, tienda);
}

type Args = {
  p_cliente: string;
  p_clave: string;
  p_huella: string;
  p_tienda: string;
  p_datos?: string | null;
};

function argsDe(cliente: Cliente, clave: string, datos: unknown, huella = huellaDe(cliente.tienda, datos)): Args {
  return { p_cliente: cliente.id, p_clave: clave, p_huella: huella, p_tienda: cliente.tienda, p_datos: datos === undefined ? NULO : JSON.stringify(datos) };
}

const reservarArgs = (args: Args) =>
  servicio().rpc('pay_reservar_cobro', {
    p_moneda: 'USD',
    p_monto: 1500,
    p_sats: 15_000,
    p_usd_centavos: 1500,
    p_cotizacion: 100_000,
    p_descripcion: 'Reserva de prueba',
    p_referencia: 'ABCDEF12',
    p_aviso_url: NULO,
    p_vence_en_segundos: 3600,
    ...args,
  });

describe('datos de los cobros', () => {
  it('el dueño lee sus datos tal como los mandó, y otro cliente no encuentra el cobro', async () => {
    const dueno = await clienteNuevo();
    const otro = await clienteNuevo();
    const clave = `clave-${aleatorio(8)}`;
    const datos = { tour: 'el-lago', fecha: '2026-11-20', personas: 2, total: 90000 };
    const { data, error } = await reservarArgs(argsDe(dueno, clave, datos));
    expect(error).toBeNull();
    const cobro = (data as unknown as { cobro: { id: string; datos: string } }).cobro;
    expect(JSON.parse(cobro.datos)).toEqual(datos);

    const leido = await servicio().rpc('pay_leer_cobro', { p_cliente: dueno.id, p_id: cobro.id });
    expect(leido.error).toBeNull();
    expect(JSON.parse((leido.data as unknown as { datos: string }).datos)).toEqual(datos);

    const ajeno = await servicio().rpc('pay_leer_cobro', { p_cliente: otro.id, p_id: cobro.id });
    expect(ajeno.data).toBeNull();
  });

  it('un cobro sin datos guarda null', async () => {
    const cliente = await clienteNuevo();
    const { data, error } = await reservarArgs(argsDe(cliente, `clave-${aleatorio(8)}`, undefined));
    expect(error).toBeNull();
    expect((data as unknown as { cobro: { datos: unknown } }).cobro.datos).toBeNull();
  });

  it('la misma clave con otros datos se refusa; con los mismos, devuelve el cobro original', async () => {
    const cliente = await clienteNuevo();
    const clave = `clave-${aleatorio(8)}`;
    const primera = await reservarArgs(argsDe(cliente, clave, { tour: 'a', personas: 2 }));
    expect(primera.error).toBeNull();
    const cobro = (primera.data as unknown as { cobro: { id: string } }).cobro;
    await servicio().rpc('pay_registrar_factura_cobro', {
      p_id: cobro.id,
      p_factura_id: `F${aleatorio(12)}`,
      p_factura: `lnbcrt${aleatorio(10).toLowerCase()}`,
      p_expira: new Date(Date.now() + 3600_000).toISOString(),
    });

    const otros = await reservarArgs(argsDe(cliente, clave, { tour: 'a', personas: 3 }));
    expect(otros.error?.message ?? '').toMatch(/IDEMPOTENCIA_CONFLICTO/);

    const mismos = await reservarArgs(argsDe(cliente, clave, { personas: 2, tour: 'a' }));
    expect(mismos.error).toBeNull();
    expect((mismos.data as unknown as { situacion: string }).situacion).toBe('existente');
    expect((mismos.data as unknown as { cobro: { id: string } }).cobro.id).toBe(cobro.id);
  });

  it('la base refusa datos que no son un objeto o pasan de 2000 bytes', async () => {
    const cliente = await clienteNuevo();
    const huella = huellaDe(cliente.tienda, { tour: 'a' });
    const lista = await reservarArgs({ ...argsDe(cliente, `clave-${aleatorio(8)}`, undefined, huella), p_datos: '[1,2]' });
    expect(lista.error?.message ?? '').toMatch(/DATOS_INVALIDOS/);
    const grande = JSON.stringify({ texto: 'a'.repeat(2000) });
    const pesado = await reservarArgs({ ...argsDe(cliente, `clave-${aleatorio(8)}`, undefined, huella), p_datos: grande });
    expect(pesado.error?.message ?? '').toMatch(/DATOS_INVALIDOS/);
  });
});
