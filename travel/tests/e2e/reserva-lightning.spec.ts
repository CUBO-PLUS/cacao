import { expect, request as pwRequest, test, type APIRequestContext, type Page } from '@playwright/test';

// Booking with a real Lightning invoice on the local regtest BTCPay. Each test that pays uses its own
// invoice: the wallet pays it, and the page or the status endpoint says so.

const BTCPAY = 'http://127.0.0.1:8088';
const MEDIA = 'http://localhost:4321';
const DIA = 24 * 60 * 60 * 1000;
// Weekday codes in Date.getUTCDay() order: the codes the catalogue uses.
const DIAS = ['dom', 'lun', 'mar', 'mie', 'jue', 'vie', 'sab'];
// The tour is priced in sats per person and every test books it for two people unless it says otherwise.
const TOUR = 'clase-de-surf-en-el-tunco';
const PRECIO_TOUR = 45_000;

interface Tour {
  id: string;
  precio: number;
  salidas: string[];
  grupo: { min: number; max: number };
  historias: string[];
}

/** A date at least two days ahead that falls on the weekday code. YYYY-MM-DD, read with UTC getters. */
function proximaFecha(dia: string, desde = Date.now() + 2 * DIA): string {
  const base = new Date(desde);
  let t = Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate());
  while (DIAS[new Date(t).getUTCDay()] !== dia) t += DIA;
  return new Date(t).toISOString().slice(0, 10);
}

/** The Salvadoran "today" as the server counts it (UTC-6, no daylight saving). */
function hoyEnElSalvador(desde = Date.now()): string {
  return new Date(desde - 6 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** Digits of a sats text such as "45,000 sats". */
const sats = (n: number): string => `${n.toLocaleString('en-US')} sats`;

async function catalogo(request: APIRequestContext): Promise<Tour[]> {
  const r = await request.get('/api/tours.json');
  expect(r.ok()).toBeTruthy();
  return ((await r.json()) as { tours: Tour[] }).tours;
}

async function tourPorId(request: APIRequestContext, id: string): Promise<Tour> {
  const tour = (await catalogo(request)).find((t) => t.id === id);
  if (!tour) throw new Error(`the catalogue has no experience ${id}`);
  return tour;
}

/** Pays a Lightning invoice in the regtest test wallet, the way the "Pagar con la billetera de prueba" link does. */
async function pagarEnBilletera(factura: string): Promise<void> {
  const ctx = await pwRequest.newContext();
  try {
    const r = await ctx.post(`${BTCPAY}/billetera/api/pagar`, { data: { factura } });
    expect(r.ok(), 'the test wallet refused the invoice').toBeTruthy();
    expect(((await r.json()) as { pagada?: boolean }).pagada).toBe(true);
  } finally {
    await ctx.dispose();
  }
}

/**
 * A Cacao Media reader token for a paid story, the way a reader gets one: Media issues a Lightning invoice
 * for the reader's cookie, the test wallet pays it, and the invoice then carries the token.
 */
async function tokenDeLector(slugs: string[]): Promise<{ slug: string; token: string }> {
  // Media keeps the reader in a cookie: one context carries it through the calls.
  const media = await pwRequest.newContext({ baseURL: MEDIA });
  try {
    for (const slug of slugs) {
      await media.get(`/historias/${slug}/`);
      const creado = await media.post('/api/cobro/', { data: { slug } });
      if (!creado.ok()) continue;
      const cobro = (await creado.json()) as { id: string; estado: string; token?: string; factura?: string };
      if (cobro.token) return { slug, token: cobro.token };
      if (!cobro.factura) continue;
      await pagarEnBilletera(cobro.factura);
      const estado = await media.get(`/api/cobro/${cobro.id}/`);
      const pagado = (await estado.json()) as { token?: string };
      if (pagado.token) return { slug, token: pagado.token };
    }
  } finally {
    await media.dispose();
  }
  throw new Error('no paid Media story could be bought to get a reader token');
}

/** Opens the booking box of an experience, optionally with a date, a group size and a reader token. */
async function abrirReserva(page: Page, tour: string, extra: { fecha?: string; personas?: number; lector?: string } = {}): Promise<void> {
  const params = new URLSearchParams();
  if (extra.fecha) params.set('fecha', extra.fecha);
  if (extra.personas) params.set('personas', String(extra.personas));
  const query = params.toString() ? `?${params}` : '';
  const hash = extra.lector ? `#lector=${extra.lector}` : '';
  await page.goto(`/experiencias/${tour}/${query}${hash}`);
  await expect(page.locator('[data-reserva]')).toBeVisible();
}

/** The date input of the booking box, filled and checked by the page's own change handler. */
async function ponerFecha(page: Page, fecha: string): Promise<void> {
  await page.locator('[data-reserva] [data-fecha]').fill(fecha);
}

test.describe('experiencias y fechas', () => {
  test('la home lista las experiencias y la ficha muestra precio en sats y reglas de salida', async ({ page, request }) => {
    const tours = await catalogo(request);
    await page.goto('/');
    await expect(page.locator('[data-boleto]').first()).toBeVisible();
    expect(await page.locator('[data-boleto]').count()).toBe(tours.length);

    await abrirReserva(page, TOUR);
    await expect(page.locator('[data-precio-unidad]')).toHaveText(sats(PRECIO_TOUR));
    await expect(page.locator('[data-reserva] [data-total]')).toHaveText(sats(PRECIO_TOUR * 2));
    // The schedule line lists the days the tour runs, in Spanish: this tour runs every day.
    await expect(page.locator('[data-reserva] label.reserva__campo span').first()).toHaveText(
      'Fecha · sale lunes, martes, miércoles, jueves, viernes, sábado, domingo',
    );
  });

  test('el selector de fecha rechaza pasadas y días sin salida, con mensajes claros', async ({ page, request }) => {
    // Centro historico runs Tuesday to Saturday, so a Monday is refused.
    const centro = 'centro-historico-caminado-con-guia';
    const tour = await tourPorId(request, centro);
    expect(tour.salidas).not.toContain('lun');

    await abrirReserva(page, centro);
    const error = page.locator('[data-reserva] [data-error]');

    // Yesterday in El Salvador: refused with the "from tomorrow" rule.
    const ayer = new Date(Date.parse(`${hoyEnElSalvador()}T12:00:00Z`) - DIA).toISOString().slice(0, 10);
    await ponerFecha(page, ayer);
    await expect(error).toHaveText('La fecha tiene que ser a partir de mañana.');
    // The picker's earliest day is tomorrow in El Salvador, the same day the server counts from.
    await expect(page.locator('[data-reserva] [data-fecha]')).toHaveAttribute('min', hoyEnElSalvador(Date.now() + DIA));

    // A Monday that is at least two days away: the weekday rule applies.
    const lunes = proximaFecha('lun');
    await ponerFecha(page, lunes);
    await expect(error).toHaveText('Esta experiencia no sale ese día. Fijate en los días de salida.');

    // A day it runs clears the message.
    await ponerFecha(page, proximaFecha('mar'));
    await expect(error).toBeHidden();

    // The server refuses the same bookings with a JSON error, never a code.
    const api = await request.post('/api/reservar/', {
      data: { tour: centro, fecha: lunes, personas: 2 },
    });
    expect(api.status()).toBe(400);
    expect(((await api.json()) as { error: string }).error).toContain('no sale los lunes');
    const pasada = await request.post('/api/reservar/', {
      data: { tour: centro, fecha: ayer, personas: 2 },
    });
    expect(pasada.status()).toBe(400);
  });

  test('el grupo se queda entre el mínimo y el máximo del tour', async ({ page, request }) => {
    const { min, max } = (await tourPorId(request, TOUR)).grupo;
    await abrirReserva(page, TOUR);

    const personas = page.locator('[data-reserva] [data-personas]');
    const mas = page.locator('[data-reserva] [data-mas]');
    const menos = page.locator('[data-reserva] [data-menos]');
    for (let i = 0; i < 30; i++) await mas.click({ force: true });
    await expect(personas).toHaveText(String(max));
    await expect(mas).toBeDisabled();
    for (let i = 0; i < 30; i++) await menos.click({ force: true });
    await expect(personas).toHaveText(String(min));
    await expect(menos).toBeDisabled();

    // The API refuses a group past the limit.
    const r = await request.post('/api/reservar/', { data: { tour: TOUR, fecha: proximaFecha('mar'), personas: max + 1 } });
    expect(r.status()).toBe(400);
  });
});

test.describe('reserva con Lightning', () => {
  test('reserva pendiente con factura, se paga en la billetera y queda Pagada, en /reservas y tras recargar', async ({ page, request }) => {
    test.setTimeout(120_000);
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    const fecha = proximaFecha('mar');
    await abrirReserva(page, TOUR, { fecha, personas: 2 });

    // The answer to POST /api/reservar/ is pendiente with a real BOLT11 invoice.
    const respuesta = page.waitForResponse((r) => r.url().endsWith('/api/reservar/') && r.request().method() === 'POST');
    await page.locator('[data-reservar]').click();
    const json = (await (await respuesta).json()) as { estado: string; factura: { bolt11: string; sats: number; id: string } };
    expect(json.estado).toBe('pendiente');
    expect(json.factura.bolt11).toMatch(/^lnbcrt[0-9a-z]+$/);
    expect(json.factura.sats).toBe(PRECIO_TOUR * 2);

    // The payment panel: amount, invoice text, copy button, countdown, test-wallet link, regtest note.
    const pago = page.locator('[data-pago]');
    await expect(pago).toBeVisible();
    await expect(pago.locator('[data-pago-monto]')).toHaveText(sats(PRECIO_TOUR * 2));
    await expect(pago.locator('[data-pago-factura]')).toHaveValue(json.factura.bolt11);
    await expect(pago.getByText('Bitcoin de prueba (regtest): no tiene valor.')).toBeVisible();
    await expect(pago.locator('[data-pago-cuenta]')).toContainText('Vence en');
    await expect(pago.locator('[data-pago-prueba]')).toHaveAttribute('href', new RegExp(`${BTCPAY.replace(/\./g, '\\.')}/billetera\\?factura=`));
    await pago.locator('[data-pago-copiar]').click();
    await expect(pago.locator('[data-pago-copiar]')).toHaveText('Factura copiada');

    // The wallet pays. Within about six seconds the booking turns Pagada.
    await pagarEnBilletera(json.factura.bolt11);
    const confirmada = page.locator('[data-confirmada]');
    await expect(confirmada).toBeVisible({ timeout: 8_000 });
    await expect(confirmada.locator('[data-sello]')).toHaveText('Pagada');
    const codigo = (await confirmada.locator('[data-codigo]').textContent())?.trim() ?? '';
    expect(codigo).toMatch(/^[0-9A-F]{8}$/);
    await expect(confirmada.locator('[data-lecturas-lista] a').first()).toHaveAttribute('href', /#pase=/);

    // The status endpoint says the same thing: the invoice is settled and the booking carries its code.
    const estado = await request.get(`/api/reservar/estado/?id=${json.factura.id}`);
    const reserva = (await estado.json()) as { pagada: boolean; codigo: string; total: number };
    expect(reserva.pagada).toBe(true);
    expect(reserva.codigo).toBe(codigo);
    expect(reserva.total).toBe(PRECIO_TOUR * 2);

    // /reservas lists it as Pagada, and a reload keeps it.
    await page.goto('/reservas/');
    const ticket = page.locator('[data-reservas] .ticket', { hasText: codigo });
    await expect(ticket).toBeVisible();
    await expect(ticket.getByText('Pagada')).toBeVisible();
    await page.reload();
    await expect(page.locator('[data-reservas] .ticket', { hasText: codigo }).getByText('Pagada')).toBeVisible();
  });

  test('con el token de un lector el total baja 10% y la factura tiene ese monto', async ({ page, request }) => {
    test.setTimeout(150_000);
    const tour = await tourPorId(request, TOUR);
    const { token } = await tokenDeLector(tour.historias);
    const fecha = proximaFecha('mar');
    const conDescuento = Math.round(PRECIO_TOUR * 2 * 0.1);
    const esperado = PRECIO_TOUR * 2 - conDescuento;

    await abrirReserva(page, TOUR, { fecha, personas: 2, lector: token });
    await expect(page.locator('[data-reserva] [data-fila-descuento]')).toBeVisible({ timeout: 8_000 });
    await expect(page.locator('[data-reserva] [data-total]')).toHaveText(sats(esperado));

    const respuesta = page.waitForResponse((r) => r.url().endsWith('/api/reservar/') && r.request().method() === 'POST');
    await page.locator('[data-reservar]').click();
    const json = (await (await respuesta).json()) as { estado: string; factura: { bolt11: string; sats: number } };
    expect(json.factura.sats).toBe(esperado);
    await expect(page.locator('[data-pago] [data-pago-monto]')).toHaveText(sats(esperado));

    await pagarEnBilletera(json.factura.bolt11);
    const confirmada = page.locator('[data-confirmada]');
    await expect(confirmada).toBeVisible({ timeout: 8_000 });
    await expect(confirmada.locator('[data-sello]')).toHaveText('Pagada');
    await expect(confirmada.locator('[data-resumen]')).toContainText(sats(esperado));
  });

  test('una factura vencida muestra el aviso y Volver a intentar deja reservar otra vez', async ({ page }) => {
    const fecha = proximaFecha('mar');
    await abrirReserva(page, TOUR, { fecha, personas: 2 });

    // The status endpoint answers vencida for an expired invoice. The page shows it and offers the retry.
    await page.route('**/api/reservar/estado/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{"estado":"vencida"}' }));
    const creada = page.waitForResponse((r) => r.url().endsWith('/api/reservar/') && r.request().method() === 'POST');
    await page.locator('[data-reservar]').click();
    expect((await creada).status()).toBe(200);

    const pago = page.locator('[data-pago]');
    await expect(pago.locator('[data-pago-vencida]')).toBeVisible({ timeout: 8_000 });
    await expect(pago.locator('[data-pago-vencida]')).toHaveText('La factura venció. Volvé a intentar.');
    const reintentar = pago.locator('[data-pago-reintentar]');
    await expect(reintentar).toBeVisible();

    // Retry: back to the form with the message, and Reservar works again.
    await page.unroute('**/api/reservar/estado/**');
    await reintentar.click();
    await expect(page.locator('[data-reserva] form[data-form]')).toBeVisible();
    await expect(page.locator('[data-reserva] [data-error]')).toHaveText('La factura venció. Volvé a intentar.');
    await expect(page.locator('[data-reservar]')).toBeEnabled();
    const nueva = page.waitForResponse((r) => r.url().endsWith('/api/reservar/') && r.request().method() === 'POST');
    await page.locator('[data-reservar]').click();
    const json = (await (await nueva).json()) as { estado: string; factura?: { bolt11: string } };
    expect(json.estado).toBe('pendiente');
    await expect(page.locator('[data-pago] [data-pago-factura]')).toHaveValue(json.factura!.bolt11);
  });
});

test.describe('BTCPay caído', () => {
  // Needs a second dev server with BTCPAY_URL pointing at a dead port and SUPABASE_URL empty (port 4332).
  // Set TRAVEL_PAUSA_URL=http://localhost:4332 to run it; without it the test is skipped.
  const pausa = process.env.TRAVEL_PAUSA_URL;
  test.skip(!pausa, 'set TRAVEL_PAUSA_URL to the server with BTCPay down');

  test('la reserva muestra la pausa de pagos y no una traza', async ({ page }) => {
    await page.goto(`${pausa}/experiencias/${TOUR}/?fecha=${proximaFecha('mar')}&personas=2`);
    await expect(page.locator('[data-reserva]')).toBeVisible();
    await page.locator('[data-reservar]').click();
    const error = page.locator('[data-reserva] [data-error]');
    await expect(error).toHaveText('Los pagos están en pausa por unos minutos. Probá de nuevo en un rato.');
    await expect(page.locator('[data-pago]')).toBeHidden();
    await expect(page.locator('[data-reservar]')).toBeEnabled();
    await expect(page.locator('body')).not.toContainText('Error:');
  });
});

test.describe('375 px', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test('la ficha y el panel de pago entran en 375 px sin desbordar', async ({ page }) => {
    test.setTimeout(120_000);
    await abrirReserva(page, TOUR, { fecha: proximaFecha('mar'), personas: 2 });
    const sinDesborde = () =>
      page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
    expect(await sinDesborde()).toBe(true);
    await page.locator('[data-reservar]').click();
    await expect(page.locator('[data-pago]')).toBeVisible();
    expect(await sinDesborde()).toBe(true);
    const ancho = await page.locator('[data-pago]').evaluate((el) => el.getBoundingClientRect().width);
    expect(ancho).toBeLessThanOrEqual(375 - 2 * 16 + 1);
  });
});
