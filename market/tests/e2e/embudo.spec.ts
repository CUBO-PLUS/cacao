import { expect, test } from '@playwright/test';

import { servicio } from './ayuda';
import {
  contextoComo,
  facturaEnPantalla,
  pagarEnBilletera,
  productoDePrueba,
  sesionDeContexto,
} from './clerk';

// One buyer walks the purchase and the funnel records each step, in order, under the buyer's visit.
// The five steps are the market's funnel: product view, cart, checkout start (order placed), payment screen
// and payment. The database holds one row per event, so the order is read from the event ids.

const PASOS = ['vista_producto', 'agrego_carrito', 'inicio_pedido', 'vio_pago', 'pago'] as const;
const ETIQUETAS = ['Vio un producto', 'Agregó al carrito', 'Hizo el pedido', 'Abrió la pantalla de pago', 'Pagó'];

test.describe.configure({ mode: 'serial' });
test.setTimeout(240_000);

async function nombresDeVisita(sesion: string): Promise<string[]> {
  const { data, error } = await servicio()
    .from('eventos')
    .select('nombre')
    .eq('sitio', 'market')
    .eq('sesion', sesion)
    .order('id');
  if (error) throw error;
  // The first row of each name is the moment the step was reached.
  const vistos: string[] = [];
  for (const fila of data ?? []) {
    const nombre = fila.nombre as string;
    if ((PASOS as readonly string[]).includes(nombre) && !vistos.includes(nombre)) vistos.push(nombre);
  }
  return vistos;
}

test('una compra deja los cinco eventos del embudo, en orden, bajo la misma visita', async ({ browser }) => {
  const producto = await productoDePrueba('Café embudo', 20);
  const { contexto, pagina } = await contextoComo(browser, 'comprador');
  try {
    // Product view and cart addition are sent by the browser; the rest by the server.
    // The view is recorded first and sets the visit's cookie. The click waits for that answer, so the cart
    // event joins the same visit instead of starting a second one.
    const vista = pagina.waitForResponse((respuesta) => respuesta.url().endsWith('/api/evento'));
    await pagina.goto(`/productos/${producto}`);
    await vista;
    await expect(pagina.getByRole('heading', { level: 1 })).toBeVisible();
    await pagina.getByRole('button', { name: 'Agregar al carrito' }).click();
    await expect(pagina.getByText(/^Listo: agregaste/)).toBeVisible();

    await pagina.goto('/carrito');
    const pedir = pagina.getByRole('button', { name: 'Hacer pedido' });
    await expect(pedir).toBeEnabled({ timeout: 60_000 });
    await pedir.click();
    await expect(pagina).toHaveURL(/\/ordenes\/[0-9a-f-]{36}\/pagar\/?$/, { timeout: 60_000 });

    const factura = await facturaEnPantalla(pagina);
    await pagarEnBilletera(factura);
    await expect(pagina).not.toHaveURL(/\/pagar\/?$/, { timeout: 60_000 });

    const sesion = await sesionDeContexto(contexto);
    expect(sesion, 'La visita no tiene id de sesión del embudo').not.toBeNull();
    await expect
      .poll(() => nombresDeVisita(sesion as string), { timeout: 30_000, message: 'Faltan pasos del embudo' })
      .toEqual([...PASOS]);
  } finally {
    await contexto.close();
  }
});

test('el panel de embudo muestra los cinco pasos con su etiqueta', async ({ browser }) => {
  const { contexto, pagina } = await contextoComo(browser, 'admin');
  try {
    await pagina.goto('/admin/embudo');
    for (const etiqueta of ETIQUETAS) {
      await expect(pagina.getByText(etiqueta, { exact: true }).first()).toBeVisible({ timeout: 60_000 });
    }
  } finally {
    await contexto.close();
  }
});
