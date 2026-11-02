import { expect, test } from '@playwright/test';

import { OPCIONES_CONTEXTO, avanzarDb, crearEnvioDb, filaEnvioDb, pagarDb, sesionDe } from './ayuda';

// The buttons that move a transfer. None of them may show once the transfer has ended.
const ACCIONES = /Enviar ahora|Cancelar envío|Simular que retiró el dinero|Simular depósito|Simular que falló|Marcar como/;

test('cancelar antes de enviar: queda Cancelado sin más acciones, y el rastreo dice que no llega', async ({ browser }) => {
  const { codigo, id } = await crearEnvioDb({ remitente: 'lucia', nombre: 'Marta Hernández' });
  const lucia = await sesionDe(browser, 'lucia');
  const visitante = await browser.newContext(OPCIONES_CONTEXTO);
  try {
    await lucia.goto(`/envios/${id}`);
    const encabezado = lucia.locator('article header').first();
    await expect(encabezado.getByText('Sin enviar', { exact: true })).toBeVisible();

    await lucia.getByRole('button', { name: 'Cancelar envío' }).click();
    await lucia.getByRole('button', { name: 'Sí, cancelar el envío' }).click();
    await expect(encabezado.getByText('Cancelado', { exact: true })).toBeVisible();
    await expect(lucia.getByText('Cancelaste el envío. No se movió dinero.')).toBeVisible();

    // No further actions for the sender.
    await expect(lucia.getByRole('button', { name: ACCIONES })).toHaveCount(0);
    expect((await filaEnvioDb(id)).estado).toBe('cancelada');

    const pv = await visitante.newPage();
    await pv.goto(`/t/${codigo}`);
    await expect(pv.getByRole('region', { name: 'Estado del envío' }).getByText('Cancelado', { exact: true })).toBeVisible();
    await expect(pv.locator('main')).toContainText('No te va a llegar.');
  } finally {
    await visitante.close();
    await lucia.context().close();
  }
});

test('fallar desde el monitor: el remitente ve el motivo y el rastreo dice que no llegó', async ({ browser }) => {
  const { codigo, id } = await crearEnvioDb({ remitente: 'lucia', nombre: 'Marta Hernández', entrega: 'cuenta', montoCentavos: 5_000 });
  await avanzarDb(id, 'procesar');
  const lucia = await sesionDe(browser, 'lucia');
  const ana = await sesionDe(browser, 'ana');
  const visitante = await browser.newContext(OPCIONES_CONTEXTO);
  try {
    await ana.goto(`/monitor/envios/${id}`);
    await ana.getByRole('button', { name: 'Marcar como fallido' }).click();
    await ana.getByLabel('Motivo').fill('La cuenta destino está cerrada');
    await ana.getByRole('button', { name: 'Sí, marcar como fallido' }).click();
    await expect(ana.getByText('Listo: el envío quedó como fallido.')).toBeVisible();

    // The sender reads the reason on the receipt of the transfer.
    await lucia.goto(`/envios/${id}`);
    await expect(lucia.locator('article header').getByText('No se pudo entregar', { exact: true })).toBeVisible();
    const comprobante = lucia.locator('section[aria-labelledby="titulo-comprobante"]');
    await expect(comprobante).toContainText('La cuenta destino está cerrada');

    const pv = await visitante.newPage();
    await pv.goto(`/t/${codigo}`);
    await expect(pv.locator('main')).toContainText('El dinero no llegó.');
    await expect(pv.getByRole('region', { name: 'Estado del envío' }).getByText('No se pudo entregar', { exact: true })).toBeVisible();
    await expect(pv.getByRole('button', { name: ACCIONES })).toHaveCount(0);
  } finally {
    await visitante.close();
    await lucia.context().close();
    await ana.context().close();
  }
});

test('el remitente simula la llegada solo de un envío pagado, y el fallo de su propio envío en la demo', async ({ browser }) => {
  const llego = await crearEnvioDb({ remitente: 'lucia', nombre: 'Marta Hernández' });
  const fallo = await crearEnvioDb({ remitente: 'lucia', nombre: 'Marta Hernández' });
  await avanzarDb(llego.id, 'procesar');
  await avanzarDb(fallo.id, 'procesar');
  const lucia = await sesionDe(browser, 'lucia');
  try {
    // Without payment the sender cannot mark the arrival.
    await lucia.goto(`/envios/${llego.id}`);
    await expect(lucia.getByRole('button', { name: 'Simular que retiró el dinero' })).toHaveCount(0);

    // Simulated arrival, once the transfer is paid.
    await pagarDb(llego.id);
    await lucia.goto(`/envios/${llego.id}`);
    const encabezado = lucia.locator('article header').first();
    await expect(encabezado.getByText('En camino', { exact: true })).toBeVisible();
    await lucia.getByRole('button', { name: 'Simular que retiró el dinero' }).click();
    await expect(encabezado.getByText('Entregado', { exact: true })).toBeVisible();
    await expect(lucia.getByText('Simulamos que llegó. El envío quedó entregado.')).toBeVisible();

    // Simulated failure with a reason.
    await lucia.goto(`/envios/${fallo.id}`);
    await lucia.getByLabel('Motivo del fallo').fill('Prueba de fallo de demo');
    await lucia.getByRole('button', { name: 'Simular que falló' }).click();
    await expect(lucia.locator('article header').getByText('No se pudo entregar', { exact: true })).toBeVisible();
    await expect(lucia.getByText('Simulamos que falló. Mirá el motivo abajo.')).toBeVisible();
    await expect(lucia.locator('section[aria-labelledby="titulo-comprobante"]')).toContainText(
      'Prueba de fallo de demo',
    );
    expect((await filaEnvioDb(fallo.id)).estado).toBe('fallida');
  } finally {
    await lucia.context().close();
  }
});

test('un envío completado no ofrece acciones a nadie', async ({ browser }) => {
  const { id, codigo } = await crearEnvioDb({ remitente: 'lucia', nombre: 'Marta Hernández' });
  await avanzarDb(id, 'procesar');
  await avanzarDb(id, 'completar');
  const lucia = await sesionDe(browser, 'lucia');
  const ana = await sesionDe(browser, 'ana');
  const visitante = await browser.newContext(OPCIONES_CONTEXTO);
  try {
    await lucia.goto(`/envios/${id}`);
    await expect(lucia.locator('article header').getByText('Entregado', { exact: true })).toBeVisible();
    await expect(lucia.getByRole('button', { name: ACCIONES })).toHaveCount(0);

    await ana.goto(`/monitor/envios/${id}`);
    await expect(ana.getByText('No hay nada más que hacer: el envío ya terminó.')).toBeVisible();
    await expect(ana.getByRole('button', { name: ACCIONES })).toHaveCount(0);

    const pv = await visitante.newPage();
    await pv.goto(`/t/${codigo}`);
    await expect(pv.getByRole('button', { name: ACCIONES })).toHaveCount(0);
  } finally {
    await visitante.close();
    await lucia.context().close();
    await ana.context().close();
  }
});

