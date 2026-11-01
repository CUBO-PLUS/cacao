import { expect, test } from '@playwright/test';

import { contextoComo, hacerPedido, pedidoPagadoDirecto, productoDePrueba } from './clerk';
import { seDesborda, servicio } from './ayuda';

// The receipt of a paid order: the buyer sees the totals and the parties, a stranger does not, and an
// unpaid order goes back to the order. The paid order is arranged in the database; the payment itself
// is covered by btcpay-flujo.spec.ts.

test.setTimeout(180_000);

test('el comprobante de una orden pagada: totales, partes y el aviso; sin sesión no se ve', async ({ browser }) => {
  const producto = await productoDePrueba('Cacao comprobante', 10, 350);
  const ordenId = await pedidoPagadoDirecto('comprador', producto, 2);
  const { data: orden, error: errorOrden } = await servicio().from('ordenes').select('negocio_id').eq('id', ordenId).single();
  if (errorOrden) throw errorOrden;
  const { data: negocio, error } = await servicio().from('negocios').select('nombre').eq('id', orden.negocio_id).single();
  if (error) throw error;

  const { contexto, pagina } = await contextoComo(browser, 'comprador');
  try {
    await pagina.goto(`/ordenes/${ordenId}/recibo`);
    // Scoped to the receipt: the page's other headings also say "Orden N".
    const recibo = pagina.getByRole('article', { name: 'Comprobante de pago' });
    await expect(recibo.getByRole('heading', { name: 'Comprobante de pago' })).toBeVisible({ timeout: 60_000 });
    await expect(recibo.getByText(/^Orden \d+$/)).toBeVisible();
    await expect(recibo.getByText('Bitcoin por Lightning, pago simulado')).toBeVisible();
    await expect(recibo.getByText(/^1 BTC = \$[\d,]+\.\d{2}$/)).toBeVisible();
    await expect(recibo.getByText(negocio.nombre, { exact: true })).toBeVisible();
    await expect(recibo.getByText('2 × $3.50 por libra')).toBeVisible();
    await expect(recibo.getByText(/^\$7\.00 · [\d,]+ sats$/).last()).toBeVisible();
    await expect(
      recibo.getByText(/Este comprobante no es un documento tributario\. La factura electrónica \(DTE\) la emite el vendedor/),
    ).toBeVisible();
    expect(await seDesborda(pagina), 'El comprobante se sale del ancho del celular').toBe(false);

    // Printing shows the receipt alone: the button and the navigation are hidden.
    await pagina.emulateMedia({ media: 'print' });
    await expect(pagina.getByRole('button', { name: 'Imprimir o guardar como PDF' })).toBeHidden();
    await expect(recibo.getByRole('heading', { name: 'Comprobante de pago' })).toBeVisible();
    await pagina.emulateMedia({ media: 'screen' });
  } finally {
    await contexto.close();
  }

  // Without a session the receipt asks to sign in; it never shows the order.
  const anonimo = await browser.newContext();
  try {
    const pagina = await anonimo.newPage();
    await pagina.goto(`/ordenes/${ordenId}/recibo`);
    await expect(pagina).toHaveURL(/\/entrar/, { timeout: 60_000 });
    await expect(pagina.getByRole('heading', { name: 'Comprobante de pago' })).toHaveCount(0);
  } finally {
    await anonimo.close();
  }
});

test('una orden sin pagar no tiene comprobante: vuelve a la orden', async ({ browser }) => {
  const producto = await productoDePrueba('Cacao sin pagar comprobante', 5);
  const { contexto, pagina } = await contextoComo(browser, 'comprador');
  try {
    const ordenId = await hacerPedido(pagina, producto, 1);
    // Not paid: the receipt address leads back to the order.
    await pagina.goto(`/ordenes/${ordenId}/recibo`);
    await expect(pagina).toHaveURL(new RegExp(`/ordenes/${ordenId}/?$`), { timeout: 60_000 });
    await expect(pagina.getByRole('heading', { name: 'Comprobante de pago' })).toHaveCount(0);
  } finally {
    await contexto.close();
  }
});
