import { mkdirSync } from 'node:fs';
import path from 'node:path';

import { expect, test, type Page } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { contextoDe } from './clerk-qa';

// CacaoPay para negocios, in the browser, with a test account: activate the business (once), charge $3.50 on the counter,
// pay the invoice from the test wallet, see Pagado on the counter, and see the sale on the panel. It also saves the
// screens at three widths to pay/.qa for review. Runs against the dev server on port 4324 with the demo BTCPay.

// The sign-in helper runs headed, as the other specs do.
test.use({ headless: false, trace: 'off' });

const CARPETA = path.join(process.cwd(), '.qa', 'negocios');
const ANCHOS = [375, 820, 1280] as const;
const BILLETERA = 'http://127.0.0.1:8088/billetera/api/pagar';

async function captura(pagina: Page, nombre: string) {
  mkdirSync(CARPETA, { recursive: true });
  for (const ancho of ANCHOS) {
    await pagina.setViewportSize({ width: ancho, height: ancho === 375 ? 812 : 900 });
    await pagina.waitForTimeout(200);
    await pagina.screenshot({ path: path.join(CARPETA, `${nombre}-${ancho}.png`), fullPage: true });
  }
  await pagina.setViewportSize({ width: 375, height: 812 });
}

// Reads CacaoLedger's database (the same project). The sale appears once Pay's queue has delivered its notice.
function servicioLedger(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  const clave = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  if (!url || !clave) throw new Error('Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY para leer el libro.');
  return createClient(url, clave, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
}

async function esperarVentaEnLedger(desde: string): Promise<{ producto: string; ticket_id: string | null }> {
  const db = servicioLedger();
  const limite = Date.now() + 90_000;
  while (Date.now() < limite) {
    const { data } = await db.from('ledger_ventas_api').select('producto, ticket_id').eq('producto', 'negocios').gte('creado_en', desde).limit(1).maybeSingle();
    if (data) return data as { producto: string; ticket_id: string | null };
    await new Promise((resuelve) => setTimeout(resuelve, 3_000));
  }
  throw new Error('CacaoLedger no registró la venta a tiempo.');
}

// Group tickets that carry the invoice. A business sale must give none.
async function tiquetesDelGrupo(factura: string): Promise<number> {
  const { count } = await servicioLedger()
    .from('ledger_tickets')
    .select('id', { count: 'exact', head: true })
    .eq('origen_numero', factura);
  return count ?? 0;
}

test('un negocio cobra $3.50 en caja, el cliente paga y el panel muestra la venta', async ({ browser }) => {
  const inicio = new Date().toISOString();
  const contexto = await contextoDe(browser, 'remitente');
  const pagina = await contexto.newPage();

  // 1. Activate the business, only when the account has none yet.
  await pagina.goto('/negocios');
  // The page streams: wait for one of its two endings before asking which one came.
  const enlaceCaja = pagina.getByRole('link', { name: 'Cobrar en caja' });
  await expect(enlaceCaja.or(pagina.getByLabel('Nombre del negocio'))).toBeVisible({ timeout: 30_000 });
  const tieneNegocio = await enlaceCaja.isVisible();
  if (!tieneNegocio) {
    await captura(pagina, '1-activar');
    await pagina.getByLabel('Nombre del negocio').fill(`Café QA ${Date.now() % 100000}`);
    await pagina.getByLabel('Dónde está').fill('Colonia Escalón, San Salvador');
    const tipo = pagina.getByLabel('Tipo de negocio');
    if (await tipo.isVisible().catch(() => false)) await tipo.selectOption('cafeteria');
    await pagina.getByRole('button', { name: 'Cobrar con mi negocio' }).click();
    await expect(pagina.getByRole('link', { name: 'Cobrar en caja' })).toBeVisible({ timeout: 60_000 });
  }

  // 2. Charge $3.50 on the counter: the keypad types 3, 5, 0 (cents), then Cobrar. A double tap is one charge.
  await pagina.goto('/negocios/cobrar');
  for (const digito of ['3', '5', '0']) await pagina.getByRole('button', { name: digito, exact: true }).click();
  await expect(pagina.getByText('$3.50', { exact: true })).toBeVisible();
  const cobrar = pagina.getByRole('button', { name: 'Cobrar', exact: true });
  await cobrar.dblclick();
  await expect(pagina.getByText('Esperando el pago.', { exact: false })).toBeVisible({ timeout: 30_000 });
  await captura(pagina, '2-cobrar-esperando');

  // 3. The customer pays from the test wallet. The invoice is in the wallet link of the counter.
  const enlace = await pagina.getByRole('link', { name: 'Pagar con la billetera de prueba' }).getAttribute('href');
  expect(enlace).toBeTruthy();
  const factura = new URL(enlace ?? '', 'http://127.0.0.1').searchParams.get('factura');
  expect(factura).toMatch(/^lnbcrt/);
  const pago = await pagina.request.post(BILLETERA, { data: { factura }, headers: { 'content-type': 'application/json' } });
  expect(pago.ok()).toBeTruthy();

  // 4. The counter turns to Pagado within seconds, by itself.
  await expect(pagina.getByRole('status').filter({ hasText: /^Pagado$/ })).toBeVisible({ timeout: 40_000 });
  await captura(pagina, '3-pagado');

  // 3b. Pay reports the sale to CacaoLedger from its queue. It is stored as a business sale, with no ticket of the group.
  const ventaEnLedger = await esperarVentaEnLedger(inicio);
  expect(ventaEnLedger.producto).toBe('negocios');
  expect(ventaEnLedger.ticket_id).toBeNull();
  expect(await tiquetesDelGrupo(factura ?? '')).toBe(0);

  // 5. The panel shows the sale, and the QR page carries the public address of the business.
  await pagina.goto('/negocios/panel');
  await expect(pagina.getByRole('heading', { name: 'Ventas' })).toBeVisible();
  await expect(pagina.locator('dd').filter({ hasText: '$' }).first()).toBeVisible();
  await expect(pagina.getByRole('cell', { name: '$3.50' }).first()).toBeVisible();
  await captura(pagina, '4-panel');

  await pagina.goto('/negocios/qr');
  await captura(pagina, '5-qr');
  const direccion = await pagina.locator('p.dato').first().textContent();
  expect(direccion).toMatch(/\/pagar\/[0-9a-f-]{36}$/);

  // 6. The public page shows the business name and asks for the amount. Nothing else of the business.
  await pagina.goto(new URL(direccion ?? '').pathname);
  await expect(pagina.getByLabel('Monto en dólares')).toBeVisible();
  await captura(pagina, '6-pagar-publico');

  await contexto.close();
});
