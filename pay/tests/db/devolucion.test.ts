import { randomBytes } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { crearEnvio } from '@/servidor/transferencias';

import { datosEnvio, filaEnvio, ok, servicio, sufijo, usuarioNuevo, type Usuario } from './ayuda';

// The claim window and the refund of a paid Lightning transfer, in the database. The window is 7 days from the
// payment; a claim is taken only inside it, a refund only after it, and one payout reserves the transfer at a time.

// The database takes a null for the optional parameters, but the generated types say string.
const NULO = null as unknown as string;
const DIA_MS = 24 * 60 * 60 * 1000;

function hashNuevo(): string {
  return randomBytes(32).toString('hex');
}

// A factura for these sats, in the form the database accepts.
function facturaPara(sats: number): string {
  return `lnbcrt${sats}u1${sufijo()}${sufijo()}`;
}

// A Lightning transfer that the sender has paid: the invoice is registered and BTCPay has settled it, so the
// transfer is "procesando" and waits for the recipient. The sender paid a little more than the recipient gets,
// so a refund must return what was paid (factura_sats), not the amount of the transfer.
async function envioPagado(remitente: Usuario): Promise<{ id: string; sats: number; pagado: number; cobroToken: string }> {
  const envio = ok(await crearEnvio(remitente.id, datosEnvio(remitente, { entrega: 'lightning', monedaOrigen: 'USD', montoOrigenCentavos: 10_000 })));
  const fila = await filaEnvio(envio.id);
  const sats = Number(fila.monto_destino);
  const pagado = sats + 137;
  const facturaId = `f${sufijo()}${sufijo()}`;
  const { error: errorRegistro } = await servicio().rpc('pay_registrar_factura', {
    p_transferencia: envio.id,
    p_actor: remitente.id,
    p_factura_id: facturaId,
    p_tienda: `t${sufijo()}${sufijo()}`,
    p_factura: facturaPara(pagado),
    p_sats: pagado,
    p_expira: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    p_usd_centavos: 10_000,
  });
  if (errorRegistro) throw errorRegistro;
  const { error: errorPago } = await servicio().rpc('pay_confirmar_btcpay', { p_factura_id: facturaId });
  if (errorPago) throw errorPago;
  return { id: envio.id, sats, pagado, cobroToken: fila.cobro_token as string };
}

// Moves the window's end into the past, as if 7 days had gone by.
async function vencerVentana(envioId: string): Promise<void> {
  const { error } = await servicio()
    .from('pay_transferencias')
    .update({ cobro_vence_en: new Date(Date.now() - 60_000).toISOString() })
    .eq('id', envioId);
  if (error) throw error;
}

function iniciarCobro(token: string, sats: number) {
  return servicio().rpc('pay_iniciar_cobro', { p_token: token, p_factura: facturaPara(sats), p_sats: sats, p_hash: hashNuevo() });
}

function iniciarDevolucion(envioId: string, actor: string | null, sats: number) {
  return servicio().rpc('pay_iniciar_devolucion', {
    p_transferencia: envioId,
    p_actor: actor ?? NULO,
    p_factura: facturaPara(sats),
    p_sats: sats,
    p_hash: hashNuevo(),
  });
}

describe('la ventana de cobro', () => {
  it('dura 7 días desde que se pagó, y la base lo escribe al pagar', async () => {
    const remitente = await usuarioNuevo('Lucía');
    const envio = await envioPagado(remitente);
    const fila = await filaEnvio(envio.id);
    expect(Date.parse(fila.cobro_vence_en ?? '') - Date.parse(fila.pagada_en ?? '')).toBe(7 * DIA_MS);
  });

  it('dentro de la ventana, el cobro entra y la devolución no', async () => {
    const remitente = await usuarioNuevo('Lucía');
    const envio = await envioPagado(remitente);

    const cobro = await iniciarCobro(envio.cobroToken, envio.sats);
    expect(cobro.error).toBeNull();

    const devolucion = await iniciarDevolucion(envio.id, remitente.id, envio.pagado);
    expect(devolucion.error?.message).toMatch(/^ESTADO_INVALIDO: Hay un cobro en curso/);
  });

  it('vencida la ventana, el cobro se rechaza con el enlace vencido', async () => {
    const remitente = await usuarioNuevo('Lucía');
    const envio = await envioPagado(remitente);
    await vencerVentana(envio.id);

    const cobro = await iniciarCobro(envio.cobroToken, envio.sats);
    expect(cobro.error?.message).toMatch(/^COBRO_VENCIDO: /);
  });

  it('antes de vencer, la devolución se rechaza', async () => {
    const remitente = await usuarioNuevo('Lucía');
    const envio = await envioPagado(remitente);
    const devolucion = await iniciarDevolucion(envio.id, remitente.id, envio.pagado);
    expect(devolucion.error?.message).toMatch(/^PLAZO_VIGENTE: /);
  });
});

describe('la devolución del envío sin cobrar', () => {
  it('solo quien envió puede recuperar el dinero', async () => {
    const remitente = await usuarioNuevo('Lucía');
    const otra = await usuarioNuevo('Rosa');
    const envio = await envioPagado(remitente);
    await vencerVentana(envio.id);

    const ajena = await iniciarDevolucion(envio.id, otra.id, envio.pagado);
    expect(ajena.error?.message).toMatch(/^NO_PERMITIDO: /);
    const anonima = await iniciarDevolucion(envio.id, null, envio.pagado);
    expect(anonima.error?.message).toMatch(/^NO_PERMITIDO: /);
    expect((await filaEnvio(envio.id)).devolucion_estado).toBeNull();
  });

  it('el monto tiene que ser exactamente el que se pagó', async () => {
    const remitente = await usuarioNuevo('Lucía');
    const envio = await envioPagado(remitente);
    await vencerVentana(envio.id);

    const otro = await iniciarDevolucion(envio.id, remitente.id, envio.sats);
    expect(otro.error?.message).toMatch(/^DATOS_INVALIDOS: La factura tiene que ser exactamente por /);
    expect((await filaEnvio(envio.id)).devolucion_estado).toBeNull();
  });

  it('una devolución vencida deja el envío devuelto, con su fecha y su historial', async () => {
    const remitente = await usuarioNuevo('Lucía');
    const envio = await envioPagado(remitente);
    await vencerVentana(envio.id);

    const { error } = await iniciarDevolucion(envio.id, remitente.id, envio.pagado);
    expect(error).toBeNull();
    const reservada = await filaEnvio(envio.id);
    expect(reservada.devolucion_estado).toBe('pagando');
    expect(reservada.estado).toBe('procesando');

    const cierre = await servicio().rpc('pay_terminar_devolucion', {
      p_transferencia: envio.id,
      p_ok: true,
      p_hash: hashNuevo(),
      p_motivo: NULO,
    });
    expect(cierre.error).toBeNull();

    const fila = await filaEnvio(envio.id);
    expect(fila.estado).toBe('devuelta');
    expect(fila.devolucion_estado).toBe('pagado');
    expect(fila.devuelta_en).not.toBeNull();
    const { data: historial } = await servicio()
      .from('pay_historial')
      .select('estado')
      .eq('transferencia_id', envio.id)
      .order('id');
    expect((historial ?? []).at(-1)?.estado).toBe('devuelta');
  });

  it('nadie devuelve dos veces: una devolución ya hecha no se repite', async () => {
    const remitente = await usuarioNuevo('Lucía');
    const envio = await envioPagado(remitente);
    await vencerVentana(envio.id);
    await iniciarDevolucion(envio.id, remitente.id, envio.pagado);
    await servicio().rpc('pay_terminar_devolucion', { p_transferencia: envio.id, p_ok: true, p_hash: hashNuevo(), p_motivo: NULO });

    const otra = await iniciarDevolucion(envio.id, remitente.id, envio.pagado);
    expect(otra.error?.message).toMatch(/^ESTADO_INVALIDO: /);
  });

  it('dos devoluciones a la vez: solo una entra', async () => {
    const remitente = await usuarioNuevo('Lucía');
    const envio = await envioPagado(remitente);
    await vencerVentana(envio.id);

    const [a, b] = await Promise.all([
      iniciarDevolucion(envio.id, remitente.id, envio.pagado),
      iniciarDevolucion(envio.id, remitente.id, envio.pagado),
    ]);
    const entradas = [a, b].filter((r) => r.error === null);
    expect(entradas).toHaveLength(1);
    const rechazada = [a, b].find((r) => r.error !== null);
    expect(rechazada?.error?.message).toMatch(/^ESTADO_INVALIDO: /);
  });

  it('un cobro en curso no deja recuperar el dinero, aunque la ventana ya se cerró', async () => {
    const remitente = await usuarioNuevo('Lucía');
    const envio = await envioPagado(remitente);
    expect((await iniciarCobro(envio.cobroToken, envio.sats)).error).toBeNull();
    await vencerVentana(envio.id);

    const devolucion = await iniciarDevolucion(envio.id, remitente.id, envio.pagado);
    expect(devolucion.error?.message).toMatch(/^ESTADO_INVALIDO: Hay un cobro en curso/);
  });

  it('un pago sin respuesta de BTCPay queda reservado: ni otra devolución ni un cobro entran', async () => {
    const remitente = await usuarioNuevo('Lucía');
    const envio = await envioPagado(remitente);
    await vencerVentana(envio.id);
    expect((await iniciarDevolucion(envio.id, remitente.id, envio.pagado)).error).toBeNull();

    // BTCPay never answered: nothing is closed, so the transfer stays reserved.
    const otra = await iniciarDevolucion(envio.id, remitente.id, envio.pagado);
    expect(otra.error?.message).toMatch(/^ESTADO_INVALIDO: Ya hay una devolución en curso/);
    const cobro = await iniciarCobro(envio.cobroToken, envio.sats);
    expect(cobro.error?.message).toMatch(/^ESTADO_INVALIDO: Quien envió/);
    expect((await filaEnvio(envio.id)).devolucion_estado).toBe('pagando');
  });

  it('una devolución que BTCPay rechaza queda libre para otra factura', async () => {
    const remitente = await usuarioNuevo('Lucía');
    const envio = await envioPagado(remitente);
    await vencerVentana(envio.id);
    expect((await iniciarDevolucion(envio.id, remitente.id, envio.pagado)).error).toBeNull();

    const rechazo = await servicio().rpc('pay_terminar_devolucion', {
      p_transferencia: envio.id,
      p_ok: false,
      p_hash: NULO,
      p_motivo: 'No hay ruta',
    });
    expect(rechazo.error).toBeNull();
    expect((await filaEnvio(envio.id)).devolucion_estado).toBe('fallido');

    expect((await iniciarDevolucion(envio.id, remitente.id, envio.pagado)).error).toBeNull();
  });
});

describe('cobro y devolución por el mismo envío: exactamente uno paga', () => {
  it('dentro de la ventana gana el cobro; la devolución no entra', async () => {
    const remitente = await usuarioNuevo('Lucía');
    const envio = await envioPagado(remitente);

    const [cobro, devolucion] = await Promise.all([
      iniciarCobro(envio.cobroToken, envio.sats),
      iniciarDevolucion(envio.id, remitente.id, envio.pagado),
    ]);
    const entradas = [cobro, devolucion].filter((r) => r.error === null);
    expect(entradas).toHaveLength(1);
    const fila = await filaEnvio(envio.id);
    expect(fila.cobro_estado === 'pagando' || fila.devolucion_estado === 'pagando').toBe(true);
    expect(fila.cobro_estado === 'pagando' && fila.devolucion_estado === 'pagando').toBe(false);
  });

  it('vencida la ventana gana la devolución; el cobro no entra', async () => {
    const remitente = await usuarioNuevo('Lucía');
    const envio = await envioPagado(remitente);
    await vencerVentana(envio.id);

    const [cobro, devolucion] = await Promise.all([
      iniciarCobro(envio.cobroToken, envio.sats),
      iniciarDevolucion(envio.id, remitente.id, envio.pagado),
    ]);
    const entradas = [cobro, devolucion].filter((r) => r.error === null);
    expect(entradas).toHaveLength(1);
    expect(devolucion.error).toBeNull();
    expect(cobro.error?.message).toMatch(/^(COBRO_VENCIDO|ESTADO_INVALIDO): /);
  });
});
