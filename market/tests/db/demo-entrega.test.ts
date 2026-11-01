import { afterAll, describe, expect, it } from 'vitest';

import { codigoDe, limpiar, negocio, ordenDe, pagar, pedir, producto, servicio, usuarioNuevo } from './ayuda';

// Simular entrega: only a buyer of a demo seller's pickup order can settle it, and only after payment.

afterAll(limpiar);

async function negocioDemo(dueno: Awaited<ReturnType<typeof usuarioNuevo>>): Promise<string> {
  const id = await negocio(dueno);
  const { error } = await servicio()
    .from('negocios')
    .update({ btcmap_id: Math.floor(Math.random() * 900_000) + 100_000 })
    .eq('id', id);
  if (error) throw error;
  return id;
}

function simular(ordenId: string, actorId: string) {
  return servicio().rpc('simular_entrega_demo', { p_orden: ordenId, p_actor: actorId });
}

describe('simular entrega de un pedido de demostración', () => {
  it('el comprador lleva el pedido pagado a entregada, y el vendedor no puede', async () => {
    const vendedor = await usuarioNuevo();
    const comprador = await usuarioNuevo();
    const tienda = await negocioDemo(vendedor);
    const prod = await producto(vendedor, { stock: 5 });
    const orden = await pedir(comprador, tienda, [{ producto: prod.id, cantidad: 1 }]);
    await pagar(orden.id);
    expect((await ordenDe(orden.id)).estado).toBe('pagada');

    const delVendedor = await simular(orden.id, vendedor.id);
    expect(codigoDe(delVendedor.error)).toBe('NO_PERMITIDO');
    expect((await ordenDe(orden.id)).estado).toBe('pagada');

    const delComprador = await simular(orden.id, comprador.id);
    expect(delComprador.error).toBeNull();
    const despues = await ordenDe(orden.id);
    expect(despues.estado).toBe('entregada');
    expect(despues.entregada_en).not.toBeNull();
  });

  it('un negocio real no se simula, aunque el comprador lo pida', async () => {
    const vendedor = await usuarioNuevo();
    const comprador = await usuarioNuevo();
    const tienda = await negocio(vendedor);
    const prod = await producto(vendedor, { stock: 5 });
    const orden = await pedir(comprador, tienda, [{ producto: prod.id, cantidad: 1 }]);
    await pagar(orden.id);

    const respuesta = await simular(orden.id, comprador.id);
    expect(codigoDe(respuesta.error)).toBe('NO_PERMITIDO');
    expect((await ordenDe(orden.id)).estado).toBe('pagada');
  });

  it('una orden sin pagar no se puede simular', async () => {
    const vendedor = await usuarioNuevo();
    const comprador = await usuarioNuevo();
    const tienda = await negocioDemo(vendedor);
    const prod = await producto(vendedor, { stock: 5 });
    const orden = await pedir(comprador, tienda, [{ producto: prod.id, cantidad: 1 }]);

    const respuesta = await simular(orden.id, comprador.id);
    expect(codigoDe(respuesta.error)).toBe('ESTADO_INVALIDO');
    expect((await ordenDe(orden.id)).estado).not.toBe('entregada');
  });
});
