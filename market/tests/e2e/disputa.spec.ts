import { randomUUID } from 'node:crypto';

import { expect, type Page, test } from '@playwright/test';

import { servicio } from './ayuda';
import { cafetalDeAdmin, idDe, paginaComo, type Persona } from './roles';

// The Cafetal shop belongs to the admin test account while this file runs, so the seller side can act on it.
let devolverCafetal: (() => Promise<void>) | undefined;
test.beforeAll(async () => {
  devolverCafetal = await cafetalDeAdmin();
});
test.afterAll(async () => {
  await devolverCafetal?.();
});

async function productoDe(vendedor: Persona, stock: number, nombre: string) {
  const usuario = await idDe(vendedor);
  const { data: categoria, error: errorCategoria } = await servicio()
    .from('categorias')
    .select('id')
    .order('id')
    .limit(1)
    .single();
  if (errorCategoria) throw errorCategoria;
  const { data, error } = await servicio().rpc('guardar_producto', {
    p_usuario: usuario,
    p_producto: null,
    p_categoria: categoria.id,
    p_nombre: nombre,
    p_descripcion: 'Producto de prueba.',
    p_unidad: 'libra',
    p_precio: 350,
    p_stock: stock,
    p_activo: true,
    p_fotos: [],
  });
  if (error) throw new Error(error.message);
  return { id: data.id as string, negocioId: data.negocio_id as string };
}

// Arranges a paid order through the database functions.
async function ordenPagadaPorRpc(comprador: Persona, producto: { id: string; negocioId: string }) {
  const s = servicio();
  const { data: orden, error } = await s.rpc('crear_orden', {
    p_comprador: await idDe(comprador),
    p_negocio: producto.negocioId,
    p_lineas: [{ producto_id: producto.id, cantidad: 1 }],
    p_modo: 'recogida',
    p_clave: randomUUID(),
    p_cotizacion: 100000,
  });
  if (error) throw new Error(error.message);
  const { error: errorCobro } = await s.rpc('registrar_cobro', {
    p_orden: orden.id,
    p_proveedor: 'falso',
    p_referencia: null,
    p_bolt11: null,
    p_destino: null,
    p_verificar_url: null,
    p_expira_en: new Date(Date.now() + 600_000).toISOString(),
  });
  if (errorCobro) throw new Error(errorCobro.message);
  const { error: errorPago } = await s.rpc('confirmar_pago', { p_orden: orden.id, p_actor: null });
  if (errorPago) throw new Error(errorPago.message);
  return { id: orden.id as string, numero: String(orden.numero) };
}

test('disputa: abre, la admin resuelve con reembolso total, se paga y se confirma', async ({ browser }) => {
  const producto = await productoDe('rosa', 5, `Prueba disputa ${Date.now()}`);
  const orden = await ordenPagadaPorRpc('lucia', producto);
  const nota = 'Se confirmó la humedad. Corresponde reembolso total.';

  // Only two pages are open at a time: each actor opens when needed and closes before the next.
  const abiertas: Page[] = [];
  try {
    // Buyer opens the dispute with a reason.
    let comprador = await paginaComo(browser,'lucia');
    abiertas.push(comprador);
    await comprador.goto(`/ordenes/${orden.id}`);
    await comprador.waitForLoadState('networkidle');
    await comprador.getByRole('button', { name: 'Tengo un problema' }).click();
    await comprador.getByLabel('Contá qué pasó').fill('El cacao llegó húmedo y no es lo que pedí.');
    await comprador.getByRole('button', { name: 'Abrir disputa' }).click();
    await expect(comprador.getByText('En disputa', { exact: true }).first()).toBeVisible();
    await comprador.context().close();

    // Admin resolves it with a full refund and a note.
    const admin = await paginaComo(browser,'ana');
    abiertas.push(admin);
    await admin.goto('/admin/disputas');
    await admin.waitForLoadState('networkidle');
    const tarjeta = admin
      .getByRole('article')
      .filter({ has: admin.getByRole('heading', { name: `Orden ${orden.numero}`, exact: true }) });
    await expect(tarjeta).toBeVisible();
    await tarjeta.getByLabel('Reembolso total').check();
    await tarjeta.getByLabel('Nota de resolución').fill(nota);
    await tarjeta.getByRole('button', { name: 'Resolver disputa' }).click();
    await expect(tarjeta.getByText('Resuelta', { exact: true }).first()).toBeVisible();
    await admin.context().close();

    // Seller marks the refund as paid outside the app.
    const vendedora = await paginaComo(browser,'rosa');
    abiertas.push(vendedora);
    await vendedora.goto(`/ordenes/${orden.id}`);
    await vendedora.waitForLoadState('networkidle');
    await vendedora.getByRole('button', { name: 'Marcar reembolso como pagado' }).click();
    await vendedora.getByRole('button', { name: 'Sí, ya lo pagué' }).click();
    await expect(vendedora.getByText(/Marcado por el vendedor el/)).toBeVisible();

    // Buyer confirms receipt of the refund.
    comprador = await paginaComo(browser,'lucia');
    abiertas.push(comprador);
    await comprador.goto(`/ordenes/${orden.id}`);
    await comprador.waitForLoadState('networkidle');
    await comprador.getByRole('button', { name: 'Confirmar que recibí el reembolso' }).click();
    await comprador.getByRole('button', { name: 'Sí, lo recibí' }).click();
    await expect(comprador.getByText(/Confirmado por el comprador el/)).toBeVisible();

    // Final texts on the order page for the buyer.
    await expect(comprador.getByText('Resuelta', { exact: true }).first()).toBeVisible();
    await expect(comprador.getByText('Reembolso total', { exact: true })).toBeVisible();
    await expect(comprador.getByText(nota)).toBeVisible();
    await comprador.context().close();

    // And for the seller.
    await vendedora.reload();
    await vendedora.waitForLoadState('networkidle');
    await expect(vendedora.getByText(/Confirmado por el comprador el/)).toBeVisible();
    await expect(vendedora.getByText(nota)).toBeVisible();
  } finally {
    // Closing twice is harmless; this only catches the ones still open after a failure.
    await Promise.all(abiertas.map((pagina) => pagina.context().close().catch(() => undefined)));
  }
});
