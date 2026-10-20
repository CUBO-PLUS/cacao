import { describe, expect, it } from 'vitest';

import { formatoCuenta, restanteMs } from './cuenta';

describe('formatoCuenta', () => {
  it('muestra minutos y segundos con dos cifras en los segundos', () => {
    expect(formatoCuenta(299_000)).toBe('4:59');
    expect(formatoCuenta(65_000)).toBe('1:05');
    expect(formatoCuenta(9_000)).toBe('0:09');
  });

  it('redondea los segundos hacia arriba y nunca muestra negativos', () => {
    expect(formatoCuenta(299_001)).toBe('5:00');
    expect(formatoCuenta(0)).toBe('0:00');
    expect(formatoCuenta(-5_000)).toBe('0:00');
  });
});

describe('restanteMs', () => {
  it('calcula el tiempo que queda y nunca es negativo', () => {
    const ahora = Date.parse('2026-10-20T12:00:00Z');
    expect(restanteMs('2026-10-20T12:05:00Z', ahora)).toBe(300_000);
    expect(restanteMs('2026-10-20T11:59:00Z', ahora)).toBe(0);
    expect(restanteMs('no es una fecha', ahora)).toBe(0);
  });
});
