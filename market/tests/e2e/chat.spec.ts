import { randomUUID } from 'node:crypto';

import { expect, test } from '@playwright/test';

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

// Creates a product of a seller through the database function.
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

// Arranges an order through the database functions: created, payment request, and paid if asked.
async function ordenPorRpc(comprador: Persona, producto: { id: string; negocioId: string }, pagada: boolean) {
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
  if (pagada) {
    const { error: errorPago } = await s.rpc('confirmar_pago', { p_orden: orden.id, p_actor: null });
    if (errorPago) throw new Error(errorPago.message);
  }
  return orden.id as string;
}

test('chat: el mensaje llega a la otra parte sin recargar', async ({ browser }) => {
  const producto = await productoDe('rosa', 5, `Prueba chat ${Date.now()}`);
  const ordenId = await ordenPorRpc('lucia', producto, true);
  const comprador = await paginaComo(browser, 'lucia');
  const vendedora = await paginaComo(browser, 'rosa');

  try {
    await comprador.goto(`/ordenes/${ordenId}`);
    await comprador.waitForLoadState('networkidle');
    await vendedora.goto(`/ordenes/${ordenId}`);
    await vendedora.waitForLoadState('networkidle');

    // Marks the seller's page so a reload would be visible.
    await vendedora.evaluate(() => {
      (window as unknown as { sinRecargar?: boolean }).sinRecargar = true;
    });

    const preguntaTexto = 'Hola, tenés cacao para el sábado?';
    await comprador.getByLabel('Escribí un mensaje').fill(preguntaTexto);
    await comprador.getByRole('button', { name: 'Enviar' }).click();
    await expect(comprador.getByRole('log').getByText(preguntaTexto)).toBeVisible();
    await expect(vendedora.getByRole('log').getByText(preguntaTexto)).toBeVisible({ timeout: 15_000 });

    const respuestaTexto = 'Sí, tengo fresco para el sábado.';
    await vendedora.getByLabel('Escribí un mensaje').fill(respuestaTexto);
    await vendedora.getByRole('button', { name: 'Enviar' }).click();
    await expect(comprador.getByRole('log').getByText(respuestaTexto)).toBeVisible({ timeout: 15_000 });

    const sinRecargar = await vendedora.evaluate(
      () => (window as unknown as { sinRecargar?: boolean }).sinRecargar === true,
    );
    expect(sinRecargar).toBe(true);
  } finally {
    await comprador.context().close();
    await vendedora.context().close();
  }
});

test('chat: no se puede enviar un mensaje vacío', async ({ browser }) => {
  const producto = await productoDe('rosa', 5, `Prueba chat vacio ${Date.now()}`);
  const ordenId = await ordenPorRpc('lucia', producto, true);
  const comprador = await paginaComo(browser, 'lucia');

  try {
    await comprador.goto(`/ordenes/${ordenId}`);
    await comprador.waitForLoadState('networkidle');

    const enviar = comprador.getByRole('button', { name: 'Enviar' });
    const campo = comprador.getByLabel('Escribí un mensaje');
    await expect(enviar).toBeDisabled();

    // Only spaces: still no send, and Enter does nothing.
    await campo.fill('   ');
    await expect(enviar).toBeDisabled();
    await campo.press('Enter');
    await expect(campo).toHaveValue('   ');

    const { count, error } = await servicio()
      .from('mensajes')
      .select('id', { count: 'exact', head: true })
      .eq('orden_id', ordenId);
    if (error) throw error;
    expect(count).toBe(0);
    await expect(comprador.getByRole('log').getByRole('article')).toHaveCount(0);
  } finally {
    await comprador.context().close();
  }
});
