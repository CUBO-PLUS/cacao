import { expect, test } from '@playwright/test';

import { servicio } from './ayuda';
import { CAFETAL, contextoComo, pedidoPagadoDirecto, productoDePrueba } from './clerk';

// A delivered order: the shop marks it ready, the buyer confirms receipt, then leaves one review. The paid
// order is arranged in the database; the purchase and the code delivery are covered by btcpay-flujo.spec.ts.

test.setTimeout(180_000);

test('compra entregada: el comprador confirma que la recibió y deja su reseña', async ({ browser }) => {
  const producto = await productoDePrueba('Cacao reseña', 10, 350);
  const ordenId = await pedidoPagadoDirecto('comprador', producto, 1);

  const { data: negocio, error: errorNegocio } = await servicio().from('negocios').select('usuario_id').eq('id', CAFETAL).single();
  if (errorNegocio) throw errorNegocio;
  const { error: errorLista } = await servicio().rpc('marcar_lista', { p_orden: ordenId, p_actor: negocio.usuario_id });
  if (errorLista) throw new Error(errorLista.message);

  const { contexto, pagina } = await contextoComo(browser, 'comprador');
  try {
    await pagina.goto(`/ordenes/${ordenId}`);
    await pagina.getByRole('button', { name: 'Ya lo recibí', exact: true }).click();
    await pagina.getByRole('button', { name: 'Sí, ya lo recibí', exact: true }).click();

    await expect(pagina.getByRole('heading', { name: 'Dejá tu reseña' })).toBeVisible({ timeout: 60_000 });
    // Centered first: at the bottom edge the fixed bottom bar would take the forced click.
    const cinco = pagina.locator('input[name="puntuacion"][value="5"]');
    await cinco.evaluate((e) => e.scrollIntoView({ block: 'center' }));
    await cinco.check({ force: true });
    await pagina.getByLabel('Comentario (opcional)').fill('Muy buen café, prueba de reseña.');
    await pagina.getByRole('button', { name: 'Enviar reseña', exact: true }).click();

    // Once reviewed the order offers nothing more to the buyer: the form leaves the page after a reload.
    await expect(pagina.getByRole('button', { name: 'Enviar reseña', exact: true })).toHaveCount(0, { timeout: 60_000 });
    await pagina.reload();
    await expect(pagina.getByRole('button', { name: 'Enviar reseña', exact: true })).toHaveCount(0);
    await expect(pagina.getByRole('heading', { name: 'Dejá tu reseña' })).toHaveCount(0);
  } finally {
    await contexto.close();
  }
});
