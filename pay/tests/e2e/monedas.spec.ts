import { expect, test } from '@playwright/test';

import { sesionDe } from './ayuda';

// Amounts in cents from the screen text ("$96.51", "€1.99").
function aCentavos(texto: string): number {
  const limpio = texto.replace(/[$€,\s]/g, '');
  const [entero, centavos = '00'] = limpio.split('.');
  return Number(entero) * 100 + Number(centavos.padEnd(2, '0'));
}

// The number of sats from the screen text ("1,234 sats").
function sats(texto: string): number {
  return Number(texto.replace(/[,\s]|sats?/g, ''));
}

const cotizacion = (pagina: import('@playwright/test').Page) =>
  pagina.locator('section[aria-labelledby="envio-cotizacion-titulo"]');

test('euros a cuenta bancaria: 1 EUR = 1.08 USD y se recibe floor(neto * 1.08)', async ({ browser }) => {
  const lucia = await sesionDe(browser, 'lucia');
  try {
    await lucia.goto('/enviar');
    await lucia.getByLabel('Monto a enviar').fill('100');
    await lucia.getByLabel('Moneda que enviás').selectOption('EUR');
    await lucia.getByLabel(/Cuenta bancaria:/).check();

    const lineas = cotizacion(lucia).locator('dl > div');
    await expect(lineas).toHaveCount(4);
    await expect(lineas.nth(2)).toContainText('1 EUR = 1.08 USD');

    // Fee: $0.99 fixed plus 1% of €100.00 is €1.99. Net: €98.01, at 1.08 dollars per euro.
    const comision = aCentavos(await lineas.nth(1).locator('.dato').first().innerText());
    const enviado = aCentavos(await lineas.nth(0).locator('.dato').first().innerText());
    const recibidoTexto = await lineas.nth(3).locator('.dato').first().innerText();
    const neto = enviado - comision;
    expect(comision).toBe(199);
    expect(recibidoTexto.startsWith('$')).toBe(true);
    const esperado = Number((BigInt(neto) * BigInt(108_000_000)) / BigInt(100_000_000));
    expect(aCentavos(recibidoTexto)).toBe(esperado);
    expect(esperado).toBe(10_585);
  } finally {
    await lucia.context().close();
  }
});

test('dólares a sats por Lightning: la comisión va aparte del tipo de cambio', async ({ browser }) => {
  const precio = Number(process.env.PRECIO_FIJO_USD_BTC);
  test.skip(!precio, 'Falta PRECIO_FIJO_USD_BTC en .env.local: el envío por Lightning no tiene cotización.');
  const lucia = await sesionDe(browser, 'lucia');
  try {
    await lucia.goto('/enviar');
    await lucia.getByLabel('Monto a enviar').fill('100');
    await lucia.getByLabel('Moneda que enviás').selectOption('USD');
    await lucia.getByLabel(/Billetera de bitcoin:/).check();

    const lineas = cotizacion(lucia).locator('dl > div');
    await expect(lineas).toHaveCount(4);

    // Fee: 0.5% of $100.00, which is $0.50. Net $99.50, in sats at the BTC price.
    const comision = lineas.nth(1);
    await expect(comision).toContainText('$0.50');
    await expect(comision).toContainText('0.5% del monto');
    await expect(lineas.nth(2)).not.toContainText('$0.50');
    await expect(lineas.nth(2)).toContainText('1 USD =');
    await expect(lineas.nth(2)).toContainText('sats');

    const recibidos = sats(await lineas.nth(3).locator('.dato').first().innerText());
    const tasa8 = BigInt(Math.round((100_000_000 / precio) * 100_000_000));
    const esperado = Number((BigInt(9_950) * tasa8) / (BigInt(100) * BigInt(100_000_000)));
    expect(recibidos).toBe(esperado);
  } finally {
    await lucia.context().close();
  }
});

test('los límites: $0.50 y $5,000 se rechazan con un mensaje y el monto queda escrito', async ({ browser }) => {
  const lucia = await sesionDe(browser, 'lucia');
  try {
    await lucia.goto('/enviar');
    const monto = lucia.getByLabel('Monto a enviar');

    await monto.fill('0.50');
    await lucia.getByRole('button', { name: 'Seguir' }).click();
    await expect(lucia.locator('#envio-monto-error')).toContainText('entre $1.00 y $3,000.00');
    await expect(monto).toHaveValue('0.50');
    await expect(lucia.getByRole('heading', { name: 'Destinatario' })).toHaveCount(0);

    await monto.fill('5000');
    await lucia.getByRole('button', { name: 'Seguir' }).click();
    await expect(lucia.locator('#envio-monto-error')).toContainText('entre $1.00 y $3,000.00');
    await expect(monto).toHaveValue('5000');
    await expect(lucia.getByRole('heading', { name: 'Destinatario' })).toHaveCount(0);
  } finally {
    await lucia.context().close();
  }
});
