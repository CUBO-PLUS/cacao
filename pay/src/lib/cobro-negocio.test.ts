import { describe, expect, it } from 'vitest';

import {
  agregarDigito,
  centavosDesdeTexto,
  COBRO_MAX_CENTAVOS,
  esTipoNegocio,
  estadoAMostrar,
  etiquetaTipo,
  formatoDolares,
  inicioDelDiaSV,
  inicioDelMesSV,
  rutaPagarNegocio,
  validarCentavosCobro,
  validarNombreNegocio,
  validarUbicacion,
} from './cobro-negocio';

describe('montos de un cobro', () => {
  it('lee dólares escritos de varias formas y los pasa a centavos', () => {
    expect(centavosDesdeTexto('3.50')).toEqual({ ok: true, dato: 350 });
    expect(centavosDesdeTexto('3.5')).toEqual({ ok: true, dato: 350 });
    expect(centavosDesdeTexto('$12')).toEqual({ ok: true, dato: 1200 });
    expect(centavosDesdeTexto(' 1,000.25 ')).toEqual({ ok: true, dato: 100025 });
  });

  it('rechaza más de dos decimales, letras y signos', () => {
    expect(centavosDesdeTexto('3.505').ok).toBe(false);
    expect(centavosDesdeTexto('-2').ok).toBe(false);
    expect(centavosDesdeTexto('tres').ok).toBe(false);
    expect(centavosDesdeTexto('').ok).toBe(false);
  });

  it('pone el límite: $1.00 mínimo y $10,000.00 máximo', () => {
    expect(validarCentavosCobro(99).ok).toBe(false);
    expect(validarCentavosCobro(100).ok).toBe(true);
    expect(validarCentavosCobro(COBRO_MAX_CENTAVOS).ok).toBe(true);
    const arriba = validarCentavosCobro(COBRO_MAX_CENTAVOS + 1);
    expect(arriba.ok).toBe(false);
    if (!arriba.ok) expect(arriba.mensaje).toBe('El cobro máximo es $10,000.00.');
  });

  it('rechaza un monto que no es un entero de centavos', () => {
    expect(validarCentavosCobro(350.5).ok).toBe(false);
    expect(validarCentavosCobro('350').ok).toBe(false);
    expect(validarCentavosCobro(Number.NaN).ok).toBe(false);
  });

  it('el teclado arma el monto dígito a dígito, sin pasar el máximo', () => {
    let c = 0;
    for (const d of [3, 5, 0]) c = agregarDigito(c, d);
    expect(c).toBe(350);
    expect(agregarDigito(COBRO_MAX_CENTAVOS, 1)).toBe(COBRO_MAX_CENTAVOS);
    expect(agregarDigito(12, 11)).toBe(12);
  });

  it('muestra dólares con dos decimales y coma de miles', () => {
    expect(formatoDolares(0)).toBe('$0.00');
    expect(formatoDolares(350)).toBe('$3.50');
    expect(formatoDolares(1_000_000)).toBe('$10,000.00');
    expect(formatoDolares(123_456_78)).toBe('$123,456.78');
  });
});

describe('datos del negocio', () => {
  it('el tipo tiene que ser una de las cinco claves', () => {
    expect(esTipoNegocio('cafeteria')).toBe(true);
    expect(esTipoNegocio('Cafetería')).toBe(false);
    expect(esTipoNegocio('bar')).toBe(false);
    expect(etiquetaTipo('restaurante')).toBe('Restaurante');
    expect(etiquetaTipo(null)).toBe('Otro');
  });

  it('el nombre tiene entre 2 y 80 caracteres, sin espacios de sobra', () => {
    expect(validarNombreNegocio(' Café ')).toEqual({ ok: true, dato: 'Café' });
    expect(validarNombreNegocio('a').ok).toBe(false);
    expect(validarNombreNegocio('x'.repeat(81)).ok).toBe(false);
    expect(validarNombreNegocio(undefined).ok).toBe(false);
  });

  it('la ubicación es obligatoria y tiene hasta 160 caracteres', () => {
    expect(validarUbicacion('   ').ok).toBe(false);
    expect(validarUbicacion('Colonia Escalón').ok).toBe(true);
    expect(validarUbicacion('x'.repeat(161)).ok).toBe(false);
  });

  it('la ruta pública usa solo el id del negocio', () => {
    expect(rutaPagarNegocio('3f1c2b9e-0000-4000-8000-000000000001')).toBe('/pagar/3f1c2b9e-0000-4000-8000-000000000001');
  });
});

describe('día y mes de El Salvador (UTC-6, sin horario de verano)', () => {
  it('el día empieza a medianoche local, que es las 06:00 UTC', () => {
    // 2026-10-30 23:30 en El Salvador es 2026-10-31 05:30 UTC: todavía es el 30.
    const tarde = new Date('2026-10-31T05:30:00Z');
    expect(inicioDelDiaSV(tarde).toISOString()).toBe('2026-10-30T06:00:00.000Z');
    // 2026-10-31 00:10 en El Salvador es 06:10 UTC: ya es el 31.
    const madrugada = new Date('2026-10-31T06:10:00Z');
    expect(inicioDelDiaSV(madrugada).toISOString()).toBe('2026-10-31T06:00:00.000Z');
  });

  it('el mes empieza el día 1 a medianoche local', () => {
    expect(inicioDelMesSV(new Date('2026-10-30T18:00:00Z')).toISOString()).toBe('2026-10-01T06:00:00.000Z');
    // Primer día del mes, 00:30 local: sigue siendo ese mes.
    expect(inicioDelMesSV(new Date('2026-11-01T06:30:00Z')).toISOString()).toBe('2026-11-01T06:00:00.000Z');
  });
});

describe('cobros vencidos en el panel', () => {
  const ahora = new Date('2026-11-01T12:00:00Z');

  it('un cobro pendiente cuyo plazo ya pasó se muestra como vencido', () => {
    expect(estadoAMostrar('pendiente', '2026-11-01T11:59:00Z', ahora)).toBe('vencido');
  });

  it('un cobro pendiente que todavía vive se queda como esperando', () => {
    expect(estadoAMostrar('pendiente', '2026-11-01T12:05:00Z', ahora)).toBe('pendiente');
  });

  it('pagados, cancelados y vencidos no cambian', () => {
    expect(estadoAMostrar('pagado', '2026-10-01T00:00:00Z', ahora)).toBe('pagado');
    expect(estadoAMostrar('cancelado', '2026-10-01T00:00:00Z', ahora)).toBe('cancelado');
    expect(estadoAMostrar('vencido', null, ahora)).toBe('vencido');
    expect(estadoAMostrar('pendiente', null, ahora)).toBe('pendiente');
  });
});
