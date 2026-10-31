import { describe, expect, it } from 'vitest';
import {
  type Lugar,
  DATOS,
  enlaceDirectorio,
  fechaLarga,
  filtrarNegocios,
  leerFiltro,
  ordenarNegocios,
  paginar,
  sitioDe,
} from './negocios-bitcoin';

const lugares: Lugar[] = [
  { id: 1, nombre: 'Pupusería Doña Lupe', lat: 13.7, lon: -89.2, categoria: 'comida', verificado: '2026-01-02' },
  { id: 2, nombre: 'Café Limón', lat: 13.7, lon: -89.2, categoria: 'cafe', verificado: '2025-07-11', web: 'https://cafelimon.sv' },
  { id: 3, nombre: 'Ferretería Central', lat: 13.7, lon: -89.2, categoria: 'tiendas', verificado: '2026-02-03' },
];

describe('filtrarNegocios', () => {
  it('encuentra por nombre sin importar tildes ni mayúsculas', () => {
    expect(filtrarNegocios(lugares, { texto: 'cafe' }).map((l) => l.id)).toEqual([2]);
    expect(filtrarNegocios(lugares, { texto: 'PUPUSERÍA' }).map((l) => l.id)).toEqual([1]);
  });

  it('filtra por categoría', () => {
    expect(filtrarNegocios(lugares, { texto: '', categoria: 'tiendas' }).map((l) => l.id)).toEqual([3]);
  });

  it('combina búsqueda y categoría', () => {
    expect(filtrarNegocios(lugares, { texto: 'lupe', categoria: 'cafe' })).toEqual([]);
  });

  it('sin filtros devuelve todo', () => {
    expect(filtrarNegocios(lugares, { texto: '' })).toHaveLength(3);
  });
});

describe('ordenarNegocios', () => {
  it('ordena por nombre en español', () => {
    expect(ordenarNegocios(lugares).map((l) => l.id)).toEqual([2, 3, 1]);
  });
});

describe('paginar', () => {
  const lista = Array.from({ length: 95 }, (_, i) => i);

  it('parte la lista en páginas de 40', () => {
    const p = paginar(lista, 3);
    expect(p.items).toHaveLength(15);
    expect(p.paginas).toBe(3);
    expect(p.total).toBe(95);
  });

  it('mantiene la página dentro del rango', () => {
    expect(paginar(lista, 99).pagina).toBe(3);
    expect(paginar(lista, 0).pagina).toBe(1);
  });

  it('una lista vacía tiene una sola página', () => {
    expect(paginar([], 1)).toEqual({ items: [], pagina: 1, paginas: 1, total: 0 });
  });
});

describe('leerFiltro', () => {
  it('descarta categorías desconocidas y páginas no válidas', () => {
    expect(leerFiltro({ categoria: 'bitcoin', pagina: '-4' })).toEqual({ texto: '', categoria: undefined, pagina: 1 });
  });

  it('lee la búsqueda, la categoría y la página', () => {
    expect(leerFiltro({ q: '  café ', categoria: 'cafe', pagina: '2' })).toEqual({
      texto: 'café',
      categoria: 'cafe',
      pagina: 2,
    });
  });
});

describe('enlaceDirectorio', () => {
  it('deja la dirección limpia en la primera página sin filtros', () => {
    expect(enlaceDirectorio({ pagina: 1 })).toBe('/negocios-bitcoin');
  });

  it('conserva búsqueda y categoría al cambiar de página', () => {
    expect(enlaceDirectorio({ texto: 'cafe', categoria: 'cafe', pagina: 2 })).toBe(
      '/negocios-bitcoin?q=cafe&categoria=cafe&pagina=2',
    );
  });
});

describe('sitioDe', () => {
  it('usa el sitio web cuando existe', () => {
    expect(sitioDe(lugares[1]).href).toBe('https://cafelimon.sv/');
    expect(sitioDe(lugares[1]).etiqueta).toBe('Sitio web');
  });

  it('usa la ficha de BTC Map cuando no hay sitio', () => {
    expect(sitioDe(lugares[0])).toEqual({ href: 'https://btcmap.org/merchant/1', etiqueta: 'Ficha en BTC Map' });
  });

  it('no enlaza esquemas que no sean web', () => {
    const raro = { ...lugares[0], web: 'javascript:alert(1)' };
    expect(sitioDe(raro).href).toBe('https://btcmap.org/merchant/1');
  });
});

describe('fechaLarga', () => {
  it('escribe la fecha en español', () => {
    expect(fechaLarga('2025-07-11')).toBe('11 de julio de 2025');
    expect(fechaLarga('mal')).toBe('');
  });
});

describe('datos del archivo', () => {
  it('el total coincide con la cantidad de lugares', () => {
    expect(DATOS.lugares).toHaveLength(DATOS.total);
  });
});
