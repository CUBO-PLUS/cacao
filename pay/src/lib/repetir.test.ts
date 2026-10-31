import { describe, expect, it } from 'vitest';

import { idDeRepetir, inicioDesdeQuery, montoTextoDesdeCentavos, rutaEnviarCon } from './repetir';

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

describe('inicioDesdeQuery', () => {
  it('lee monto, moneda y entrega de la cotización de inicio', () => {
    expect(inicioDesdeQuery({ monto: '50,5', moneda: 'EUR', entrega: 'cuenta' })).toEqual({
      montoTexto: '50.50',
      moneda: 'EUR',
      entrega: 'cuenta',
    });
  });

  it('no prefila sin monto válido ni fuera de los límites', () => {
    expect(inicioDesdeQuery({})).toBeNull();
    expect(inicioDesdeQuery({ monto: 'abc' })).toBeNull();
    expect(inicioDesdeQuery({ monto: '0.50' })).toBeNull();
    expect(inicioDesdeQuery({ monto: '5000' })).toBeNull();
  });

  it('usa los valores por omisión cuando moneda o entrega no son conocidas', () => {
    expect(inicioDesdeQuery({ monto: '20', moneda: 'XYZ', entrega: 'drone' })).toEqual({
      montoTexto: '20',
      moneda: 'USD',
      entrega: 'efectivo',
    });
  });
});

describe('rutaEnviarCon', () => {
  it('vuelve a /enviar con el prefill, sin copiar valores que no se leyeron', () => {
    const inicio = { montoTexto: '20.5', moneda: 'USD' as const, entrega: 'lightning' as const };
    expect(rutaEnviarCon(inicio, null)).toBe('/enviar?monto=20.5&moneda=USD&entrega=lightning');
    expect(rutaEnviarCon(null, null)).toBe('/enviar');
  });
});
