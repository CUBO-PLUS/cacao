import { expect, type Page, test } from '@playwright/test';

import { OPCIONES_CONTEXTO, crearEnvioDb, sesionDe } from './ayuda';

// The narrowest phone the app is built for. Nothing may scroll sideways here.
const ANCHO = 320;

// Opens each route and checks it answers and has no sideways scroll. Signed-out visitors are sent to
// /entrar, which is a page too, so every route is still checked.
async function recorrer(pagina: Page, rutas: string[]) {
  await pagina.setViewportSize({ width: ANCHO, height: 700 });
  for (const ruta of rutas) {
    const respuesta = await pagina.goto(ruta);
    expect(respuesta?.status(), `estado de ${ruta}`).toBeLessThan(500);
    await pagina.waitForLoadState('networkidle');
    await expect(pagina.locator('h1').first(), ruta).toBeVisible();
    const desborde = await pagina.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(desborde, `${ruta} se corre ${desborde}px a los lados`).toBeLessThanOrEqual(0);
  }
}

// A transfer from Lucía to a phone that is not registered, and one to Rosa's phone.
async function envioDeLucia() {
  return crearEnvioDb({ remitente: 'lucia', nombre: 'Marta Hernández', contacto: '+503 7612 3456', nota: 'Una nota de prueba' });
}

test('sin sesión: las rutas públicas no se corren a los lados en 320 px', async ({ browser }) => {
  const { codigo } = await envioDeLucia();
  const visitante = await browser.newContext(OPCIONES_CONTEXTO);
  try {
    const pagina = await visitante.newPage();
    await recorrer(pagina, ['/', '/hacienda', '/entrar', '/rastrear', `/t/${codigo}`, '/t/CP-ABCD-EFGH', '/enviar', '/envios', '/recibidos', '/cuenta', '/admin']);
  } finally {
    await visitante.close();
  }
});

test('como remitente: las pantallas de envío no se corren a los lados en 320 px', async ({ browser }) => {
  const { id } = await envioDeLucia();
  const lucia = await sesionDe(browser, 'lucia');
  try {
    await recorrer(lucia, ['/', '/enviar', '/envios', `/envios/${id}`, '/recibidos', '/rastrear', '/cuenta']);
  } finally {
    await lucia.context().close();
  }
});

test('como destinataria: sus pantallas no se corren a los lados en 320 px', async ({ browser }) => {
  const { id } = await crearEnvioDb({ remitente: 'lucia', nombre: 'Mamá Rosa', contacto: '+503 7000 0002', nota: 'Nota de prueba para Rosa' });
  const rosa = await sesionDe(browser, 'rosa');
  try {
    await recorrer(rosa, ['/recibidos', `/recibidos/${id}`, '/enviar', '/cuenta']);
  } finally {
    await rosa.context().close();
  }
});

test('como administradora: el monitor completo no se corre a los lados en 320 px', async ({ browser }) => {
  const { id } = await envioDeLucia();
  const ana = await sesionDe(browser, 'ana');
  try {
    await recorrer(ana, ['/admin', '/admin/envios', `/admin/envios/${id}`, '/admin/embudo', '/admin/tarifas', '/envios']);
  } finally {
    await ana.context().close();
  }
});
