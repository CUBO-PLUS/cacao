import { expect, test } from '@playwright/test';

import { OPCIONES_CONTEXTO, seDesborda, servicio } from './ayuda';
import { CAFETAL, contextoComo, entrarComo, idDeCuenta, ponerNombre, productoDePrueba } from './clerk';

// The shop side. The admin account owns the Cafetal shop for this check (as the buyer flow does), then gets
// it back. A product the shop publishes shows in its own page and on the buyer's product page.

test.setTimeout(180_000);

test('la tienda publica un producto: aparece en Mi negocio y en la página del producto', async ({ browser }) => {
  const { data: negocio, error } = await servicio().from('negocios').select('usuario_id').eq('id', CAFETAL).single();
  if (error) throw error;
  const duenoOriginal = negocio.usuario_id as string;
  await servicio().from('negocios').update({ usuario_id: await idDeCuenta('admin') }).eq('id', CAFETAL);

  const nombre = `Miel de prueba ${Date.now()}`;
  let vendedora: Awaited<ReturnType<typeof contextoComo>> | null = null;
  try {
    const productoId = await productoDePrueba(nombre, 8, 600);
    vendedora = await contextoComo(browser, 'admin');
    await vendedora.pagina.goto('/mi-negocio/productos');
    await expect(vendedora.pagina.getByText(nombre, { exact: false }).first()).toBeVisible({ timeout: 60_000 });

    const compradora = await browser.newContext(OPCIONES_CONTEXTO);
    try {
      const pagina = await compradora.newPage();
      await entrarComo(pagina, 'comprador');
      await ponerNombre(pagina, 'Comprador QA');
      await pagina.goto(`/productos/${productoId}`);
      await expect(pagina.getByRole('heading', { level: 1, name: new RegExp(nombre) })).toBeVisible({ timeout: 60_000 });
      expect(await seDesborda(pagina)).toBe(false);
    } finally {
      await compradora.close();
    }
  } finally {
    await vendedora?.contexto.close();
    await servicio().from('negocios').update({ usuario_id: duenoOriginal }).eq('id', CAFETAL);
  }
});
