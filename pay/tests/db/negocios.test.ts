import { createHash, randomBytes } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { sesionDe, servicio, usuarioNuevo, type Usuario } from './ayuda';

// CacaoPay para negocios in the database: one business per account, one activation at a time (a double tap makes no
// second store), one store and one client per business, the product of a client fixed, and a business that cannot read
// another's charges. The tests make their own accounts, so they share nothing.

const NULO = null as unknown as string;

function aleatorio(bytes = 9): string {
  return randomBytes(bytes).toString('base64url').replace(/[^A-Za-z0-9]/g, 'x');
}

// A BTCPay store id as the database checks it: 10 to 64 letters and digits.
function tiendaNueva(): string {
  return `T${aleatorio(12)}`;
}

type Reclamo = {
  situacion: 'activo' | 'en_curso' | 'reclamado';
  negocio: { id: string; nombre: string; tipo_negocio: string | null };
  activacion: { tienda_btcpay: string | null; cliente_id: string | null };
};

async function reclamar(usuario: Usuario, datos: { nombre?: string; tipo?: string; ubicacion?: string } = {}): Promise<Reclamo> {
  const { data, error } = await servicio().rpc('pay_negocio_reclamar', {
    p_usuario: usuario.id,
    p_nombre: datos.nombre ?? 'Café de prueba',
    p_tipo: datos.tipo ?? 'cafeteria',
    p_ubicacion: datos.ubicacion ?? 'Colonia Escalón, San Salvador',
  });
  if (error) throw error;
  return data as unknown as Reclamo;
}

// Makes the business's client the way the activation does: the store recorded, then the client in one step.
async function activarEnBase(usuario: Usuario) {
  const r = await reclamar(usuario);
  const negocioId = r.negocio.id;
  const tienda = tiendaNueva();
  const guardado = await servicio().rpc('pay_negocio_guardar_tienda', { p_negocio: negocioId, p_tienda: tienda });
  if (guardado.error) throw guardado.error;
  const clave = `cp_${randomBytes(24).toString('base64url')}`;
  const creado = await servicio().rpc('pay_negocio_crear_cliente', {
    p_negocio: negocioId,
    p_prefijo: clave.slice(0, 11),
    p_clave_hash: createHash('sha256').update(clave).digest('hex'),
    p_aviso_secreto: randomBytes(32).toString('hex'),
  });
  if (creado.error) throw creado.error;
  return { negocioId, tienda, clienteId: creado.data as unknown as string };
}

function huella(extra = ''): string {
  return createHash('sha256').update(`huella-${extra}-${aleatorio()}`).digest('hex');
}

async function cobrar(clienteId: string, tienda: string, clave = `caja-${aleatorio(10)}`) {
  const { data, error } = await servicio().rpc('pay_reservar_cobro', {
    p_cliente: clienteId,
    p_clave: clave,
    p_huella: huella(clave),
    p_tienda: tienda,
    p_moneda: 'USD',
    p_monto: 350,
    p_sats: 3500,
    p_usd_centavos: 350,
    p_cotizacion: 100_000,
    p_descripcion: 'Venta de prueba',
    p_referencia: `caja-${clave}`,
    p_aviso_url: NULO,
    p_vence_en_segundos: 900,
  });
  if (error) throw error;
  return (data as unknown as { situacion: string; cobro: { id: string; producto: string; cliente_id: string } }).cobro;
}

function codigoDe(error: { message: string } | null): string | null {
  return error ? (/^([A-Z_]+):/.exec(error.message)?.[1] ?? error.message) : null;
}

describe('una cuenta, un negocio', () => {
  it('dos toques seguidos: uno reclama la activación y el otro dice que ya se está haciendo', async () => {
    const usuario = await usuarioNuevo('Dueña de café');
    const [a, b] = await Promise.all([reclamar(usuario), reclamar(usuario)]);
    expect([a.situacion, b.situacion].sort()).toEqual(['en_curso', 'reclamado']);
    expect(a.negocio.id).toBe(b.negocio.id);

    const { count } = await servicio().from('negocios').select('id', { count: 'exact', head: true }).eq('usuario_id', usuario.id);
    expect(count).toBe(1);
  });

  it('un negocio ya activo no reclama de nuevo ni crea nada', async () => {
    const usuario = await usuarioNuevo('Dueño activo');
    const { negocioId } = await activarEnBase(usuario);
    const otra = await reclamar(usuario);
    expect(otra.situacion).toBe('activo');
    expect(otra.negocio.id).toBe(negocioId);
  });

  it('el tipo es obligatorio para un negocio nuevo y tiene que ser una de las cinco claves', async () => {
    const usuario = await usuarioNuevo('Sin tipo');
    const { error } = await servicio().rpc('pay_negocio_reclamar', {
      p_usuario: usuario.id,
      p_nombre: 'Tienda sin tipo',
      p_tipo: '',
      p_ubicacion: 'Santa Tecla',
    });
    expect(codigoDe(error)).toBe('DATOS_INVALIDOS');

    const otro = await usuarioNuevo('Tipo mal escrito');
    const malo = await servicio().rpc('pay_negocio_reclamar', {
      p_usuario: otro.id,
      p_nombre: 'Bar raro',
      p_tipo: 'bar',
      p_ubicacion: 'Santa Tecla',
    });
    expect(codigoDe(malo.error)).toBe('DATOS_INVALIDOS');
  });

  it('una activación sin tienda guardada no hace el cliente', async () => {
    const usuario = await usuarioNuevo('Sin tienda');
    const r = await reclamar(usuario);
    const clave = `cp_${randomBytes(24).toString('base64url')}`;
    const { error } = await servicio().rpc('pay_negocio_crear_cliente', {
      p_negocio: r.negocio.id,
      p_prefijo: clave.slice(0, 11),
      p_clave_hash: createHash('sha256').update(clave).digest('hex'),
      p_aviso_secreto: randomBytes(32).toString('hex'),
    });
    expect(codigoDe(error)).toBe('ESTADO_INVALIDO');
  });
});

describe('una tienda y un cliente por negocio', () => {
  it('la tienda se guarda una vez: guardar la misma otra vez no cambia nada, y otra tienda se rechaza', async () => {
    const usuario = await usuarioNuevo('Tienda única');
    const r = await reclamar(usuario);
    const primera = tiendaNueva();
    expect((await servicio().rpc('pay_negocio_guardar_tienda', { p_negocio: r.negocio.id, p_tienda: primera })).error).toBeNull();
    expect((await servicio().rpc('pay_negocio_guardar_tienda', { p_negocio: r.negocio.id, p_tienda: primera })).error).toBeNull();
    const otra = await servicio().rpc('pay_negocio_guardar_tienda', { p_negocio: r.negocio.id, p_tienda: tiendaNueva() });
    expect(codigoDe(otra.error)).toBe('ESTADO_INVALIDO');

    const { data } = await servicio().from('pay_negocios').select('tienda_btcpay').eq('negocio_id', r.negocio.id).single();
    expect(data?.tienda_btcpay).toBe(primera);
  });

  it('el cliente se hace una vez: repetir la activación devuelve el mismo cliente, sin uno nuevo', async () => {
    const usuario = await usuarioNuevo('Cliente único');
    const { negocioId, tienda, clienteId } = await activarEnBase(usuario);
    const clave = `cp_${randomBytes(24).toString('base64url')}`;
    const repetido = await servicio().rpc('pay_negocio_crear_cliente', {
      p_negocio: negocioId,
      p_prefijo: clave.slice(0, 11),
      p_clave_hash: createHash('sha256').update(clave).digest('hex'),
      p_aviso_secreto: randomBytes(32).toString('hex'),
    });
    expect(repetido.error).toBeNull();
    expect(repetido.data).toBe(clienteId);

    const { count } = await servicio()
      .from('pay_api_clientes')
      .select('id', { count: 'exact', head: true })
      .eq('tienda_btcpay', tienda);
    expect(count).toBe(1);
  });

  it('el cliente de un negocio cobra con el producto negocios, y la tienda que se guardó', async () => {
    const usuario = await usuarioNuevo('Producto del negocio');
    const { tienda, clienteId } = await activarEnBase(usuario);
    const { data } = await servicio().from('pay_api_clientes').select('producto, tienda_btcpay').eq('id', clienteId).single();
    expect(data).toEqual({ producto: 'negocios', tienda_btcpay: tienda });
  });
});

describe('el producto lo fija el cliente, no la petición', () => {
  it('un cliente se crea con su producto, y un producto desconocido se refuta', async () => {
    const clave = `cp_${randomBytes(24).toString('base64url')}`;
    const args = {
      p_nombre: 'Prueba de producto',
      p_prefijo: clave.slice(0, 11),
      p_clave_hash: createHash('sha256').update(clave).digest('hex'),
      p_tienda: tiendaNueva(),
      p_puede_elegir: false,
      p_aviso_secreto: randomBytes(32).toString('hex'),
      p_tiendas: [],
    };
    const malo = await servicio().rpc('pay_crear_cliente_api', { ...args, p_producto: 'tienda' });
    expect(codigoDe(malo.error)).toBe('DATOS_INVALIDOS');

    const bueno = await servicio().rpc('pay_crear_cliente_api', { ...args, p_producto: 'market' });
    expect(bueno.error).toBeNull();
    const { data } = await servicio().from('pay_api_clientes').select('producto').eq('id', bueno.data as unknown as string).single();
    expect(data?.producto).toBe('market');
  });

  it('el cobro lleva el producto del cliente: la cuenta de un negocio deja "negocios" en el cobro', async () => {
    const usuario = await usuarioNuevo('Cobro del negocio');
    const { clienteId, tienda } = await activarEnBase(usuario);
    const cobro = await cobrar(clienteId, tienda);
    expect(cobro.producto).toBe('negocios');
    expect(cobro.cliente_id).toBe(clienteId);
  });
});

describe('un negocio no lee los cobros de otro', () => {
  it('el cobro de un negocio no se lee ni se cancela desde otro cliente', async () => {
    const dueno = await usuarioNuevo('Dueña A');
    const otro = await usuarioNuevo('Dueño B');
    const a = await activarEnBase(dueno);
    const b = await activarEnBase(otro);
    const cobroA = await cobrar(a.clienteId, a.tienda);

    const leido = await servicio().rpc('pay_leer_cobro', { p_cliente: b.clienteId, p_id: cobroA.id });
    expect(leido.error).toBeNull();
    expect(leido.data).toBeNull();

    const cancelado = await servicio().rpc('pay_cancelar_cobro', { p_cliente: b.clienteId, p_id: cobroA.id });
    expect(codigoDe(cancelado.error)).toBe('NO_ENCONTRADA');

    const propio = await servicio().rpc('pay_leer_cobro', { p_cliente: a.clienteId, p_id: cobroA.id });
    expect((propio.data as unknown as { id: string } | null)?.id).toBe(cobroA.id);
  });

  it('una cuenta sin el servicio no lee la tabla de cobros, ni siquiera con su propia sesión', async () => {
    const dueno = await usuarioNuevo('Dueña C');
    const otro = await usuarioNuevo('Dueño D');
    const a = await activarEnBase(dueno);
    await activarEnBase(otro);
    const cobroA = await cobrar(a.clienteId, a.tienda);

    // The table has no grant for signed-in users: the server reads charges with the service role, after checking the
    // account. A signed-in business sees nothing here, not even its own charges, and never another's.
    const sesion = await sesionDe(otro);
    const { data, error } = await sesion.from('pay_cobros').select('id');
    expect(data ?? []).not.toContainEqual(expect.objectContaining({ id: cobroA.id }));
    if (!error) expect(data ?? []).toHaveLength(0);
  });
});

describe('el límite de la página pública', () => {
  it('cuenta por clave y corta al pasar el máximo; otra clave empieza en cero', async () => {
    const clave = `pagar-ip:${aleatorio(10)}`;
    const dentro = [];
    for (let i = 0; i < 3; i++) {
      const r = await servicio().rpc('pay_cuota_publica', { p_clave: clave, p_maximo: 3, p_ventana_segundos: 60 });
      dentro.push(r.data);
    }
    expect(dentro).toEqual([true, true, true]);
    const cuarta = await servicio().rpc('pay_cuota_publica', { p_clave: clave, p_maximo: 3, p_ventana_segundos: 60 });
    expect(cuarta.data).toBe(false);

    const otra = await servicio().rpc('pay_cuota_publica', { p_clave: `${clave}-otra`, p_maximo: 3, p_ventana_segundos: 60 });
    expect(otra.data).toBe(true);
  });
});
