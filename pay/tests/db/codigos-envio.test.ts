import { describe, expect, it } from 'vitest';

import { esCodigo } from '@/lib/transferencias';
import { crearEnvio } from '@/servidor/transferencias';

import { datosEnvio, ok, servicio, usuarioNuevo } from './ayuda';

// The transfer code CP-XXXX-XXXX: the database makes it unique (a unique constraint, and pay_crear_transferencia
// draws a new one until it is free). These tests send many transfers at once and check that no two codes match,
// and that the database itself refuses a repeated code.

describe('códigos de envío CP-XXXX-XXXX', () => {
  it('sesenta envíos a la vez reciben sesenta códigos distintos, todos con el formato correcto', async () => {
    const remitente = await usuarioNuevo('Códigos en paralelo');
    const creados = await Promise.all(
      Array.from({ length: 60 }, () => crearEnvio(remitente.id, datosEnvio(remitente))),
    );
    const codigos = creados.map((resultado) => ok(resultado).codigo);

    expect(new Set(codigos).size).toBe(codigos.length);
    for (const codigo of codigos) {
      expect(codigo).toMatch(/^CP-[23456789A-HJ-NP-Z]{4}-[23456789A-HJ-NP-Z]{4}$/);
      expect(esCodigo(codigo)).toBe(true);
    }
  });

  it('la base de datos rechaza un código que ya tiene otro envío', async () => {
    const remitente = await usuarioNuevo('Código repetido');
    const primero = ok(await crearEnvio(remitente.id, datosEnvio(remitente)));
    const segundo = ok(await crearEnvio(remitente.id, datosEnvio(remitente)));

    const { error } = await servicio()
      .from('pay_transferencias')
      .update({ codigo: primero.codigo })
      .eq('id', segundo.id);

    expect(error).not.toBeNull();
    expect(error?.code).toBe('23505');
  });
});
