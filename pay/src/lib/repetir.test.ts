import { describe, expect, it } from 'vitest';

import { idDeRepetir, montoTextoDesdeCentavos } from './repetir';

describe('idDeRepetir', () => {
  it('acepta un identificador con forma de UUID', () => {
    const id = '3f2b9c1e-8a4d-4b7e-9c2a-1d2e3f4a5b6c';
    expect(idDeRepetir(id)).toBe(id);
    expect(idDeRepetir([id, 'otro'])).toBe(id);
  });

  it('rechaza valores que no son un identificador', () => {
    expect(idDeRepetir(undefined)).toBeNull();
    expect(idDeRepetir('')).toBeNull();
    expect(idDeRepetir('CP-2345-ABCD')).toBeNull();
    expect(idDeRepetir('3f2b9c1e-8a4d-4b7e-9c2a-1d2e3f4a5b6c-extra')).toBeNull();
  });
});

describe('montoTextoDesdeCentavos', () => {
  it('muestra los montos como los escribe la persona', () => {
    expect(montoTextoDesdeCentavos(10000)).toBe('100');
    expect(montoTextoDesdeCentavos(10050)).toBe('100.50');
    expect(montoTextoDesdeCentavos(705)).toBe('7.05');
    expect(montoTextoDesdeCentavos(100)).toBe('1');
  });
});
