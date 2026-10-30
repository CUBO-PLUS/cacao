import { readFile } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

const PAGA = '/historias/la-barra-de-santiago/';
const OTRA_PAGA = '/historias/lago-de-ilopango-volcan-lleno-de-agua/';
const GRATIS = '/historias/como-pedir-un-cafe-de-altura/';
const SLUG = 'la-barra-de-santiago';
const OTRO_SLUG = 'lago-de-ilopango-volcan-lleno-de-agua';
const CLAVE = `cacao-gate:${SLUG}`;
const DIA = 24 * 60 * 60 * 1000;

const TRAVEL = 'https://cacao-travel.vercel.app';
const TOUR = {
  id: 'prueba',
  titulo: 'Experiencia de prueba',
  lugar: 'El Zonte',
  duracion: '3 horas',
  nivel: 'Fácil',
  precio: 45000,
  url: `${TRAVEL}/experiencias/prueba/`,
  foto: `${TRAVEL}/fotos/prueba.jpg`,
  historias: [SLUG],
};

const muro = (page: Page) => page.locator('[data-gate-muro]');
const cerrado = (page: Page) => page.locator('[data-gate-cerrado]');

/**
 * The simulated-payment buttons exist only when the server runs with PUBLIC_DEMO=1. In the real BTCPay mode
 * these tests skip; that path is covered by media-btcpay.spec.ts.
 */
async function requiereDemo(request: APIRequestContext): Promise<void> {
  const html = await (await request.get(PAGA)).text();
  test.skip(!html.includes('data-gate-simular'), 'Requiere el servidor con PUBLIC_DEMO=1: el pago real está en media-btcpay.spec.ts.');
}

/** Asks for an invoice from the gate and returns its id. */
async function pedirFactura(page: Page): Promise<string> {
  const respuesta = page.waitForResponse((r) => r.url().endsWith('/api/cobro/') && r.request().method() === 'POST');
  await page.locator('[data-gate-pedir]').click();
  const datos = (await (await respuesta).json()) as { id: string };
  await expect(muro(page)).toHaveAttribute('data-paso', 'pendiente');
  return datos.id;
}

/** Full simulated payment through the gate: invoice, "Simular pago", story open. */
async function pagarHistoria(page: Page): Promise<void> {
  await pedirFactura(page);
  await page.locator('[data-gate-simular]').click();
  await expect(cerrado(page)).toBeVisible();
}

/** Service-role client for steps a reader cannot take (expiring an invoice). Run with --env-file=.env.local. */
function servicio() {
  const url = process.env.SUPABASE_URL;
  const clave = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !clave) throw new Error('Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY: correr con --env-file=.env.local.');
  return createClient(url, clave, { auth: { persistSession: false, autoRefreshToken: false } });
}

/** Eight words from one plain text run of locked HTML: no tags, entities or doubled spaces inside them. */
function muestraDe(html: string): string | null {
  for (const bloque of html.match(/>[^<>\n]+</g) ?? []) {
    const texto = bloque.slice(1, -1).trim();
    if (texto.includes('&') || /\s{2}/.test(texto)) continue;
    const palabras = texto.split(' ');
    if (palabras.length >= 8) return palabras.slice(0, 8).join(' ');
  }
  return null;
}

/**
 * A sentence of the locked text, read at run time: from media_cerrado with the service role, or from the
 * local src/data/cerrado.json that scripts/cerrado.mjs writes. Null when neither can give one.
 */
async function fraseCerrada(): Promise<string | null> {
  let html: string | null = null;
  if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    const { data } = await servicio().from('media_cerrado').select('html').eq('slug', SLUG).maybeSingle();
    html = (data as { html: string } | null)?.html ?? null;
  }
  if (!html) {
    try {
      const cache = JSON.parse(await readFile('src/data/cerrado.json', 'utf8')) as Record<string, string>;
      html = cache[SLUG] ?? null;
    } catch {
      html = null;
    }
  }
  return html ? muestraDe(html) : null;
}

test('paid story starts locked with its price and the unlock button', async ({ page, request }) => {
  await requiereDemo(request);
  await page.goto(PAGA);
  await expect(page.locator('article[data-historia]')).toHaveAttribute('data-gate-estado', 'bloqueado');
  await expect(cerrado(page)).toBeHidden();
  await expect(muro(page)).toBeVisible();
  await expect(muro(page)).toHaveAttribute('data-paso', 'inicio');
  await expect(page.locator('[data-gate-pastilla]')).toHaveText('120 sats');
  await expect(page.locator('[data-gate-pedir]')).toHaveText('Desbloquear por 120 sats');
  // The USD value comes from the server's price, beside the sats.
  await expect(page.locator('[data-gate-usd]')).toBeVisible();
  await expect(page.locator('[data-gate-usd]')).toHaveText(/^· \$\d+\.\d{2}$/);
  await expect(muro(page)).toContainText('Modo demo');
});

test('the invoice shows a QR, the amount and a countdown', async ({ page, request }) => {
  await requiereDemo(request);
  await page.goto(PAGA);
  await pedirFactura(page);
  await expect(page.locator('[data-gate-qr]')).toHaveAttribute('alt', 'Código QR de la factura');
  await expect(page.locator('[data-gate-qr]')).toHaveAttribute('src', /^data:image\/png/);
  await expect(page.locator('[data-gate-factura]')).toHaveText(/^lnsim1[0-9a-f]{40}$/);
  await expect(page.locator('[data-gate-monto]')).toHaveText(/^120 sats · \$\d+\.\d{2}$/);
  await expect(page.locator('[data-gate-cuenta]')).toHaveText(/^[0-5]:[0-5]\d$/);
  await expect(page.getByRole('button', { name: 'Copiar factura' })).toBeVisible();
  await expect(page.locator('[data-gate-estado-texto]')).toHaveText('Esperando el pago. Esta página se actualiza sola.');
  await expect(page.locator('[data-gate-estado-texto]')).toHaveAttribute('aria-live', 'polite');
  await expect(page.getByText('Pago simulado (modo demo)')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Simular pago', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Simular pago fallido' })).toBeVisible();
});

test('paying opens the story without a scroll jump', async ({ page, request }) => {
  await requiereDemo(request);
  await page.goto(PAGA);
  await pedirFactura(page);
  const simular = page.locator('[data-gate-simular]');
  // Bring the demo button into view first, so the click itself does not scroll the page.
  await simular.scrollIntoViewIfNeeded();
  const antes = await page.evaluate(() => window.scrollY);
  await simular.click();
  await expect(cerrado(page)).toBeVisible();
  const despues = await page.evaluate(() => window.scrollY);
  expect(Math.abs(despues - antes)).toBeLessThan(5);
  await expect(page.locator('article[data-historia]')).toHaveAttribute('data-gate-estado', 'desbloqueado');
  await expect(page.locator('[data-gate-pastilla]')).toHaveText('Desbloqueado');
});

test('the unlock lasts seven days and survives a reload', async ({ page, request }) => {
  await requiereDemo(request);
  await page.goto(PAGA);
  await pagarHistoria(page);

  const expira = await page.evaluate((k) => JSON.parse(localStorage.getItem(k)!).expira, CLAVE);
  expect(expira - Date.now()).toBeGreaterThan(6.9 * DIA);
  expect(expira - Date.now()).toBeLessThanOrEqual(7 * DIA);

  await page.reload();
  await expect(cerrado(page)).toBeVisible();
});

test('a second visit in the same browser opens the story without paying again', async ({ page, request }) => {
  await requiereDemo(request);
  await page.goto(PAGA);
  await pagarHistoria(page);

  // Only the cookie is left: the stored pass is gone.
  await page.evaluate(() => localStorage.clear());
  const pedidos: string[] = [];
  page.on('request', (r) => {
    if (r.method() === 'POST' && r.url().includes('/api/cobro/')) pedidos.push(r.url());
  });
  await page.goto(PAGA);
  await expect(cerrado(page)).toBeVisible();
  await expect(muro(page)).toBeHidden();
  expect(pedidos).toEqual([]);
});

test('reading the unlocked part sets the state to leyendo', async ({ page, request }) => {
  await requiereDemo(request);
  await page.goto(PAGA);
  await pagarHistoria(page);
  await expect(page.locator('article[data-historia]')).toHaveAttribute('data-gate-estado', 'desbloqueado');
  await expect(page.locator('[data-gate-pastilla]')).toHaveText('Desbloqueado');
  await page.mouse.wheel(0, 800);
  await expect(page.locator('article[data-historia]')).toHaveAttribute('data-gate-estado', 'leyendo');
  await expect(page.locator('[data-gate-pastilla]')).toHaveText('Leyendo');
});

test('the failed path explains itself and the reader can try again', async ({ page, request }) => {
  await requiereDemo(request);
  await page.goto(PAGA);
  await pedirFactura(page);
  await page.locator('[data-gate-fallar]').click();
  await expect(muro(page)).toHaveAttribute('data-paso', 'fallida');
  await expect(page.locator('[data-gate-estado-texto]')).toHaveText('El pago no se completó.');
  await expect(page.locator('[data-gate-motivo]')).toContainText('no se completó');
  await expect(page.locator('[data-gate-pedir]')).toHaveText('Intentar de nuevo');
  await expect(cerrado(page)).toBeHidden();

  await page.locator('[data-gate-pedir]').click();
  await expect(muro(page)).toHaveAttribute('data-paso', 'pendiente');
  await page.locator('[data-gate-simular]').click();
  await expect(cerrado(page)).toBeVisible();
});

test('an expired invoice reads vencida and a new one can be asked for', async ({ page }) => {
  await page.goto(PAGA);
  const id = await pedirFactura(page);
  const { error } = await servicio()
    .from('media_cobros')
    .update({ expira_en: new Date(Date.now() - 1000).toISOString() })
    .eq('id', id);
  expect(error).toBeNull();

  // The page polls every 3 seconds; the server closes the invoice on the next look.
  await expect(muro(page)).toHaveAttribute('data-paso', 'vencida', { timeout: 15_000 });
  await expect(page.locator('[data-gate-estado-texto]')).toHaveText('La factura venció. No la pagués.');
  await expect(page.locator('[data-gate-pedir]')).toHaveText('Pedir otra factura');
  await expect(cerrado(page)).toBeHidden();

  await page.locator('[data-gate-pedir]').click();
  await expect(muro(page)).toHaveAttribute('data-paso', 'pendiente');
});

test('a different browser stays locked and cannot read the first invoice', async ({ page, browser, request }) => {
  await requiereDemo(request);
  await page.goto(PAGA);
  const id = await pedirFactura(page);
  await page.locator('[data-gate-simular]').click();
  await expect(cerrado(page)).toBeVisible();

  const otra = await browser.newContext({ baseURL: 'http://localhost:4321' });
  try {
    const pagina = await otra.newPage();
    await pagina.goto(PAGA);
    await expect(muro(pagina)).toBeVisible();
    await expect(cerrado(pagina)).toBeHidden();
    expect((await otra.request.get(`/api/cobro/${id}/`)).status()).toBe(404);
    expect((await otra.request.post(`/api/cobro/${id}/pagar/`)).status()).toBe(404);
    expect((await otra.request.post('/api/desbloquear/', { data: { slug: SLUG } })).status()).toBe(402);
  } finally {
    await otra.close();
  }
});

test('an expired stored pass is renewed from the cookie', async ({ page, request }) => {
  await requiereDemo(request);
  await page.goto(PAGA);
  await pagarHistoria(page);
  await page.evaluate((k) => localStorage.setItem(k, JSON.stringify({ token: 'viejo', expira: Date.now() - 1000 })), CLAVE);
  await page.reload();
  await expect(cerrado(page)).toBeVisible();
  await expect(page.locator('article[data-historia]')).toHaveAttribute('data-gate-estado', /^(desbloqueado|leyendo)$/);
});

test('the locked text is not in the page and the server refuses it without a valid pass', async ({ page, request }) => {
  await requiereDemo(request);
  const frase = await fraseCerrada();
  if (!frase) {
    test.skip(true, `Sin texto cerrado de muestra para ${SLUG}: correr con --env-file=.env.local o tener src/data/cerrado.json.`);
    return;
  }
  const fuente = await (await request.get(PAGA)).text();
  expect(fuente).not.toContain(frase);

  const api = `/api/contenido/${SLUG}/`;
  expect((await request.get(api)).status()).toBe(401);
  expect((await request.get(api, { headers: { Authorization: 'Bearer abc.def' } })).status()).toBe(401);

  // A real pass for a different story does not open this one.
  await page.goto(OTRA_PAGA);
  await pagarHistoria(page);
  const otra = await page.evaluate((k) => localStorage.getItem(k), `cacao-gate:${OTRO_SLUG}`);
  const tokenOtra = (JSON.parse(otra!) as { token: string }).token;
  expect((await request.get(api, { headers: { Authorization: `Bearer ${tokenOtra}` } })).status()).toBe(401);

  // Tampering with the payload breaks the signature.
  const [, firma] = tokenOtra.split('.');
  const falso = Buffer.from(JSON.stringify({ tipo: 'pago', slugs: [SLUG], exp: Date.now() + 1e9 })).toString('base64url');
  expect((await request.get(api, { headers: { Authorization: `Bearer ${falso}.${firma}` } })).status()).toBe(401);

  // The right pass gets the text.
  await page.goto(PAGA);
  await pagarHistoria(page);
  const buena = (await page.evaluate((k) => JSON.parse(localStorage.getItem(k)!), CLAVE)) as { token: string };
  const r = await request.get(api, { headers: { Authorization: `Bearer ${buena.token}` } });
  expect(r.status()).toBe(200);
  expect((await r.json()).html).toContain(frase);
});

test('the unlock API answers 402 without access and never gives a free story', async ({ request }) => {
  const sinAcceso = await request.post('/api/desbloquear/', { data: { slug: SLUG } });
  expect(sinAcceso.status()).toBe(402);
  expect((await sinAcceso.json()).error).toBe('Esta historia se desbloquea pagando su factura.');

  expect((await request.post('/api/desbloquear/', { data: { slug: 'como-pedir-un-cafe-de-altura' } })).status()).toBe(404);
  expect((await request.post('/api/desbloquear/', { data: { slug: '../../etc/passwd' } })).status()).toBe(404);
});

test('the invoice route refuses a free story and an unknown one', async ({ request }) => {
  expect((await request.post('/api/cobro/', { data: { slug: 'como-pedir-un-cafe-de-altura' } })).status()).toBe(404);
  expect((await request.post('/api/cobro/', { data: { slug: '../../etc/passwd' } })).status()).toBe(404);
});

test('the events route answers 204 to anything, so the page never breaks', async ({ request }) => {
  const valido = await request.post('/api/evento/', { data: { nombre: 'vio_muro', objeto: SLUG, ruta: PAGA } });
  expect(valido.status()).toBe(204);
  expect((await request.post('/api/evento/', { data: { nombre: 'pago' } })).status()).toBe(204);
  expect((await request.post('/api/evento/', { data: 'no es json' })).status()).toBe(204);
});

test('opening a paid story sends the first funnel event', async ({ page }) => {
  const evento = page.waitForRequest((r) => r.url().endsWith('/api/evento/') && (r.postData() ?? '').includes('vista_historia'));
  await page.goto(PAGA);
  expect((await evento).postDataJSON()).toMatchObject({ nombre: 'vista_historia', objeto: SLUG });
});

test('a device that lies about its expiry is corrected by the server', async ({ page }) => {
  await page.goto(PAGA);
  await page.evaluate((k) => localStorage.setItem(k, JSON.stringify({ token: 'inventado.firma', expira: Date.now() + 1e9 })), CLAVE);
  await page.reload();
  await expect(muro(page)).toHaveAttribute('data-paso', 'inicio');
  await expect(muro(page)).toBeVisible();
  await expect(cerrado(page)).toBeHidden();
  expect(await page.evaluate((k) => localStorage.getItem(k), CLAVE)).toBeNull();
});

test('without a database the gate says payments are not available and stays closed', async ({ page }) => {
  await page.route('**/api/desbloquear/', (r) =>
    r.fulfill({ status: 503, json: { error: 'Los pagos no están disponibles en este momento.' } }),
  );
  await page.goto(PAGA);
  await expect(muro(page)).toHaveAttribute('data-paso', 'sin-base');
  await expect(page.locator('[data-gate-estado-texto]')).toHaveText('Los pagos no están disponibles en este momento.');
  await expect(page.locator('[data-gate-pedir]')).toBeHidden();
  await expect(cerrado(page)).toBeHidden();
});

test('unlocking one story does not unlock another', async ({ page, request }) => {
  await requiereDemo(request);
  await page.goto(PAGA);
  await pagarHistoria(page);
  await page.goto(OTRA_PAGA);
  await expect(cerrado(page)).toBeHidden();
});

test('a failed invoice request explains itself', async ({ page }) => {
  await page.route('**/api/cobro/', (r) => r.abort());
  await page.goto(PAGA);
  await page.locator('[data-gate-pedir]').click();
  await expect(page.locator('[data-gate-error]')).toBeVisible();
  await expect(page.locator('[data-gate-error]')).toContainText('No pudimos');
  await expect(muro(page)).toBeVisible();
});

test('the story opens even when the browser blocks storage', async ({ page, request }) => {
  await requiereDemo(request);
  await page.addInitScript(() => {
    Storage.prototype.setItem = () => {
      throw new Error('blocked');
    };
  });
  await page.goto(PAGA);
  await pagarHistoria(page);
  await expect(cerrado(page)).toBeVisible();
});

test('free story has no wall', async ({ page }) => {
  await page.goto(GRATIS);
  await expect(page.locator('article[data-historia]')).toHaveAttribute('data-gate-estado', 'gratis');
  await expect(muro(page)).toHaveCount(0);
  await expect(page.locator('[data-gate-pastilla]')).toHaveText('Gratis');
});

test('the Travel widget renders what the Cacao Travel API returns', async ({ page }) => {
  await page.route(`${TRAVEL}/api/tours.json`, (r) => r.fulfill({ json: { tours: [TOUR] } }));
  await page.route(`${TRAVEL}/fotos/**`, (r) => r.fulfill({ status: 204 }));
  await page.goto(PAGA);
  const widget = page.locator('[data-widget-travel]');
  await expect(widget).toBeVisible();
  await expect(widget.locator('[data-widget-precio]')).toHaveText('45,000 sats');
  await expect(widget.locator('.wt-boleto')).toHaveAttribute('href', TOUR.url);
});

test('the Travel widget stays hidden when the story has no experience or the API fails', async ({ page }) => {
  await page.route(`${TRAVEL}/api/tours.json`, (r) => r.fulfill({ json: { tours: [TOUR] } }));
  await page.goto(GRATIS);
  await expect(page.locator('[data-widget-travel]')).toBeHidden();

  await page.route(`${TRAVEL}/api/tours.json`, (r) => r.abort());
  await page.goto(PAGA);
  await expect(page.locator('[data-widget-travel]')).toBeHidden();
});

test('a place story with no linked experience still gets one from the same place', async ({ page }) => {
  const enElPuerto = { ...TOUR, lugar: 'Puerto de La Libertad', historias: [] };
  await page.route(`${TRAVEL}/api/tours.json`, (r) => r.fulfill({ json: { tours: [enElPuerto] } }));
  await page.route(`${TRAVEL}/fotos/**`, (r) => r.fulfill({ status: 204 }));
  await page.goto('/historias/punta-roca-la-derecha/');
  await expect(page.locator('[data-widget-travel]')).toBeVisible();

  // A coffee how-to in the same city does not qualify: it is not a place story.
  const enLaCapital = { ...TOUR, lugar: 'San Salvador', historias: [] };
  await page.route(`${TRAVEL}/api/tours.json`, (r) => r.fulfill({ json: { tours: [enLaCapital] } }));
  await page.goto(GRATIS);
  await expect(page.locator('[data-widget-travel]')).toBeHidden();
});

test('the widget ignores entries that point outside Cacao Travel', async ({ page }) => {
  const falso = { ...TOUR, url: 'https://example.com/phish/' };
  await page.route(`${TRAVEL}/api/tours.json`, (r) => r.fulfill({ json: { tours: [falso] } }));
  await page.goto(PAGA);
  await expect(page.locator('[data-widget-travel]')).toBeHidden();
});

for (const ruta of ['/', '/cronicas/', '/archivo/', '/acerca/', PAGA]) {
  test(`no horizontal scroll at 375px on ${ruta}`, async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto(ruta);
    const desborde = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(desborde).toBeLessThanOrEqual(0);
  });
}

test('the gate with an open invoice has no horizontal scroll at 320px', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto(PAGA);
  await pedirFactura(page);
  const desborde = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(desborde).toBeLessThanOrEqual(0);
});
