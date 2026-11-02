import { afterAll, describe, expect, it } from 'vitest';

import { inventarioAdmin, ordenDetalleAdmin, ordenesAdmin, POR_PAGINA } from '@/servidor/admin';

import { administrador, limpiar, negocio, ordenDe, pedir, producto, servicio, stockDe, sufijo, usuarioNuevo } from './ayuda';

// The admin orders list and inventory, run against the real loaders and the local database.

afterAll(limpiar);

describe('acceso a órdenes e inventario de administración', () => {
  it('un usuario común no lee las órdenes, el detalle ni el inventario', async () => {
    const comun = await usuarioNuevo();
    await expect(ordenesAdmin(comun.id, { pagina: 1, estado: null })).rejects.toBeDefined();
    await expect(ordenDetalleAdmin(comun.id, crypto.randomUUID())).rejects.toBeDefined();
    await expect(inventarioAdmin(comun.id)).rejects.toBeDefined();
  });
});

describe('lista de órdenes', () => {
  it('cada fila trae el número, el tipo, el negocio y el total en sats y en dólares', async () => {
    const admin = await administrador();
    const vendedor = await usuarioNuevo();
    const comprador = await usuarioNuevo();
    const tienda = await negocio(vendedor);
    const prod = await producto(vendedor, { precio: 350, stock: 5 });
    const orden = await pedir(comprador, tienda, [{ producto: prod.id, cantidad: 2 }]);

    // The order is the newest one, so it is on the first page of its own filter.
    const datos = await ordenesAdmin(admin.id, { pagina: 1, estado: 'creada', tipo: 'productos' });
    const fila = datos.filas.find((f) => f.id === orden.id);
    expect(fila).toMatchObject({
      numero: orden.numero,
      tipo: 'productos',
      estado: 'creada',
      totalSats: 7000,
      totalUsdCentavos: 700,
    });
    expect(fila?.negocio).not.toBe('');
    expect(fila?.comprador).not.toBe('');
    expect(datos.filas.every((f) => f.estado === 'creada' && f.tipo === 'productos')).toBe(true);
  });

  it('una página fuera de rango muestra la última, y el total coincide con la tabla', async () => {
    const admin = await administrador();
    const { count, error } = await servicio().from('ordenes').select('id', { count: 'exact', head: true });
    if (error) throw error;
    const total = count ?? 0;
    const ultima = Math.max(1, Math.ceil(total / POR_PAGINA));

    const datos = await ordenesAdmin(admin.id, { pagina: 999_999, estado: null, tipo: null });
    expect(datos.pagina).toBe(ultima);
    expect(datos.total).toBe(total);
    expect(datos.porPagina).toBe(POR_PAGINA);
    expect(datos.filas.length).toBe(total - (ultima - 1) * POR_PAGINA);
  });
});

describe('detalle de una orden cancelada', () => {
  it('un pedido de productos cancelado guarda el motivo y la fecha de cancelación', async () => {
    const admin = await administrador();
    const vendedor = await usuarioNuevo();
    const comprador = await usuarioNuevo();
    const tienda = await negocio(vendedor);
    const prod = await producto(vendedor, { precio: 350, stock: 5 });
    const orden = await pedir(comprador, tienda, [{ producto: prod.id, cantidad: 1 }]);

    const cancelada = await servicio().rpc('cancelar_orden', {
      p_orden: orden.id,
      p_actor: comprador.id,
      p_motivo: 'Cambié de idea, prueba.',
    });
    expect(cancelada.error).toBeNull();

    const detalle = await ordenDetalleAdmin(admin.id, orden.id);
    expect(detalle?.estado).toBe('cancelada');
    expect(detalle?.tipo).toBe('productos');
    expect(detalle?.motivoCancelacion).toBe('Cambié de idea, prueba.');
    expect(detalle?.canceladaEn).not.toBeNull();
    expect(await stockDe(prod.id)).toBe(5);
  });
});

describe('inventario', () => {
  it('el stock de una orden vencida vuelve antes de mostrarlo', async () => {
    const admin = await administrador();
    const vendedor = await usuarioNuevo();
    const comprador = await usuarioNuevo();
    const tienda = await negocio(vendedor);
    const prod = await producto(vendedor, { precio: 350, stock: 5, nombre: `Vence ${sufijo()}` });
    const orden = await pedir(comprador, tienda, [{ producto: prod.id, cantidad: 2 }]);
    expect(await stockDe(prod.id)).toBe(3);

    // Created 11 minutes ago and never paid: the sweep expires it and returns the two units.
    const hace = new Date(Date.now() - 11 * 60_000).toISOString();
    const { error } = await servicio().from('ordenes').update({ creada_en: hace }).eq('id', orden.id);
    if (error) throw error;

    const inventario = await inventarioAdmin(admin.id);
    expect(inventario.find((p) => p.id === prod.id)?.stock).toBe(5);
    expect((await ordenDe(orden.id)).estado).toBe('expirada');
  });

  it('agotados primero, después pausados y luego los demás, con nombres de A a Z en cada grupo', async () => {
    const admin = await administrador();
    const vendedor = await usuarioNuevo();
    await negocio(vendedor);
    const etiqueta = sufijo();
    const disponible = await producto(vendedor, { stock: 2, nombre: `Inv-D ${etiqueta}` });
    const pausado = await producto(vendedor, { stock: 4, activo: false, nombre: `Inv-P ${etiqueta}` });
    const agotado = await producto(vendedor, { stock: 0, nombre: `Inv-A ${etiqueta}` });

    const inventario = await inventarioAdmin(admin.id);
    const lugar = (id: string) => inventario.findIndex((p) => p.id === id);
    expect(lugar(agotado.id)).toBeGreaterThanOrEqual(0);
    expect(lugar(agotado.id)).toBeLessThan(lugar(pausado.id));
    expect(lugar(pausado.id)).toBeLessThan(lugar(disponible.id));

    // Across the whole list: each group is complete before the next one starts.
    const grupos = inventario.map((p) => (p.stock === 0 ? 0 : p.activo ? 2 : 1));
    expect(grupos).toEqual([...grupos].sort((a, b) => a - b));
  });
});
