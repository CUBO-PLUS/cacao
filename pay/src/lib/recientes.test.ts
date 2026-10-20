import { describe, expect, it } from 'vitest';

import { distintosRecientes } from './recientes';

describe('distintosRecientes', () => {
  it('deja una vez a cada persona, con su envío más nuevo', () => {
    const filas = [
      { nombre: 'Marta Hernández', contacto: '+503 7612 3456', entrega: 'efectivo' as const },
      { nombre: 'Marta H.', contacto: '+503 7612 3456', entrega: 'lightning' as const },
      { nombre: 'Rosa', contacto: 'rosa@correo.com', entrega: 'cuenta' as const },
    ];
    const salida = distintosRecientes(filas);
    expect(salida.map((r) => r.nombre)).toEqual(['Marta Hernández', 'Rosa']);
    expect(salida[0].entrega).toBe('efectivo');
  });

  it('enmascara el contacto y guarda el completo para volver a llenar el formulario', () => {
    const [telefono, correo] = distintosRecientes([
      { nombre: 'Marta', contacto: '+503 7612 3456', entrega: 'efectivo' },
      { nombre: 'Rosa', contacto: 'Rosa.Lopez@gmail.com', entrega: 'cuenta' },
    ]);
    expect(telefono.contactoEnmascarado).toBe('•••• ••56');
    expect(telefono.contacto).toBe('+503 7612 3456');
    expect(correo.contactoEnmascarado).toBe('Ro•••@gmail.com');
  });

  it('no pasa del límite de personas', () => {
    const filas = Array.from({ length: 10 }, (_, i) => ({
      nombre: `Persona ${i}`,
      contacto: `+503 7000 000${i}`,
      entrega: 'efectivo' as const,
    }));
    expect(distintosRecientes(filas)).toHaveLength(6);
    expect(distintosRecientes(filas, 3)).toHaveLength(3);
  });
});
