import { describe, expect, it } from 'vitest';

import {
  busquedaDeTexto,
  cercanos,
  categoriaDeTexto,
  distanciaKm,
  enlaceDeLugar,
  fechaLarga,
  filtrarLugares,
  formatoDistancia,
  hrefLista,
  type Lugar,
  normalizar,
  ordenar,
  paginaDe,
  paginar,
  tipoDe,
} from './negocios';

const LUGARES: Lugar[] = [
  { id: 3, nombre: 'Zapatería El Café', lat: 13.7, lon: -89.2, categoria: 'tiendas', verificado: '2026-01-01' },
  { id: 1, nombre: 'Café Ámbar', lat: 13.69, lon: -89.21, categoria: 'cafe', web: 'https://ambar.sv/', verificado: '2026-01-01' },
  { id: 2, nombre: 'Hotel Sol', lat: 13.5, lon: -89.0, categoria: 'hospedaje', web: 'http://sol.sv', verificado: '2026-01-01' },
];

describe('normalizar y búsqueda', () => {
  it('quita tildes y mayúsculas para comparar', () => {
    expect(normalizar('  Café   Ámbar ')).toBe('cafe ambar');
  });

  it('busca sin importar tildes y filtra por categoría', () => {
    expect(filtrarLugares(LUGARES, { busqueda: 'cafe', categoria: null }).map((l) => l.id)).toEqual([1, 3]);
    expect(filtrarLugares(LUGARES, { busqueda: 'CAFE', categoria: 'cafe' }).map((l) => l.id)).toEqual([1]);
    expect(filtrarLugares(LUGARES, { busqueda: 'hotel', categoria: 'cafe' })).toEqual([]);
  });

  it('ordena por nombre en español', () => {
    expect(ordenar(LUGARES).map((l) => l.nombre)).toEqual(['Café Ámbar', 'Hotel Sol', 'Zapatería El Café']);
  });

  it('acepta solo categorías conocidas y recorta la búsqueda', () => {
    expect(categoriaDeTexto('comida')).toBe('comida');
    expect(categoriaDeTexto('otra')).toBeNull();
    expect(busquedaDeTexto('  a    b  ')).toBe('a b');
    expect(busquedaDeTexto('x'.repeat(200))).toHaveLength(60);
    expect(busquedaDeTexto(undefined)).toBe('');
  });

  it('da el tipo en español sencillo', () => {
    expect(tipoDe('cafe')).toBe('Café');
    expect(tipoDe('otros')).toBe('Otro negocio');
  });
});

describe('paginación', () => {
  it('lee la página solo si es un entero desde 1', () => {
    expect(paginaDe('3')).toBe(3);
    expect(paginaDe('0')).toBe(1);
    expect(paginaDe('2.5')).toBe(1);
    expect(paginaDe(['2', '4'])).toBe(2);
    expect(paginaDe(undefined)).toBe(1);
  });

  it('corta por páginas y no pasa del final', () => {
    const datos = Array.from({ length: 45 }, (_, i) => i);
    expect(paginar(datos, 1).items).toHaveLength(20);
    expect(paginar(datos, 3).items).toHaveLength(5);
    expect(paginar(datos, 9)).toMatchObject({ pagina: 3, totalPaginas: 3, total: 45 });
    expect(paginar([], 1)).toMatchObject({ pagina: 1, totalPaginas: 1, items: [] });
  });
});

describe('enlaces', () => {
  it('usa el sitio web solo si es https y si no, la ficha de BTC Map', () => {
    expect(enlaceDeLugar(LUGARES[1])).toEqual({ href: 'https://ambar.sv/', etiqueta: 'Sitio web' });
    expect(enlaceDeLugar(LUGARES[2])).toEqual({ href: 'https://btcmap.org/merchant/2', etiqueta: 'Ficha en BTC Map' });
  });

  it('arma la dirección de la lista con sus filtros', () => {
    expect(hrefLista({})).toBe('/donde-gastar');
    expect(hrefLista({ busqueda: 'sol', categoria: 'hospedaje', pagina: 2 })).toBe(
      '/donde-gastar?q=sol&categoria=hospedaje&pagina=2',
    );
    expect(hrefLista({ categoria: null, pagina: 1 })).toBe('/donde-gastar');
  });
});

describe('cercanos', () => {
  it('calcula la distancia y ordena de cerca a lejos', () => {
    expect(distanciaKm(13.7, -89.2, 13.7, -89.2)).toBeCloseTo(0, 6);
    // One degree of latitude is about 111 km.
    expect(distanciaKm(13, -89, 14, -89)).toBeCloseTo(111.2, 0);
    const lista = cercanos(LUGARES, 13.69, -89.21, 2);
    expect(lista.map((c) => c.lugar.id)).toEqual([1, 3]);
    expect(lista[0].km).toBeLessThan(lista[1].km);
  });

  it('muestra metros debajo de un kilómetro', () => {
    expect(formatoDistancia(0.46)).toBe('a 460 m');
    expect(formatoDistancia(2.34)).toMatch(/^a 2[,.]3 km$/);
  });
});

describe('fecha', () => {
  it('lee la fecha del archivo sin correrla de día', () => {
    expect(fechaLarga('2026-10-31')).toBe('31 de octubre de 2026');
  });
});
