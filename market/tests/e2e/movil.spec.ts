import { expect, test } from '@playwright/test';

import { OPCIONES_CONTEXTO, seDesborda } from './ayuda';
import { entrarComo, pedidoPagadoDirecto, ponerNombre, productoDePrueba } from './clerk';

// The smallest common phone: 320 px. No screen of the buyer or the admin may scroll sideways.

const ANCHO = 320;
const OPCIONES = { ...OPCIONES_CONTEXTO, viewport: { width: ANCHO, height: 800 } } as const;

test.setTimeout(240_000);

test('compradora en 320 px: inicio, producto, carrito, orden y comprobante sin desborde', async ({ browser }) => {
  const producto = await productoDePrueba('Cacao móvil', 10, 350);
  const ordenId = await pedidoPagadoDirecto('comprador', producto, 1);
  const contexto = await browser.newContext(OPCIONES);
  try {
    const pagina = await contexto.newPage();
    await entrarComo(pagina, 'comprador');
    await ponerNombre(pagina, 'Comprador QA');
    const rutas = ['/', `/productos/${producto}`, '/carrito', `/ordenes/${ordenId}`, `/ordenes/${ordenId}/recibo`];
    for (const ruta of rutas) {
      await pagina.goto(ruta);
      await expect(pagina.getByRole('main')).toBeVisible({ timeout: 60_000 });
      expect(await seDesborda(pagina), `${ruta} se sale del ancho de ${ANCHO} px`).toBe(false);
    }
  } finally {
    await contexto.close();
  }
});

test('administradora en 320 px: cada pantalla de administración sin desborde', async ({ browser }) => {
  const contexto = await browser.newContext(OPCIONES);
  try {
    const pagina = await contexto.newPage();
    await entrarComo(pagina, 'admin');
    await ponerNombre(pagina, 'Admin QA');
    const rutas = ['/admin', '/admin/ordenes', '/admin/inventario', '/admin/embudo', '/admin/disputas', '/admin/negocios'];
    for (const ruta of rutas) {
      await pagina.goto(ruta);
      await expect(pagina.getByRole('main')).toBeVisible({ timeout: 60_000 });
      expect(await seDesborda(pagina), `${ruta} se sale del ancho de ${ANCHO} px`).toBe(false);
    }
  } finally {
    await contexto.close();
  }
});
