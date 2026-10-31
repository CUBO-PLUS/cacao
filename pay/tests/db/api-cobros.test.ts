import { createHash, randomBytes } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { autenticar, entrar } from '@/servidor/api-cobros';

import { servicio } from './ayuda';

// The payments API in the database: idempotent charges, store and client rules, the cancel-versus-paid race, the
// notice outbox and the limit per key. Each test makes its own clients, so the tests share nothing.

const NULO = null as unknown as string;
const ESTADO_INVALIDO = /ESTADO_INVALIDO/;

function aleatorio(bytes = 9): string {
  return randomBytes(bytes).toString('base64url').replace(/[^A-Za-z0-9]/g, 'x');
}

type Cliente = { id: string; prefijo: string; clave: string; tienda: string; producto: string };

// A client as the script creates it: a key shown once (here, kept by the test), its hash, and a notice secret.
async function clienteNuevo(opciones: { puedeElegir?: boolean; tiendas?: string[]; producto?: string } = {}): Promise<Cliente> {
  const producto = opciones.producto ?? 'pay';
  const clave = `cp_${randomBytes(24).toString('base64url')}`;
  const tienda = `T${aleatorio(12)}`;
  const { data, error } = await servicio().rpc('pay_crear_cliente_api', {
    p_nombre: 'Cliente de prueba',
    p_prefijo: clave.slice(0, 11),
    p_clave_hash: createHash('sha256').update(clave).digest('hex'),
    p_tienda: tienda,
    p_puede_elegir: opciones.puedeElegir ?? false,
    p_aviso_secreto: randomBytes(32).toString('hex'),
    p_producto: producto,
    p_tiendas: opciones.tiendas ?? [],
  });
  if (error) throw error;
  return { id: data as unknown as string, prefijo: clave.slice(0, 11), clave, tienda, producto };
}

function huella(extra = ''): string {
  return createHash('sha256').update(`huella-${extra}-${aleatorio()}`).digest('hex');
}

type Reserva = { situacion: string; cobro: { id: string; btcpay_factura_id: string | null; estado: string; aviso_url: string | null } };

// The arguments of a charge as the server sends them, with a fixed sat amount.
function argsReserva(cliente: Cliente, clave: string, cambios: Partial<Record<string, unknown>> = {}) {
  return {
    p_cliente: cliente.id,
    p_clave: clave,
    p_huella: huella(clave),
    p_tienda: cliente.tienda,
    p_moneda: 'USD',
    p_monto: 1500,
    p_sats: 15_000,
    p_usd_centavos: 1500,
    p_cotizacion: 100_000,
    p_descripcion: 'Pupusas',
    p_referencia: 'pedido-1',
    p_aviso_url: NULO,
    p_vence_en_segundos: 3600,
    ...cambios,
  };
}

async function reservar(args: ReturnType<typeof argsReserva>): Promise<Reserva> {
  const { data, error } = await servicio().rpc('pay_reservar_cobro', args);
  if (error) throw error;
  return data as unknown as Reserva;
}

// Makes the invoice of a reserved charge, as the server does after the reservation.
async function conFactura(cobroId: string): Promise<{ facturaId: string }> {
  const facturaId = `F${aleatorio(12)}`;
  const { error } = await servicio().rpc('pay_registrar_factura_cobro', {
    p_id: cobroId,
    p_factura_id: facturaId,
    p_factura: `lnbcrt${aleatorio(10).toLowerCase()}`,
    p_expira: new Date(Date.now() + 3600_000).toISOString(),
  });
  if (error) throw error;
  return { facturaId };
}

async function cobroCreado(cliente: Cliente, clave: string) {
  const reserva = await reservar(argsReserva(cliente, clave));
  const { facturaId } = await conFactura(reserva.cobro.id);
  return { id: reserva.cobro.id, facturaId };
}

async function leerCobroDb(id: string): Promise<{ estado: string; pago_tardio_en: string | null; aviso_url: string | null }> {
  const { data, error } = await servicio().from('pay_cobros').select('estado, pago_tardio_en, aviso_url').eq('id', id).single();
  if (error) throw error;
  return data;
}

// Claims one notice, as the sender does, and returns the claim (with its token).
async function reclamarAviso(avisoId: string): Promise<{ token: string }[]> {
  const { data, error } = await servicio().rpc('pay_reclamar_avisos', { p_limite: 1, p_duracion_segundos: 120, p_aviso: avisoId });
  if (error) throw error;
  return data ?? [];
}

async function contarAvisos(cobroId: string): Promise<number> {
  const { count, error } = await servicio().from('pay_avisos').select('id', { count: 'exact', head: true }).eq('cobro_id', cobroId);
  if (error) throw error;
  return count ?? 0;
}

describe('idempotencia de los cobros', () => {
  it('dos creaciones simultáneas con la misma clave dejan un solo cobro y una sola factura', async () => {
    const cliente = await clienteNuevo();
    const clave = `clave-${aleatorio(8)}`;
    const args = argsReserva(cliente, clave, { p_huella: huella('mismo') });

    const resultados = await Promise.allSettled([reservar(args), reservar(args), reservar(args)]);
    const ganadas = resultados.filter((r) => r.status === 'fulfilled');
    const perdidas = resultados.filter((r) => r.status === 'rejected');

    expect(ganadas).toHaveLength(1);
    expect((ganadas[0] as PromiseFulfilledResult<Reserva>).value.situacion).toBe('nuevo');
    for (const p of perdidas) {
      expect((p as PromiseRejectedResult).reason.message).toMatch(/IDEMPOTENCIA_EN_CURSO/);
    }

    const { count } = await servicio().from('pay_cobros').select('id', { count: 'exact', head: true }).eq('cliente_id', cliente.id);
    expect(count).toBe(1);
  });

  it('una repetición después de la factura devuelve el primer cobro, sin una factura nueva', async () => {
    const cliente = await clienteNuevo();
    const clave = `clave-${aleatorio(8)}`;
    const primera = await reservar(argsReserva(cliente, clave));
    const { facturaId } = await conFactura(primera.cobro.id);

    const repetida = await reservar(argsReserva(cliente, clave, { p_huella: await huellaDe(primera.cobro.id) }));
    expect(repetida.situacion).toBe('existente');
    expect(repetida.cobro.id).toBe(primera.cobro.id);
    expect(repetida.cobro.btcpay_factura_id).toBe(facturaId);
  });

  it('la misma clave con otro cuerpo se rechaza', async () => {
    const cliente = await clienteNuevo();
    const clave = `clave-${aleatorio(8)}`;
    await reservar(argsReserva(cliente, clave));
    await expect(reservar(argsReserva(cliente, clave, { p_monto: 2000, p_usd_centavos: 2000 }))).rejects.toThrow(/IDEMPOTENCIA_CONFLICTO/);
  });

  it('una reserva sin factura que se quedó a medias se retoma después de un minuto', async () => {
    const cliente = await clienteNuevo();
    const clave = `clave-${aleatorio(8)}`;
    const primera = await reservar(argsReserva(cliente, clave));
    await servicio().from('pay_cobros').update({ actualizado_en: new Date(Date.now() - 120_000).toISOString() }).eq('id', primera.cobro.id);
    const retomada = await reservar(argsReserva(cliente, clave, { p_huella: await huellaDe(primera.cobro.id) }));
    expect(retomada.situacion).toBe('retomar');
    expect(retomada.cobro.id).toBe(primera.cobro.id);
  });

  it('una reserva que BTCPay rechazó se libera y la clave puede volver a empezar', async () => {
    const cliente = await clienteNuevo();
    const clave = `clave-${aleatorio(8)}`;
    const primera = await reservar(argsReserva(cliente, clave));
    const { data: liberada } = await servicio().rpc('pay_liberar_reserva', { p_id: primera.cobro.id });
    expect(liberada).toBe(true);
    const nueva = await reservar(argsReserva(cliente, clave));
    expect(nueva.situacion).toBe('nuevo');
  });

  it('una factura ya registrada no se libera', async () => {
    const cliente = await clienteNuevo();
    const cobro = await cobroCreado(cliente, `clave-${aleatorio(8)}`);
    const { data: liberada } = await servicio().rpc('pay_liberar_reserva', { p_id: cobro.id });
    expect(liberada).toBe(false);
  });
});

// The fingerprint a repeat must match: the fingerprint of the first request, read back from the row.
async function huellaDe(cobroId: string): Promise<string> {
  const { data, error } = await servicio().from('pay_cobros').select('huella').eq('id', cobroId).single();
  if (error) throw error;
  return data.huella;
}

describe('lectura y tienda por cliente', () => {
  it('un cliente no lee el cobro de otro: el otro recibe nada', async () => {
    const dueno = await clienteNuevo();
    const ajeno = await clienteNuevo();
    const cobro = await cobroCreado(dueno, `clave-${aleatorio(8)}`);

    const { data: propio } = await servicio().rpc('pay_leer_cobro', { p_cliente: dueno.id, p_id: cobro.id });
    expect((propio as { id?: string } | null)?.id).toBe(cobro.id);

    const { data: ajenoLeido } = await servicio().rpc('pay_leer_cobro', { p_cliente: ajeno.id, p_id: cobro.id });
    expect(ajenoLeido).toBeNull();
  });

  it('un cliente no cobra en la tienda de otro', async () => {
    const cliente = await clienteNuevo();
    const otro = await clienteNuevo();
    await expect(reservar(argsReserva(cliente, `clave-${aleatorio(8)}`, { p_tienda: otro.tienda }))).rejects.toThrow(/NO_PERMITIDO/);
  });

  it('una clave que puede elegir tienda cobra solo en las tiendas que tiene asignadas', async () => {
    const otraPermitida = `P${aleatorio(12)}`;
    const otraNo = `N${aleatorio(12)}`;
    const cliente = await clienteNuevo({ puedeElegir: true, tiendas: [otraPermitida] });

    const enPermitida = await reservar(argsReserva(cliente, `clave-${aleatorio(8)}`, { p_tienda: otraPermitida }));
    expect(enPermitida.situacion).toBe('nuevo');
    await expect(reservar(argsReserva(cliente, `clave-${aleatorio(8)}`, { p_tienda: otraNo }))).rejects.toThrow(/NO_PERMITIDO/);
  });

  it('una clave sin permiso de elegir no puede tener tiendas asignadas', async () => {
    await expect(clienteNuevo({ puedeElegir: false, tiendas: [`P${aleatorio(12)}`] })).rejects.toThrow(/DATOS_INVALIDOS/);
  });
});

describe('claves revocadas y límite por clave', () => {
  it('una clave revocada no entra, y una clave válida sí', async () => {
    const cliente = await clienteNuevo();
    const cabecera = `Bearer ${cliente.clave}`;
    expect((await autenticar(cabecera)).ok).toBe(true);

    const { data: revocada } = await servicio().rpc('pay_revocar_cliente_api', { p_prefijo: cliente.prefijo });
    expect(revocada).toBe(true);

    const despues = await autenticar(cabecera);
    expect(despues.ok).toBe(false);
    if (!despues.ok) expect(despues.codigo).toBe('NO_AUTORIZADO');
  });

  it('una clave con otro secreto y el mismo prefijo no entra', async () => {
    const cliente = await clienteNuevo();
    const falsa = cliente.clave.slice(0, 11) + 'x'.repeat(21);
    const r = await autenticar(`Bearer ${falsa}`);
    expect(r.ok).toBe(false);
  });

  it('la cuota por clave corta en el límite y vuelve a contar en el minuto siguiente', async () => {
    const cliente = await clienteNuevo();
    const cuenta = async () => (await servicio().rpc('pay_api_cuota', { p_cliente: cliente.id, p_maximo: 3 })).data;
    expect(await cuenta()).toBe(true);
    expect(await cuenta()).toBe(true);
    expect(await cuenta()).toBe(true);
    expect(await cuenta()).toBe(false);

    await servicio().from('pay_api_clientes').update({ cuota_ventana_en: new Date(Date.now() - 61_000).toISOString() }).eq('id', cliente.id);
    expect(await cuenta()).toBe(true);
  });

  it('la entrada con una clave revocada responde NO_AUTORIZADO y no cuenta la cuota', async () => {
    const cliente = await clienteNuevo();
    await servicio().rpc('pay_revocar_cliente_api', { p_prefijo: cliente.prefijo });
    const r = await entrar(`Bearer ${cliente.clave}`);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.codigo).toBe('NO_AUTORIZADO');
    const { data } = await servicio().from('pay_api_clientes').select('cuota_usos').eq('id', cliente.id).single();
    expect(data?.cuota_usos).toBe(0);
  });
});

describe('cancelar frente a pagar', () => {
  it('un cobro pagado no se cancela', async () => {
    const cliente = await clienteNuevo();
    const cobro = await cobroCreado(cliente, `clave-${aleatorio(8)}`);
    await servicio().rpc('pay_aplicar_btcpay', { p_factura_id: cobro.facturaId, p_estado: 'Settled', p_hash: NULO });
    const { error } = await servicio().rpc('pay_cancelar_cobro', { p_cliente: cliente.id, p_id: cobro.id });
    expect(error?.message).toMatch(ESTADO_INVALIDO);
  });

  it('cancelar y pagar a la vez: gana uno solo, y el resultado es coherente', async () => {
    for (let vuelta = 0; vuelta < 6; vuelta++) {
      const cliente = await clienteNuevo();
      const cobro = await cobroCreado(cliente, `clave-${aleatorio(8)}`);

      const [cancelar, pagar] = await Promise.allSettled([
        servicio().rpc('pay_cancelar_cobro', { p_cliente: cliente.id, p_id: cobro.id }),
        servicio().rpc('pay_aplicar_btcpay', { p_factura_id: cobro.facturaId, p_estado: 'Settled', p_hash: NULO }),
      ]);
      const cancelado = cancelar.status === 'fulfilled' && cancelar.value.error === null;
      const final = await leerCobroDb(cobro.id);

      if (cancelado) {
        // The cancel came first: the charge is cancelled, and a payment that came after is recorded as late.
        expect(final.estado).toBe('cancelado');
      } else {
        // The payment came first: the cancel is refused and the charge is paid.
        expect(final.estado).toBe('pagado');
        if (cancelar.status === 'fulfilled') expect(cancelar.value.error?.message).toMatch(ESTADO_INVALIDO);
      }
      expect(pagar.status).toBe('fulfilled');
    }
  });

  it('un pago que llega a un cobro cancelado queda como pago tardío y no cambia el estado', async () => {
    const cliente = await clienteNuevo();
    const cobro = await cobroCreado(cliente, `clave-${aleatorio(8)}`);
    await servicio().rpc('pay_cancelar_cobro', { p_cliente: cliente.id, p_id: cobro.id });
    const { data } = await servicio().rpc('pay_aplicar_btcpay', { p_factura_id: cobro.facturaId, p_estado: 'Settled', p_hash: NULO });
    const r = data as unknown as { cambio: boolean };
    expect(r.cambio).toBe(false);
    const final = await leerCobroDb(cobro.id);
    expect(final.estado).toBe('cancelado');
    expect(final.pago_tardio_en).not.toBeNull();
  });

  it('cancelar dos veces no cambia nada la segunda vez', async () => {
    const cliente = await clienteNuevo();
    const cobro = await cobroCreado(cliente, `clave-${aleatorio(8)}`);
    const primera = await servicio().rpc('pay_cancelar_cobro', { p_cliente: cliente.id, p_id: cobro.id });
    const segunda = await servicio().rpc('pay_cancelar_cobro', { p_cliente: cliente.id, p_id: cobro.id });
    expect((primera.data as unknown as { cambio: boolean }).cambio).toBe(true);
    expect((segunda.data as unknown as { cambio: boolean }).cambio).toBe(false);
  });

  it('otro cliente no cancela el cobro', async () => {
    const dueno = await clienteNuevo();
    const ajeno = await clienteNuevo();
    const cobro = await cobroCreado(dueno, `clave-${aleatorio(8)}`);
    const { error } = await servicio().rpc('pay_cancelar_cobro', { p_cliente: ajeno.id, p_id: cobro.id });
    expect(error?.message).toMatch(/NO_ENCONTRADA/);
  });
});

describe('estados de BTCPay y avisos', () => {
  it('un pago pasa el cobro a pagado una sola vez, y un aviso por estado', async () => {
    const cliente = await clienteNuevo();
    const url = 'https://market.ejemplo.com/avisos';
    const reserva = await reservar(argsReserva(cliente, `clave-${aleatorio(8)}`, { p_aviso_url: url }));
    const { facturaId } = await conFactura(reserva.cobro.id);

    const primera = await servicio().rpc('pay_aplicar_btcpay', { p_factura_id: facturaId, p_estado: 'Settled', p_hash: NULO });
    const segunda = await servicio().rpc('pay_aplicar_btcpay', { p_factura_id: facturaId, p_estado: 'Settled', p_hash: NULO });
    expect((primera.data as unknown as { cambio: boolean; aviso_id: string | null }).cambio).toBe(true);
    expect((primera.data as unknown as { aviso_id: string | null }).aviso_id).not.toBeNull();
    expect((segunda.data as unknown as { cambio: boolean }).cambio).toBe(false);
    expect((await leerCobroDb(reserva.cobro.id)).estado).toBe('pagado');
    expect(await contarAvisos(reserva.cobro.id)).toBe(1);
  });

  it('un cobro sin aviso no crea aviso, y el vencimiento pasa a vencido', async () => {
    const cliente = await clienteNuevo();
    const cobro = await cobroCreado(cliente, `clave-${aleatorio(8)}`);
    const { data } = await servicio().rpc('pay_aplicar_btcpay', { p_factura_id: cobro.facturaId, p_estado: 'Expired', p_hash: NULO });
    expect((data as unknown as { cambio: boolean; aviso_id: string | null }).aviso_id).toBeNull();
    expect((await leerCobroDb(cobro.id)).estado).toBe('vencido');
    expect(await contarAvisos(cobro.id)).toBe(0);
  });

  it('cancelar un cobro con aviso deja un aviso de cancelado, y no se repite', async () => {
    const cliente = await clienteNuevo();
    const reserva = await reservar(argsReserva(cliente, `clave-${aleatorio(8)}`, { p_aviso_url: 'https://market.ejemplo.com/a' }));
    await conFactura(reserva.cobro.id);
    await servicio().rpc('pay_cancelar_cobro', { p_cliente: cliente.id, p_id: reserva.cobro.id });
    await servicio().rpc('pay_cancelar_cobro', { p_cliente: cliente.id, p_id: reserva.cobro.id });
    expect(await contarAvisos(reserva.cobro.id)).toBe(1);
    const { data } = await servicio().from('pay_avisos').select('estado').eq('cobro_id', reserva.cobro.id).single();
    expect(data?.estado).toBe('cancelado');
  });

  it('un intento fallido cuenta y el aviso queda pendiente; uno entregado no se vuelve a cerrar', async () => {
    const cliente = await clienteNuevo();
    const reserva = await reservar(argsReserva(cliente, `clave-${aleatorio(8)}`, { p_aviso_url: 'https://market.ejemplo.com/a' }));
    const { facturaId } = await conFactura(reserva.cobro.id);
    const { data } = await servicio().rpc('pay_aplicar_btcpay', { p_factura_id: facturaId, p_estado: 'Settled', p_hash: NULO });
    const avisoId = (data as unknown as { aviso_id: string }).aviso_id;

    const [reclamo] = await reclamarAviso(avisoId);
    const fallido = await servicio().rpc('pay_cerrar_aviso', { p_aviso: avisoId, p_token: reclamo.token, p_ok: false, p_error: 'El receptor respondió 500.' });
    expect(fallido.data).toBe('pendiente');
    const entregado = await servicio().rpc('pay_cerrar_aviso', { p_aviso: avisoId, p_token: reclamo.token, p_ok: true, p_error: NULO });
    expect(entregado.data).toBe('entregado');
    const repetido = await servicio().rpc('pay_cerrar_aviso', { p_aviso: avisoId, p_token: reclamo.token, p_ok: false, p_error: 'otro' });
    expect(repetido.data).toBe('entregado');

    const { data: fila } = await servicio().from('pay_avisos').select('intentos, enviado_en, ultimo_error, entrega').eq('id', avisoId).single();
    expect(fila?.intentos).toBe(1);
    expect(fila?.entrega).toBe('entregado');
    expect(fila?.enviado_en).not.toBeNull();
    expect(fila?.ultimo_error).toBeNull();
  });

  it('un estado que no corresponde al cobro no cambia nada', async () => {
    const cliente = await clienteNuevo();
    const cobro = await cobroCreado(cliente, `clave-${aleatorio(8)}`);
    await servicio().rpc('pay_aplicar_btcpay', { p_factura_id: cobro.facturaId, p_estado: 'Settled', p_hash: NULO });
    const { data } = await servicio().rpc('pay_aplicar_btcpay', { p_factura_id: cobro.facturaId, p_estado: 'Expired', p_hash: NULO });
    expect((data as unknown as { cambio: boolean }).cambio).toBe(false);
    expect((await leerCobroDb(cobro.id)).estado).toBe('pagado');
  });

  it('una factura que no es de ningún cobro se rechaza', async () => {
    const { error } = await servicio().rpc('pay_aplicar_btcpay', { p_factura_id: `N${aleatorio(12)}`, p_estado: 'Settled', p_hash: NULO });
    expect(error?.message).toMatch(/NO_ENCONTRADA/);
  });

  it('una factura con datos mal formados no se registra', async () => {
    const cliente = await clienteNuevo();
    const reserva = await reservar(argsReserva(cliente, `clave-${aleatorio(8)}`));
    const { error } = await servicio().rpc('pay_registrar_factura_cobro', {
      p_id: reserva.cobro.id,
      p_factura_id: `F${aleatorio(12)}`,
      p_factura: 'no-es-bolt11',
      p_expira: new Date(Date.now() + 3600_000).toISOString(),
    });
    expect(error?.message).toMatch(/DATOS_INVALIDOS/);
  });
});
