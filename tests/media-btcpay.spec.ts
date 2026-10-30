import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { expect, test, type APIRequestContext, type Browser, type Page } from '@playwright/test';

// Cacao Media with real Lightning invoices from BTCPay Server (regtest). Run with the local stack:
//   - Supabase running, and the dev server on 4321 started with PUBLIC_DEMO=0 (demo buttons off).
//   - BTCPay regtest at BTCPAY_BILLETERA (default http://127.0.0.1:8088), with its test wallet.
//   - The database closed to browsers: the test reads it with the service role from .env.local.
//   node --env-file=.env.local node_modules/@playwright/test/cli.js test --project=media tests/media-btcpay.spec.ts
// The "BTCPay down" test needs a second dev server on port 4331 started with BTCPAY_URL pointing to a dead port
// (for example http://127.0.0.1:9). Without it, that test is skipped.

const BILLETERA = process.env.BTCPAY_BILLETERA ?? 'http://127.0.0.1:8088';
const SERVIDOR_CAIDO = 'http://localhost:4331';
const SLUG = 'la-ola-que-cambio-un-pueblo';
const OTRO_SLUG = 'lo-que-nadie-te-cuenta-del-tunco';
const PAGA = `/historias/${SLUG}/`;
const OTRA_PAGA = `/historias/${OTRO_SLUG}/`;
const CLAVE = `cacao-gate:${SLUG}`;
const PAUSA = 'Los pagos están en pausa por unos minutos. Probá de nuevo en un rato.';
const ADMIN = process.env.CLERK_QA_ADMIN ?? 'remitente+clerk_test@example.com';
const NO_ADMIN = process.env.CLERK_QA_NO_ADMIN ?? 'destinatario-qa+clerk_test@example.com';
const CODIGO_CLERK = '424242';

const muro = (page: Page) => page.locator('[data-gate-muro]');
const cerrado = (page: Page) => page.locator('[data-gate-cerrado]');
const articulo = (page: Page) => page.locator('article[data-historia]');

/** Service-role client for the assertions and for steps a reader cannot take. */
function servicio(): SupabaseClient {
  const url = process.env.SUPABASE_URL;
  const clave = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !clave) throw new Error('Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY: correr con --env-file=.env.local.');
  return createClient(url, clave, { auth: { persistSession: false, autoRefreshToken: false } });
}

interface Factura {
  id: string;
  factura: string;
  precioSats: number;
  precioUsdCentavos: number | null;
  billeteraDePrueba: string | null;
}

/** Asks for an invoice from the gate and returns the server's answer. */
async function pedirFactura(page: Page): Promise<Factura> {
  const respuesta = page.waitForResponse((r) => r.url().endsWith('/api/cobro/') && r.request().method() === 'POST');
  await page.locator('[data-gate-pedir]').click();
  const r = await respuesta;
  expect(r.status()).toBe(200);
  await expect(muro(page)).toHaveAttribute('data-paso', 'pendiente');
  return (await r.json()) as Factura;
}

/** Pays a Lightning invoice from the regtest test wallet, as a reader's wallet would. */
async function pagarConBilletera(request: APIRequestContext, factura: string): Promise<void> {
  const r = await request.post(`${BILLETERA}/billetera/api/pagar`, { data: { factura } });
  expect(r.status()).toBe(200);
  expect(await r.json()).toMatchObject({ pagada: true });
}

/** The invoice row in the database, found by its BOLT11 text. */
async function cobroDe(factura: string) {
  const { data, error } = await servicio()
    .from('media_cobros')
    .select('id, lector_id, slug, estado, proveedor, btcpay_factura_id, btcpay_tienda_id')
    .eq('factura', factura)
    .maybeSingle();
  expect(error).toBeNull();
  return data;
}

/** The access row that a paid invoice created. */
async function accesoDe(cobroId: string) {
  const { data, error } = await servicio().from('media_accesos').select('lector_id, slug, cobro_id').eq('cobro_id', cobroId).maybeSingle();
  expect(error).toBeNull();
  return data;
}

/** Full real payment through the gate: invoice, wallet payment, story opens by itself. */
async function desbloquearConBilletera(page: Page, request: APIRequestContext): Promise<Factura> {
  const datos = await pedirFactura(page);
  await pagarConBilletera(request, datos.factura);
  await expect(articulo(page)).toHaveAttribute('data-gate-estado', 'desbloqueado', { timeout: 20_000 });
  await expect(cerrado(page)).toBeVisible();
  return datos;
}

test.describe('paid story with BTCPay invoices', () => {
  test('the wall shows the price in sats and in USD, with no simulated payment', async ({ page }) => {
    await page.goto(PAGA);
    await expect(articulo(page)).toHaveAttribute('data-gate-estado', 'bloqueado');
    await expect(muro(page)).toHaveAttribute('data-paso', 'inicio');
    await expect(page.locator('[data-gate-pedir]')).toHaveText('Desbloquear por 120 sats');
    await expect(page.locator('[data-gate-precio]')).toContainText('120 sats');
    await expect(page.locator('[data-gate-usd]')).toHaveText(/^· \$\d+\.\d{2}$/);
    await expect(page.locator('[data-gate-simular]')).toHaveCount(0);
    await expect(page.getByText('Pago simulado')).toHaveCount(0);
    await expect(muro(page)).not.toContainText('Modo demo');
  });

  test('a real Lightning invoice is paid in the test wallet and the story unlocks by itself', async ({ page, request }) => {
    await page.goto(PAGA);
    const datos = await pedirFactura(page);

    // A real BOLT11 invoice from BTCPay on regtest, not a simulated one.
    expect(datos.factura).toMatch(/^lnbcrt[0-9a-z]+$/);
    await expect(page.locator('[data-gate-factura]')).toHaveText(datos.factura);
    await expect(page.getByText('Factura Lightning', { exact: true })).toBeVisible();
    await expect(page.getByText(/simulada/)).toHaveCount(0);
    await expect(page.locator('[data-gate-qr]')).toHaveAttribute('src', /^data:image\/png/);
    await expect(page.locator('[data-gate-monto]')).toHaveText(/^120 sats · \$\d+\.\d{2}$/);
    await expect(page.locator('[data-gate-cuenta]')).toHaveText(/^\d:[0-5]\d$/);

    // The link to the test wallet carries the same invoice.
    expect(datos.billeteraDePrueba).toBe(`${BILLETERA}/billetera?factura=${encodeURIComponent(datos.factura)}`);
    await expect(page.locator('[data-gate-prueba]')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Pagar con la billetera de prueba' })).toHaveAttribute('href', datos.billeteraDePrueba!);

    const pendiente = await cobroDe(datos.factura);
    expect(pendiente).toMatchObject({ estado: 'pendiente', proveedor: 'btcpay', slug: SLUG });
    expect(pendiente?.btcpay_factura_id).toBeTruthy();

    await pagarConBilletera(request, datos.factura);
    await expect(articulo(page)).toHaveAttribute('data-gate-estado', 'desbloqueado', { timeout: 20_000 });
    await expect(cerrado(page)).toBeVisible();
    await expect(cerrado(page)).not.toBeEmpty();

    const pagada = await cobroDe(datos.factura);
    expect(pagada).toMatchObject({ estado: 'pagada', proveedor: 'btcpay' });
    const acceso = await accesoDe(pagada!.id);
    expect(acceso).toMatchObject({ slug: SLUG, lector_id: pagada!.lector_id });
  });

  test('reloading keeps the access without asking for another invoice', async ({ page, request }) => {
    await page.goto(PAGA);
    await desbloquearConBilletera(page, request);

    const pedidos: string[] = [];
    page.on('request', (r) => {
      if (r.method() === 'POST' && r.url().includes('/api/cobro/')) pedidos.push(r.url());
    });
    await page.reload();
    await expect(cerrado(page)).toBeVisible();
    expect(pedidos).toEqual([]);
  });

  test('a second story unlocks in the same browser, and a new browser does not have access', async ({ page, request, browser }) => {
    await page.goto(PAGA);
    await desbloquearConBilletera(page, request);

    await page.goto(OTRA_PAGA);
    const segunda = await desbloquearConBilletera(page, request);
    expect((await cobroDe(segunda.factura))?.slug).toBe(OTRO_SLUG);

    const otra = await browser.newContext({ baseURL: 'http://localhost:4321' });
    try {
      const pagina = await otra.newPage();
      await pagina.goto(PAGA);
      await expect(muro(pagina)).toBeVisible();
      await expect(cerrado(pagina)).toBeHidden();
      expect((await otra.request.post('/api/desbloquear/', { data: { slug: SLUG } })).status()).toBe(402);
    } finally {
      await otra.close();
    }
  });

  test('an expired invoice reads vencida and a new invoice can be asked for', async ({ page }) => {
    await page.goto(PAGA);
    const primera = await pedirFactura(page);
    const { error } = await servicio()
      .from('media_cobros')
      .update({ expira_en: new Date(Date.now() - 1000).toISOString() })
      .eq('factura', primera.factura);
    expect(error).toBeNull();

    await expect(muro(page)).toHaveAttribute('data-paso', 'vencida', { timeout: 15_000 });
    await expect(page.locator('[data-gate-estado-texto]')).toHaveText('La factura venció. No la pagués.');
    await expect(cerrado(page)).toBeHidden();
    expect((await cobroDe(primera.factura))?.estado).toBe('vencida');

    await page.locator('[data-gate-pedir]').click();
    await expect(muro(page)).toHaveAttribute('data-paso', 'pendiente');
    await expect(page.locator('[data-gate-factura]')).toHaveText(/^lnbcrt/);
    await expect(page.locator('[data-gate-factura]')).not.toHaveText(primera.factura);
  });

  test('the payment wall holds at 375px with an open invoice', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto(PAGA);
    await pedirFactura(page);
    await expect(page.locator('[data-gate-qr]')).toBeVisible();
    const desborde = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(desborde).toBeLessThanOrEqual(0);
  });

  test('a travel pass in the fragment unlocks the story without paying', async ({ page, browser, request }) => {
    await page.goto(PAGA);
    await desbloquearConBilletera(page, request);
    const pase = (await page.evaluate((k) => JSON.parse(localStorage.getItem(k)!), CLAVE)) as { token: string };

    const otra = await browser.newContext({ baseURL: 'http://localhost:4321' });
    try {
      const pagina = await otra.newPage();
      await pagina.goto(`${PAGA}#pase=${pase.token}`);
      await expect(cerrado(pagina)).toBeVisible();
      await expect(articulo(pagina)).toHaveAttribute('data-gate-estado', 'desbloqueado');
      expect(pagina.url()).not.toContain('pase');
    } finally {
      await otra.close();
    }
  });
});

test.describe('BTCPay down', () => {
  test('the wall says payments are paused and stays closed', async ({ page, request }) => {
    const viva = await request.get(`${SERVIDOR_CAIDO}${PAGA}`).then((r) => r.ok).catch(() => false);
    test.skip(!viva, 'Falta el servidor de prueba en 4331 con BTCPAY_URL apuntando a un puerto muerto.');

    await page.goto(`${SERVIDOR_CAIDO}${PAGA}`);
    await page.locator('[data-gate-pedir]').click();
    await expect(page.locator('[data-gate-error]')).toHaveText(PAUSA);
    await expect(cerrado(page)).toBeHidden();
    await expect(muro(page)).toBeVisible();
  });
});

test.describe('admin panel', () => {
  test.setTimeout(120_000);

  // Signs in through the Clerk form. The QA account must be an admin row in the local database (es_admin = true).
  async function entrarConClerk(page: Page, correo: string): Promise<void> {
    await page.goto('/admin/entrar/');
    await page.locator('input[name=identifier]').fill(correo);
    await page.getByRole('button', { name: 'Continuar', exact: true }).click();
    const codigo = page.locator('input[autocomplete=one-time-code]');
    await codigo.waitFor({ timeout: 20_000 });
    // Clerk needs a moment after showing the field before it accepts the code.
    await page.waitForTimeout(2000);
    await codigo.fill(CODIGO_CLERK);
    const continuar = page.getByRole('button', { name: 'Continuar', exact: true });
    if (page.url().includes('/entrar') && (await continuar.isVisible())) await continuar.click();
    // Clerk leaves the sign-in page once the session exists (to /admin, which the panel then answers).
    await page.waitForURL((url) => !url.pathname.includes('/entrar'), { timeout: 45_000 });
  }

  test('the sign-in page has one visible title, centered', async ({ page }) => {
    await page.goto('/admin/entrar/');
    const titulo = page.getByRole('heading', { name: 'Entrar', exact: true });
    await expect(titulo).toBeVisible();
    await expect(titulo).toHaveCount(1);
    const caja = await titulo.boundingBox();
    const viewport = page.viewportSize()!;
    expect(caja).not.toBeNull();
    expect(Math.abs(caja!.x + caja!.width / 2 - viewport.width / 2)).toBeLessThan(viewport.width * 0.05);
  });

  test('a signed-in visitor who is not an admin gets 404 at the panel', async ({ page }) => {
    await entrarConClerk(page, NO_ADMIN);
    await page.goto('/admin/');
    await expect(page.getByText('Página no encontrada.')).toBeVisible();
    expect((await page.goto('/admin/transacciones/'))?.status()).toBe(404);
  });

  test('an admin sees the panel, and the transactions list includes the paid invoice', async ({ page, browser, request }) => {
    // A paid invoice for the list, made by a reader in her own browser.
    const lectora = await browser.newContext({ baseURL: 'http://localhost:4321' });
    try {
      const lector = await lectora.newPage();
      await lector.goto(PAGA);
      await desbloquearConBilletera(lector, lectora.request);
    } finally {
      await lectora.close();
    }

    await entrarConClerk(page, ADMIN);
    await page.goto('/admin/');
    await expect(page.getByRole('heading', { name: 'Resumen del período' })).toBeVisible();

    await page.goto('/admin/transacciones/?estado=pagada');
    await expect(page.getByRole('heading', { name: 'Transacciones' })).toBeVisible();
    const fila = page.locator('tbody tr', { hasText: 'La ola que cambió un pueblo' }).first();
    await expect(fila).toBeVisible();
    await expect(fila.locator('.chip')).toHaveText('Pagada');
  });
});
