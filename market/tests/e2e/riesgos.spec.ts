import { randomUUID } from 'node:crypto';

import { expect, test } from '@playwright/test';

import { servicio } from './ayuda';
import { contextoComo, idDeCuenta, productoDePrueba } from './clerk';

// Risks a buyer meets on the phone: a double tap on "Hacer pedido", and an address that is not theirs.
// The last unit race and the expired invoice are covered by tests/db (pedidos, pago-doble) and btcpay-flujo.spec.ts.

test.setTimeout(180_000);

test('un doble toque en "Hacer pedido" crea una sola orden', async ({ browser }) => {
  const producto = await productoDePrueba('Cacao doble toque', 10);
  const { contexto, pagina } = await contextoComo(browser, 'comprador');
  try {
    const compradorId = await idDeCuenta('comprador');
    const inicio = new Date().toISOString();

    await pagina.goto(`/productos/${producto}`);
    await pagina.getByRole('button', { name: 'Agregar al carrito' }).click();
    await expect(pagina.getByText(/^Listo: agregaste/)).toBeVisible();
    await pagina.goto('/carrito');
    const pedir = pagina.getByRole('button', { name: 'Hacer pedido' });
    await expect(pedir).toBeEnabled({ timeout: 60_000 });
    await pedir.dblclick();
    await expect(pagina).toHaveURL(/\/ordenes\/[0-9a-f-]{36}\/pagar\/?$/, { timeout: 60_000 });
    await pagina.waitForTimeout(1500);

    const { data: ordenes, error } = await servicio()
      .from('ordenes')
      .select('id')
      .eq('comprador_id', compradorId)
      .gte('creada_en', inicio);
    if (error) throw error;
    expect(ordenes).toHaveLength(1);
  } finally {
    await contexto.close();
  }
});

test('una dirección de orden que no es suya dice "Esta página no existe"', async ({ browser }) => {
  const { contexto, pagina } = await contextoComo(browser, 'comprador');
  try {
    await pagina.goto(`/ordenes/${randomUUID()}`);
    await expect(pagina.getByRole('heading', { name: 'Esta página no existe.' })).toBeVisible({ timeout: 60_000 });
  } finally {
    await contexto.close();
  }
});
