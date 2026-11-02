import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  cancelarEnvio,
  crearEnvio,
  envioPara,
  procesarEnvio,
  simularCompletar,
  simularFallar,
} from '@/servidor/transferencias';

import {
  auditoriaDeEnvio,
  codigoDe,
  datosEnvio,
  eventosDeEnvio,
  filaEnvio,
  administrador,
  ok,
  servicio,
  usuarioNuevo,
  type Usuario,
} from './ayuda';

// The state machine of a transfer: each transition, each refusal, the simulator, and who may act.

const ORIGINAL_DEMO = process.env.NEXT_PUBLIC_DEMO;

function demo(valor: string | undefined) {
  if (valor === undefined) delete process.env.NEXT_PUBLIC_DEMO;
  else process.env.NEXT_PUBLIC_DEMO = valor;
}

beforeEach(() => demo(undefined));

afterEach(() => demo(ORIGINAL_DEMO));

async function envioNuevo(remitente: Usuario) {
  return ok(await crearEnvio(remitente.id, datosEnvio(remitente)));
}

// The sender's payment settles: the transfer records it, as the BTCPay confirmation does.
async function marcarPagado(envioId: string) {
  const { error } = await servicio().from('pay_transferencias').update({ pagada_en: new Date().toISOString() }).eq('id', envioId);
  if (error) throw new Error(error.message);
}

describe('transiciones permitidas', () => {
  it('quien envía confirma, y luego el administrador lo completa', async () => {
    const remitente = await usuarioNuevo('Lucía');
    const admin = await administrador();
    const envio = await envioNuevo(remitente);

    expect(ok(await procesarEnvio(remitente.id, envio.id))).toEqual({ id: envio.id, estado: 'procesando' });
    expect((await filaEnvio(envio.id)).procesando_en).not.toBeNull();

    expect(ok(await simularCompletar({ id: admin.id, esAdmin: true }, envio.id))).toEqual({ id: envio.id, estado: 'completada' });
    const fila = await filaEnvio(envio.id);
    expect(fila.estado).toBe('completada');
    expect(fila.completada_en).not.toBeNull();
  });

  it('quien envía cancela mientras el envío está sin confirmar', async () => {
    const remitente = await usuarioNuevo();
    const envio = await envioNuevo(remitente);
    expect(ok(await cancelarEnvio(remitente.id, envio.id))).toEqual({ id: envio.id, estado: 'cancelada' });
    const fila = await filaEnvio(envio.id);
    expect(fila.cancelada_en).not.toBeNull();
    expect(fila.motivo).toBeNull();
  });

  it('el administrador falla un envío con un motivo', async () => {
    const remitente = await usuarioNuevo();
    const admin = await administrador();
    const envio = await envioNuevo(remitente);
    expect(ok(await simularFallar({ id: admin.id, esAdmin: true }, envio.id, 'Cuenta bancaria cerrada'))).toEqual({
      id: envio.id,
      estado: 'fallida',
    });
    const fila = await filaEnvio(envio.id);
    expect(fila.motivo).toBe('Cuenta bancaria cerrada');
    expect(fila.fallida_en).not.toBeNull();
  });

  it('cada cambio deja una línea en el historial y una en la auditoría, en orden', async () => {
    const remitente = await usuarioNuevo();
    const admin = await administrador();
    const envio = await envioNuevo(remitente);
    await procesarEnvio(remitente.id, envio.id);
    await simularCompletar({ id: admin.id, esAdmin: true }, envio.id);

    const detalle = await envioPara({ id: remitente.id, esAdmin: false }, envio.id);
    expect(detalle?.historial.map((p) => p.estado)).toEqual(['creada', 'procesando', 'completada']);
    expect(detalle?.historial[0].detalle).toBe('Transferencia creada.');

    const auditoria = await auditoriaDeEnvio(envio.id);
    expect(auditoria.map((a) => a.accion)).toEqual(['transferencia.creada', 'transferencia.procesando', 'transferencia.completada']);
  });

  it('completar un envío registra el evento del embudo con su valor', async () => {
    const remitente = await usuarioNuevo();
    const admin = await administrador();
    const envio = await envioNuevo(remitente);
    await procesarEnvio(remitente.id, envio.id);
    await simularCompletar({ id: admin.id, esAdmin: true }, envio.id);

    const eventos = await eventosDeEnvio(envio.id);
    expect(eventos.map((e) => e.nombre)).toEqual(['creo_envio', 'envio_completado']);
    expect(eventos[1]).toMatchObject({ valor_usd_centavos: 10_000 });
  });
});

describe('transiciones rechazadas', () => {
  it('no se procesa dos veces ni se cancela cuando ya salió', async () => {
    const remitente = await usuarioNuevo();
    const envio = await envioNuevo(remitente);
    await procesarEnvio(remitente.id, envio.id);

    expect(codigoDe(await procesarEnvio(remitente.id, envio.id))).toBe('ESTADO_INVALIDO');
    expect(codigoDe(await cancelarEnvio(remitente.id, envio.id))).toBe('ESTADO_INVALIDO');
    expect((await filaEnvio(envio.id)).estado).toBe('procesando');
  });

  it('no se completa un envío que todavía no salió', async () => {
    const remitente = await usuarioNuevo();
    const admin = await administrador();
    const envio = await envioNuevo(remitente);
    expect(codigoDe(await simularCompletar({ id: admin.id, esAdmin: true }, envio.id))).toBe('ESTADO_INVALIDO');
  });

  it('un envío completado no se falla ni se cancela', async () => {
    const remitente = await usuarioNuevo();
    const admin = await administrador();
    const envio = await envioNuevo(remitente);
    await procesarEnvio(remitente.id, envio.id);
    await simularCompletar({ id: admin.id, esAdmin: true }, envio.id);

    expect(codigoDe(await simularFallar({ id: admin.id, esAdmin: true }, envio.id, 'Ya no hace falta'))).toBe('ESTADO_INVALIDO');
    expect(codigoDe(await cancelarEnvio(remitente.id, envio.id))).toBe('ESTADO_INVALIDO');
  });

  it('el motivo de una falla tiene entre 4 y 200 caracteres', async () => {
    const remitente = await usuarioNuevo();
    const admin = await administrador();
    const envio = await envioNuevo(remitente);
    expect(codigoDe(await simularFallar({ id: admin.id, esAdmin: true }, envio.id, 'no'))).toBe('DATOS_INVALIDOS');
    expect(codigoDe(await simularFallar({ id: admin.id, esAdmin: true }, envio.id, 'x'.repeat(201)))).toBe('DATOS_INVALIDOS');
    expect((await filaEnvio(envio.id)).estado).toBe('creada');
  });

  it('quien envía no puede completar un envío sin pagar, aunque sea el suyo', async () => {
    demo(undefined);
    const remitente = await usuarioNuevo();
    const envio = await envioNuevo(remitente);
    await procesarEnvio(remitente.id, envio.id);
    expect(codigoDe(await simularCompletar({ id: remitente.id, esAdmin: false }, envio.id))).toBe('ESTADO_INVALIDO');
    expect((await filaEnvio(envio.id)).estado).toBe('procesando');
  });

  it('quien envía completa su efectivo pagado que va en camino, también fuera de la demo', async () => {
    demo(undefined);
    const remitente = await usuarioNuevo();
    const envio = await envioNuevo(remitente);
    await procesarEnvio(remitente.id, envio.id);
    await marcarPagado(envio.id);
    expect(ok(await simularCompletar({ id: remitente.id, esAdmin: false }, envio.id))).toEqual({ id: envio.id, estado: 'completada' });
  });

  it('un administrador que no es quien envió no puede cancelar el envío', async () => {
    const remitente = await usuarioNuevo();
    const admin = await administrador();
    const envio = await envioNuevo(remitente);
    expect(codigoDe(await cancelarEnvio(admin.id, envio.id))).toBe('NO_PERMITIDO');
  });
});

describe('quién puede actuar', () => {
  it('un desconocido recibe NO_ENCONTRADA y el envío no cambia', async () => {
    const remitente = await usuarioNuevo();
    const extraño = await usuarioNuevo('Extraña');
    const admin = await administrador();
    const envio = await envioNuevo(remitente);

    expect(await envioPara({ id: extraño.id, esAdmin: false }, envio.id)).toBeNull();
    expect(codigoDe(await procesarEnvio(extraño.id, envio.id))).toBe('NO_ENCONTRADA');
    expect(codigoDe(await cancelarEnvio(extraño.id, envio.id))).toBe('NO_ENCONTRADA');
    expect(codigoDe(await simularCompletar({ id: extraño.id, esAdmin: false }, envio.id))).toBe('NO_ENCONTRADA');
    expect(codigoDe(await simularFallar({ id: extraño.id, esAdmin: false }, envio.id, 'Motivo de prueba'))).toBe('NO_ENCONTRADA');
    expect(codigoDe(await cancelarEnvio(remitente.id, 'no-es-un-id'))).toBe('NO_ENCONTRADA');
    expect(codigoDe(await cancelarEnvio(admin.id, '00000000-0000-0000-0000-000000000000'))).toBe('NO_ENCONTRADA');
    expect((await filaEnvio(envio.id)).estado).toBe('creada');
  });

  it('el simulador de quien envió nunca entrega sin pago, con la demo apagada ni encendida', async () => {
    const remitente = await usuarioNuevo();
    const envio = await envioNuevo(remitente);
    await procesarEnvio(remitente.id, envio.id);

    demo(undefined);
    expect(codigoDe(await simularCompletar({ id: remitente.id, esAdmin: false }, envio.id))).toBe('ESTADO_INVALIDO');
    demo('1');
    expect(codigoDe(await simularCompletar({ id: remitente.id, esAdmin: false }, envio.id))).toBe('ESTADO_INVALIDO');
    expect((await filaEnvio(envio.id)).estado).toBe('procesando');

    await marcarPagado(envio.id);
    expect(ok(await simularCompletar({ id: remitente.id, esAdmin: false }, envio.id))).toEqual({ id: envio.id, estado: 'completada' });
    expect((await filaEnvio(envio.id)).estado).toBe('completada');
  });

  it('el simulador de la demo también falla un envío de quien envió', async () => {
    demo('1');
    const remitente = await usuarioNuevo();
    const envio = await envioNuevo(remitente);
    expect(ok(await simularFallar({ id: remitente.id, esAdmin: false }, envio.id, 'Prueba de la demo'))).toEqual({
      id: envio.id,
      estado: 'fallida',
    });
  });

  it('el administrador usa el simulador siempre, aunque la demo esté apagada', async () => {
    demo(undefined);
    const remitente = await usuarioNuevo();
    const admin = await administrador();
    const envio = await envioNuevo(remitente);
    expect(ok(await simularFallar({ id: admin.id, esAdmin: true }, envio.id, 'Falla de prueba'))).toMatchObject({ estado: 'fallida' });
  });

  it('un administrador que dice ser admin sin serlo no pasa el simulador', async () => {
    demo(undefined);
    const remitente = await usuarioNuevo();
    const falso = await usuarioNuevo('Falsa');
    const envio = await envioNuevo(remitente);
    expect(codigoDe(await simularFallar({ id: falso.id, esAdmin: true }, envio.id, 'Motivo de prueba'))).toBe('NO_ENCONTRADA');
  });
});
