import { describe, expect, it } from 'vitest';

import { enlaceDeFiltros, estadosDeFiltro, limpiarBusqueda, parsearFiltros, textoVacio } from './filtrosEnvios';

describe('limpiarBusqueda', () => {
  it('quita los caracteres que rompen el filtro de la base', () => {
    expect(limpiarBusqueda('Ana, (María)*')).toBe('Ana María');
  });

  it('conserva letras con tilde, números y guiones del código', () => {
    expect(limpiarBusqueda('  CP-2345-ABCD  ')).toBe('CP-2345-ABCD');
    expect(limpiarBusqueda('José Peñate')).toBe('José Peñate');
  });

  it('colapsa espacios y corta a 60 caracteres', () => {
    expect(limpiarBusqueda('a    b')).toBe('a b');
    expect(limpiarBusqueda('x'.repeat(100))).toHaveLength(60);
    expect(limpiarBusqueda(undefined)).toBe('');
  });
});

describe('parsearFiltros', () => {
  it('usa los valores por defecto cuando no hay nada en la URL', () => {
    expect(parsearFiltros({})).toEqual({ filtro: 'todos', busqueda: '', pagina: 1 });
  });

  it('acepta solo los estados conocidos', () => {
    expect(parsearFiltros({ estado: 'porPagar' }).filtro).toBe('porPagar');
    expect(parsearFiltros({ estado: 'creada' }).filtro).toBe('todos');
    expect(parsearFiltros({ estado: ['entregados', 'enCamino'] }).filtro).toBe('entregados');
  });

  it('lee la página solo si es un número entero desde 1', () => {
    expect(parsearFiltros({ pagina: '3' }).pagina).toBe(3);
    expect(parsearFiltros({ pagina: '0' }).pagina).toBe(1);
    expect(parsearFiltros({ pagina: '-2' }).pagina).toBe(1);
    expect(parsearFiltros({ pagina: '2.5' }).pagina).toBe(1);
    expect(parsearFiltros({ pagina: 'abc' }).pagina).toBe(1);
  });

  it('limpia el texto de búsqueda que llega en la URL', () => {
    expect(parsearFiltros({ q: 'Marta;--' }).busqueda).toBe('Marta--');
  });
});

describe('enlaceDeFiltros', () => {
  it('deja fuera los valores por defecto', () => {
    expect(enlaceDeFiltros('todos', '')).toBe('/envios');
    expect(enlaceDeFiltros('todos', '', 1)).toBe('/envios');
  });

  it('conserva filtro, búsqueda y página', () => {
    expect(enlaceDeFiltros('porPagar', 'Marta', 2)).toBe('/envios?estado=porPagar&q=Marta&pagina=2');
    expect(enlaceDeFiltros('cancelados', '')).toBe('/envios?estado=cancelados');
  });

  it('ida y vuelta con parsearFiltros', () => {
    const enlace = enlaceDeFiltros('enCamino', 'CP-2345', 4);
    const query = new URL(enlace, 'https://x.test').searchParams;
    const params = Object.fromEntries(query.entries());
    expect(parsearFiltros(params)).toEqual({ filtro: 'enCamino', busqueda: 'CP-2345', pagina: 4 });
  });
});

describe('estadosDeFiltro y textoVacio', () => {
  it('cada filtro muestra sus estados', () => {
    expect(estadosDeFiltro('todos')).toBeNull();
    expect(estadosDeFiltro('porPagar')).toEqual(['creada']);
    expect(estadosDeFiltro('cancelados')).toEqual(['cancelada', 'fallida']);
  });

  it('el texto vacío depende del filtro, o de la búsqueda cuando hay una', () => {
    expect(textoVacio('porPagar', '')).toBe('No tenés envíos por pagar.');
    expect(textoVacio('porPagar', 'Marta')).toBe('No encontramos envíos para "Marta".');
  });
});
