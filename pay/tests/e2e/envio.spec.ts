import { expect, test } from '@playwright/test';

import { OPCIONES_CONTEXTO, filaEnvioDb, sesionDe } from './ayuda';

// Amounts in dollars as the screen writes them ("$96.51") to integer cents.
function aCentavos(texto: string): number {
  const limpio = texto.replace(/[$,\s]/g, '');
  const [dolares, centavos = '00'] = limpio.split('.');
  return Number(dolares) * 100 + Number(centavos.padEnd(2, '0'));
}

const CODIGO = /CP-[23456789A-HJ-NP-Z]{4}-[23456789A-HJ-NP-Z]{4}/;

// The regtest test wallet of BTCPay, as the Lightning spec uses it.
const BTCPAY = 'http://127.0.0.1:8088/billetera/api';

test('Lucía envía $100.00 en efectivo y la transferencia llega a la página de Marta', async ({ browser }) => {
  const lucia = await sesionDe(browser, 'lucia');
  const ana = await sesionDe(browser, 'ana');
  const visitante = await browser.newContext(OPCIONES_CONTEXTO);
  try {
    // 1. Quote: $100.00 in cash. The fee is $1.99 plus 1.5%, so $3.49, and $96.51 arrives.
    await lucia.goto('/enviar');
    await lucia.getByLabel('Monto a enviar').fill('100');
    await lucia.getByLabel('Moneda que enviás').selectOption('USD');
    await lucia.getByLabel(/Efectivo:/).check();

    const cotizacion = lucia.locator('section[aria-labelledby="envio-cotizacion-titulo"]');
    const lineas = cotizacion.locator('dl > div');
    await expect(lineas).toHaveCount(4);
    await expect(lineas.nth(0)).toContainText('Enviás');
    await expect(lineas.nth(1)).toContainText('Comisión');
    await expect(lineas.nth(2)).toContainText('Tipo de cambio');
    await expect(lineas.nth(2)).toContainText('No hay cambio: El Salvador usa dólares');
    await expect(lineas.nth(3)).toContainText('Recibe');

    // Only the amount in each line: the fee line also carries its formula in words.
    const enviado = aCentavos(await lineas.nth(0).locator('.dato').first().innerText());
    const comision = aCentavos(await lineas.nth(1).locator('.dato').first().innerText());
    const recibe = aCentavos(await lineas.nth(3).locator('.dato').first().innerText());
    expect(enviado).toBe(10_000);
    expect(comision).toBe(349);
    expect(recibe).toBe(9_651);
    expect(enviado - comision).toBe(recibe);

    // 2. Recipient: Marta Hernández, a Salvadoran phone.
    await lucia.getByRole('button', { name: 'Seguir' }).click();
    await lucia.getByLabel('Cómo se llama quien recibe').fill('Marta Hernández');
    await lucia.getByLabel('Su celular o su correo').fill('7612 3456');
    await lucia.getByRole('button', { name: 'Seguir' }).click();

    // 3. Confirmation: the same numbers, then the transfer is created.
    await expect(lucia.getByRole('heading', { name: 'Revisá y confirmá' })).toBeVisible();
    await lucia.getByRole('button', { name: 'Confirmar envío' }).click();
    await lucia.waitForURL(/\/envios\/[0-9a-f-]{36}$/);
    const envioId = new URL(lucia.url()).pathname.split('/').pop() as string;

    // The transfer's own header, not the site header above it.
    const encabezado = lucia.locator('article header').first();
    const codigo = (await encabezado.locator('h1 .dato').innerText()).trim();
    expect(codigo).toMatch(CODIGO);
    await expect(encabezado.getByText('Sin enviar', { exact: true })).toBeVisible();
    const fila = await filaEnvioDb(envioId);
    expect(fila.codigo).toBe(codigo);
    expect(fila.estado).toBe('creada');

    // 4. With BTCPay on, the sender pays the invoice whatever the way of delivery. Without it, the sender
    // sends it now. Either way the state moves to "En camino" (the invoice path waits for the payment).
    const pagar = lucia.getByRole('button', { name: 'Preparar el pago' });
    if (await pagar.count()) {
      await pagar.click();
      const factura = await lucia.getByLabel('Código de pago').inputValue();
      const pago = await fetch(`${BTCPAY}/pagar`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ factura }),
      });
      expect(pago.ok).toBeTruthy();
    } else {
      await lucia.getByRole('button', { name: 'Enviar ahora' }).click();
      await lucia.getByRole('button', { name: 'Sí, enviar ahora' }).click();
    }
    await expect(encabezado.getByText('En camino', { exact: true })).toBeVisible({ timeout: 60_000 });

    // 5. A visitor with no account follows the code, typed in lower case without dashes.
    const pv = await visitante.newPage();
    await pv.goto('/rastrear');
    await pv.getByLabel('Código del envío').fill(codigo.replace(/-/g, '').toLowerCase());
    await pv.getByRole('button', { name: 'Seguir', exact: true }).click();
    await pv.waitForURL(new RegExp(`/t/${codigo}$`));
    const principal = pv.locator('main');
    await expect(principal.getByText('$96.51', { exact: true })).toBeVisible();
    await expect(principal.getByText('En camino', { exact: true })).toBeVisible();
    const htmlPublica = await pv.content();
    expect(htmlPublica).not.toContain('Lucía');
    expect(htmlPublica).not.toContain('7612');
    expect(htmlPublica).not.toContain('$3.49');

    // 6. Ana marks it delivered in the monitor.
    await ana.goto(`/monitor/envios/${envioId}`);
    await ana.getByRole('button', { name: 'Marcar como entregado' }).click();
    await ana.getByRole('button', { name: 'Sí, marcar como entregado' }).click();
    await expect(ana.getByText('Listo: el envío quedó como entregado.')).toBeVisible();

    // 7. Both pages pick up "Entregado" on their own, without a reload.
    await expect(pv.locator('main').getByText('Entregado', { exact: true }).first()).toBeVisible({ timeout: 40_000 });
    await expect(lucia.locator('article header').first().getByText('Entregado', { exact: true })).toBeVisible({
      timeout: 40_000,
    });

    // 8. The receipt shows the same four numbers as the quote.
    await lucia.goto(`/envios/${envioId}`);
    const comprobante = lucia.locator('section[aria-labelledby="titulo-comprobante"]');
    const detalle = comprobante.locator('dl').last().locator('> div');
    await expect(detalle).toHaveCount(4);
    await expect(detalle.nth(0)).toContainText('Enviaste');
    await expect(detalle.nth(0)).toContainText('$100.00');
    await expect(detalle.nth(1)).toContainText('$3.49');
    await expect(detalle.nth(3)).toContainText('$96.51');
    await expect(comprobante.getByText('$96.51', { exact: true })).toHaveCount(1);
    expect((await filaEnvioDb(envioId)).estado).toBe('completada');
  } finally {
    await visitante.close();
    await lucia.context().close();
    await ana.context().close();
  }
});
