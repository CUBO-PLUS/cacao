import { describe, expect, it } from 'vitest';
import { coincideBusqueda, patronAmplio, sinAcentos } from './buscar';

describe('sinAcentos', () => {
  it('quita tildes y pasa a minúsculas', () => {
    expect(sinAcentos('Limón Mandarina')).toBe('limon mandarina');
    expect(sinAcentos('Ñandú')).toBe('nandu');
  });
});

describe('coincideBusqueda', () => {
  it('encuentra limon en Limón mandarina', () => {
    expect(coincideBusqueda('limon', ['Limón mandarina', '', ''])).toBe(true);
  });

  it('encuentra la búsqueda con tilde en un texto sin tilde', () => {
    expect(coincideBusqueda('café', ['Cafe de altura'])).toBe(true);
  });

  it('busca en la descripción y en el nombre de la tienda', () => {
    expect(coincideBusqueda('huerto', ['Miel', 'Miel de flor', 'Huerto San José'])).toBe(true);
    expect(coincideBusqueda('frijol', ['Maíz', 'Granja', 'Frijol negro'])).toBe(true);
  });

  it('exige todas las palabras, en cualquier orden', () => {
    expect(coincideBusqueda('mandarina limon', ['Limón mandarina'])).toBe(true);
    expect(coincideBusqueda('limon naranja', ['Limón mandarina'])).toBe(false);
  });

  it('no encuentra palabras que no están', () => {
    expect(coincideBusqueda('cacao', ['Miel', 'Maíz'])).toBe(false);
  });

  it('una búsqueda vacía coincide con todo', () => {
    expect(coincideBusqueda('   ', ['x'])).toBe(true);
  });
});

describe('patronAmplio', () => {
  it('cambia las vocales y la n por comodines, y usa la palabra más larga', () => {
    expect(patronAmplio('limon')).toBe('%l_m__%');
    expect(patronAmplio('mi limon')).toBe('%l_m__%');
  });

  it('reconoce una palabra con tilde como la misma que sin tilde', () => {
    expect(patronAmplio('Limón')).toBe(patronAmplio('limon'));
  });
});
