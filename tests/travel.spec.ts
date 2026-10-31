import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

// Most tests run with the intro off. The intro tests at the bottom switch motion back on.
test.use({ contextOptions: { reducedMotion: 'reduce' } });

const DIA = 24 * 60 * 60 * 1000;
// Weekday codes in Date.getUTCDay() order, the same codes the catalogue uses.
const DIAS = ['dom', 'lun', 'mar', 'mie', 'jue', 'vie', 'sab'];

interface Tour {
  id: string;
  titulo: string;
  bajada: string;
  lugar: string;
  categoria: string;
  zona: string;
  posicion: [number, number] | null;
  salidas: string[];
  duracion: string;
  nivel: string;
  grupo: { min: number; max: number };
  precio: number;
  historias: string[];
}

interface Reparto {
  operador: number;
  plataforma: number;
  autor: number;
}

interface Catalogo {
  tours: Tour[];
  /** Split of an experience with at least one linked story. */
  reparto: Reparto;
  /** Split of an experience with no linked story: the author takes nothing. */
  repartoSinHistoria: Reparto;
}

async function catalogo(request: APIRequestContext): Promise<Catalogo> {
  const r = await request.get('/api/tours.json');
  expect(r.ok()).toBeTruthy();
  return (await r.json()) as Catalogo;
}

/** The next date, at least two days from now, that falls on the weekday code. YYYY-MM-DD, read with UTC getters. */
function proximaFecha(dia: string): string {
  const base = new Date(Date.now() + 2 * DIA);
  let t = Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate());
  while (DIAS[new Date(t).getUTCDay()] !== dia) t += DIA;
  return new Date(t).toISOString().slice(0, 10);
}

/** A weekday the tour does not run, or undefined when it runs every day. */
function diaSinSalida(t: Tour): string | undefined {
  return DIAS.find((d) => !t.salidas.includes(d));
}

/** A value of one field that some experiences have and others do not. */
function valorParcial(tours: Tour[], campo: 'categoria' | 'nivel' | 'zona'): string {
  const valores = [...new Set(tours.map((t) => t[campo]))];
  const valor = valores.find((v) => tours.filter((t) => t[campo] === v).length < tours.length);
  if (!valor) throw new Error(`every experience has the same ${campo}`);
  return valor;
}

/** Digits of a money text such as "45,000 sats". */
const pesos = (texto: string | null): number => Number((texto ?? '').replace(/\D/g, ''));

const plano = (s: string): string => s.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '');

/** Same rule as the home search: every word of the query must appear in the card's text. */
function coincide(t: Tour, consulta: string): boolean {
  const texto = plano(`${t.titulo} ${t.lugar} ${t.categoria} ${t.bajada}`);
  return plano(consulta).split(/\s+/).filter(Boolean).every((p) => texto.includes(p));
}

const porTitulo = (tours: Tour[]): string[] => tours.map((t) => t.titulo).sort();

/** Opens Filtros: the zone, date, people and level fields sit behind it on the home page. */
async function abrirFiltros(page: Page): Promise<void> {
  const boton = page.locator('[data-filtros-boton]');
  if ((await boton.getAttribute('aria-expanded')) !== 'true') await boton.click();
}

/** Titles of the cards that are shown, sorted. */
async function titulosVisibles(page: Page): Promise<string[]> {
  return (await page.locator('[data-boleto]:visible h3 a').allTextContents()).map((s) => s.trim()).sort();
}

/** The home page shows exactly these experiences, in the count and in the cards. */
async function expectVisibles(page: Page, esperadas: Tour[]): Promise<void> {
  await expect(page.locator('[data-cuenta]')).toHaveText(String(esperadas.length));
  expect(await titulosVisibles(page)).toEqual(porTitulo(esperadas));
}

// The regtest test wallet of the BTCPay demo. It pays a real Lightning invoice made by BTCPay.
const BTCPAY = process.env.BTCPAY_PUERTA ?? 'http://127.0.0.1:8088';

test('home shows one card per experience in the API and the count matches', async ({ page, request }) => {
  const { tours } = await catalogo(request);
  await page.goto('/');
  await expect(page.locator('[data-boleto]')).toHaveCount(tours.length);
  await expectVisibles(page, tours);
});

test('text search narrows the cards, and nonsense shows the empty state that the reset button clears', async ({ page, request }) => {
  const { tours } = await catalogo(request);
  const elegida = tours[0];
  await page.goto('/');
  const buscar = page.locator('[data-buscador] input[name="q"]');

  await buscar.fill(elegida.lugar);
  await expect(page.getByRole('link', { name: elegida.titulo, exact: true })).toBeVisible();
  await expectVisibles(page, tours.filter((t) => coincide(t, elegida.lugar)));

  await buscar.fill('zzqxw');
  await expect(page.locator('[data-vacio]')).toBeVisible();
  await expect(page.locator('[data-cuenta]')).toHaveText('0');

  await page.locator('[data-vacio] [data-limpiar]').click();
  await expect(page.locator('[data-vacio]')).toBeHidden();
  await expect(buscar).toHaveValue('');
  await expectVisibles(page, tours);
});

test('choosing a date shows only the experiences that run on that weekday', async ({ page, request }) => {
  const { tours } = await catalogo(request);
  // A weekday that some experiences run and others do not, so the filter has something to hide.
  const dia = DIAS.find((d) => {
    const n = tours.filter((t) => t.salidas.includes(d)).length;
    return n > 0 && n < tours.length;
  });
  if (!dia) throw new Error('no weekday splits the catalogue');
  await page.goto('/');
  await abrirFiltros(page);
  await page.locator('[data-buscador] input[name="fecha"]').fill(proximaFecha(dia));
  await expectVisibles(page, tours.filter((t) => t.salidas.includes(dia)));
});

test('people filter hides experiences whose largest group is smaller than the party', async ({ page, request }) => {
  const { tours } = await catalogo(request);
  await page.goto('/');
  await abrirFiltros(page);
  const personas = page.locator('[data-buscador] input[name="personas"]');

  await personas.fill('9');
  await expectVisibles(page, tours.filter((t) => t.grupo.max >= 9));

  await personas.fill('1');
  await expectVisibles(page, tours);
});

test('a category chip, the level select and the zone select each show only their own experiences', async ({ page, request }) => {
  const { tours } = await catalogo(request);
  const categoria = valorParcial(tours, 'categoria');
  const nivel = valorParcial(tours, 'nivel');
  const zona = valorParcial(tours, 'zona');
  await page.goto('/');

  const chip = page.locator(`button[data-categoria="${categoria}"]`);
  await chip.click();
  await expect(chip).toHaveAttribute('aria-pressed', 'true');
  await expectVisibles(page, tours.filter((t) => t.categoria === categoria));
  await page.locator('button[data-categoria=""]').click();
  await expectVisibles(page, tours);

  await abrirFiltros(page);
  await page.locator('select[data-nivel]').selectOption(nivel);
  await expectVisibles(page, tours.filter((t) => t.nivel === nivel));
  await page.locator('select[data-nivel]').selectOption('');
  await expectVisibles(page, tours);

  await page.locator('[data-buscador] select[name="zona"]').selectOption(zona);
  await expectVisibles(page, tours.filter((t) => t.zona === zona));
});

test('sorting by price really orders the visible cards, both ways', async ({ page, request }) => {
  const { tours } = await catalogo(request);
  const precios = tours.map((t) => t.precio);
  await page.goto('/');
  const orden = page.locator('[data-orden]');
  // Prices of the visible cards, in DOM order.
  const enPantalla = () =>
    page.locator('[data-boleto]:visible').evaluateAll((els) => els.map((e) => Number((e as HTMLElement).dataset.precio)));

  // The API lists cheapest first, so start from the other end to prove the sort moves cards.
  await orden.selectOption('precio-desc');
  await expect(page.locator('[data-boleto]').first()).toHaveAttribute('data-precio', String(Math.max(...precios)));
  expect(await enPantalla()).toEqual([...precios].sort((a, b) => b - a));

  await orden.selectOption('precio-asc');
  await expect(page.locator('[data-boleto]').first()).toHaveAttribute('data-precio', String(Math.min(...precios)));
  expect(await enPantalla()).toEqual([...precios].sort((a, b) => a - b));
});

test('the date and group size chosen on home travel to the experience page', async ({ page, request }) => {
  const { tours } = await catalogo(request);
  const t = tours.find((o) => o.grupo.max >= 3 && o.salidas.length > 0);
  if (!t) throw new Error('no experience takes 3 people');
  const fecha = proximaFecha(t.salidas[0]);
  const personas = Math.min(t.grupo.max, Math.max(t.grupo.min, 3));

  await page.goto('/');
  await abrirFiltros(page);
  await page.locator('[data-buscador] input[name="fecha"]').fill(fecha);
  await page.locator('[data-buscador] input[name="personas"]').fill(String(personas));
  await page.getByRole('link', { name: t.titulo, exact: true }).click();

  await expect(page).toHaveURL(new RegExp(`/experiencias/${t.id}/`));
  const url = new URL(page.url());
  expect(url.searchParams.get('fecha')).toBe(fecha);
  expect(url.searchParams.get('personas')).toBe(String(personas));
  await expect(page.locator('[data-fecha]')).toHaveValue(fecha);
  await expect(page.locator('[data-personas]')).toHaveText(String(personas));
});

test('the people stepper stops at the group limits, and the total and the split add up', async ({ page, request }) => {
  const { tours, reparto, repartoSinHistoria } = await catalogo(request);
  const t = tours[0];
  await page.goto(`/experiencias/${t.id}/`);
  const contador = page.locator('[data-personas]');
  const total = page.locator('[data-total]');
  const mas = page.locator('[data-mas]');
  const menos = page.locator('[data-menos]');

  // Every step keeps the total at price x people.
  const verTotal = async () => {
    const n = Number(await contador.textContent());
    expect(pesos(await total.textContent())).toBe(t.precio * n);
  };
  await verTotal();

  for (let i = 0; i < 20 && (await mas.isEnabled()); i++) {
    await mas.click();
    await verTotal();
  }
  await expect(contador).toHaveText(String(t.grupo.max));
  await expect(mas).toBeDisabled();

  // Split at the largest group. Opening the details first.
  await page.locator('[data-reserva] summary').click();
  const operador = pesos(await page.locator('[data-r-operador]').textContent());
  const plataforma = pesos(await page.locator('[data-r-plataforma]').textContent());
  const autor = pesos(await page.locator('[data-r-autor]').textContent());
  const totalMaximo = pesos(await total.textContent());
  // The split follows the experience, not the visitor: no linked story means no author share.
  const segun = t.historias.length > 0 ? reparto : repartoSinHistoria;
  expect(operador + plataforma + autor).toBe(totalMaximo);
  expect(plataforma).toBe(Math.floor(totalMaximo * segun.plataforma));
  expect(autor).toBe(Math.floor(totalMaximo * segun.autor));

  for (let i = 0; i < 20 && (await menos.isEnabled()); i++) {
    await menos.click();
    await verTotal();
  }
  await expect(contador).toHaveText(String(t.grupo.min));
  await expect(menos).toBeDisabled();
});

test('a fractional group size in the link becomes a whole number, past dates and days the tour does not run are refused', async ({ page, request }) => {
  const { tours } = await catalogo(request);
  const t = tours[0];

  await page.goto(`/experiencias/${t.id}/?personas=2.5`);
  await expect(page.locator('[data-personas]')).toHaveText(String(Math.min(t.grupo.max, Math.max(t.grupo.min, 2))));

  await page.goto(`/experiencias/${t.id}/?fecha=2020-01-04`);
  await expect(page.locator('[data-fecha]')).toHaveValue('');
  await expect(page.locator('[data-error]')).toContainText('Esa fecha ya pasó');

  const sinSalida = tours.find((o) => diaSinSalida(o) !== undefined);
  if (!sinSalida) throw new Error('every experience runs every day');
  await page.goto(`/experiencias/${sinSalida.id}/`);
  await page.locator('[data-fecha]').fill(proximaFecha(diaSinSalida(sinSalida)!));
  await expect(page.locator('[data-error]')).toContainText('no sale ese día');
  await page.locator('[data-reservar]').click();
  await expect(page.locator('[data-error]')).toContainText('no sale ese día');
  await expect(page.locator('[data-reservar]')).toBeEnabled();
  expect(await page.evaluate(() => localStorage.getItem('ct-reservas'))).toBeNull();
});

test('a valid booking shows a code, is saved in this browser, appears on /reservas/ and can be removed', async ({ page, request }) => {
  const { tours } = await catalogo(request);
  const t = tours[0];
  const fecha = proximaFecha(t.salidas[0]);
  const personas = Math.min(t.grupo.max, Math.max(t.grupo.min, 2));

  await page.goto(`/experiencias/${t.id}/?fecha=${fecha}&personas=${personas}`);
  await page.locator('[data-reservar]').click();
  // With BTCPay configured the booking waits for its Lightning payment: pay it with the test wallet.
  const pago = page.locator('[data-pago]');
  const confirmada = page.locator('[data-confirmada]');
  await expect(page.locator('[data-pago]:visible, [data-confirmada]:visible')).toBeVisible();
  if (await pago.isVisible()) {
    const factura = await pago.locator('[data-pago-factura]').inputValue();
    expect((await request.post(`${BTCPAY}/billetera/api/pagar`, { data: { factura } })).ok()).toBe(true);
  }
  await expect(confirmada).toBeVisible({ timeout: 15000 });
  const codigo = ((await page.locator('[data-codigo]').textContent()) ?? '').trim();
  expect(codigo).toMatch(/^[0-9A-F]{8}$/);

  const guardadas = JSON.parse((await page.evaluate(() => localStorage.getItem('ct-reservas'))) ?? '[]') as { codigo: string }[];
  expect(guardadas.map((r) => r.codigo)).toEqual([codigo]);

  await page.goto('/reservas/');
  const tickets = page.locator('[data-reservas] .ticket');
  await expect(tickets).toHaveCount(1);
  await expect(tickets).toContainText(codigo);
  await expect(tickets).toContainText(t.titulo);

  await page.getByRole('button', { name: 'Quitar de este navegador' }).click();
  await expect(page.locator('[data-vacio]')).toBeVisible();
  await expect(tickets).toHaveCount(0);
});

test('Cambiar fecha o personas stops the polling, and an invoice paid after leaving is saved once', async ({ page, request }) => {
  const { tours } = await catalogo(request);
  const t = tours[0];
  const fecha = proximaFecha(t.salidas[0]);
  const personas = Math.min(t.grupo.max, Math.max(t.grupo.min, 2));
  const enlace = `/experiencias/${t.id}/?fecha=${fecha}&personas=${personas}`;
  let sondeos = 0;
  page.on('request', (r) => {
    if (r.url().includes('/api/reservar/estado/')) sondeos++;
  });

  await page.goto(enlace);
  await page.locator('[data-reservar]').click();
  const pago = page.locator('[data-pago]');
  await expect(pago).toBeVisible();
  const factura = await pago.locator('[data-pago-factura]').inputValue();
  // Leave only after a poll has run, so the stop is really tested.
  const antes = sondeos;
  await expect.poll(() => sondeos).toBeGreaterThan(antes);

  await page.getByRole('button', { name: 'Cambiar fecha o personas' }).click();
  await expect(page.locator('[data-form]')).toBeVisible();
  await expect(pago).toBeHidden();
  await expect(page.locator('[data-reservar]')).toBeEnabled();
  await page.waitForTimeout(500);
  const alVolver = sondeos;
  // The poll runs every 3 seconds: two intervals with no request means it has stopped.
  await page.waitForTimeout(7000);
  expect(sondeos).toBe(alVolver);

  // The visitor left, then the invoice was paid in the test wallet.
  expect((await request.post(`${BTCPAY}/billetera/api/pagar`, { data: { factura } })).ok()).toBe(true);

  const tickets = page.locator('[data-reservas] .ticket');
  await page.goto('/reservas/');
  await expect(tickets).toHaveCount(1);
  await expect(tickets).toContainText(t.titulo);

  await page.goto(enlace);
  await expect(page.locator('[data-reserva]')).toBeVisible();

  await page.goto('/reservas/');
  await expect(tickets).toHaveCount(1);
  await page.reload();
  await expect(tickets).toHaveCount(1);
  await expect(tickets).toContainText(t.titulo);
  const guardadas = JSON.parse((await page.evaluate(() => localStorage.getItem('ct-reservas'))) ?? '[]') as { codigo: string }[];
  expect(guardadas).toHaveLength(1);
});

test('POST /api/reservar/ refuses bad bookings with a 4xx and a JSON error, never a 5xx or a code', async ({ request }) => {
  const { tours } = await catalogo(request);
  const t = tours[0];
  const conDiaAjeno = tours.find((o) => diaSinSalida(o) !== undefined);
  if (!conDiaAjeno) throw new Error('every experience runs every day');
  const bien = { tour: t.id, fecha: proximaFecha(t.salidas[0]), personas: 2 };

  // Control: the same request with good data is accepted. In demo mode it answers the booking; with BTCPay
  // configured it answers a pending Lightning invoice, and the code comes once it is paid.
  const control = await request.post('/api/reservar/', { data: bien });
  expect(control.status()).toBe(200);
  const aceptada = (await control.json()) as { codigo?: string; estado?: string; factura?: { bolt11?: string } };
  if (aceptada.estado === 'pendiente') expect(aceptada.factura?.bolt11).toMatch(/^lnbcrt[0-9a-z]+$/);
  else expect(aceptada.codigo).toMatch(/^[0-9A-F]{8}$/);

  const casos: Record<string, string> = {
    'body null': 'null',
    'unknown tour': JSON.stringify({ ...bien, tour: 'no-existe' }),
    'past date': JSON.stringify({ ...bien, fecha: '2020-01-04' }),
    'wrong weekday': JSON.stringify({ tour: conDiaAjeno.id, fecha: proximaFecha(diaSinSalida(conDiaAjeno)!), personas: 2 }),
    '0 people': JSON.stringify({ ...bien, personas: 0 }),
    '999 people': JSON.stringify({ ...bien, personas: 999 }),
    'people "abc"': JSON.stringify({ ...bien, personas: 'abc' }),
    'impossible date 2027-02-31': JSON.stringify({ ...bien, fecha: '2027-02-31' }),
  };
  for (const [nombre, cuerpo] of Object.entries(casos)) {
    const r = await request.post('/api/reservar/', { headers: { 'content-type': 'application/json' }, data: cuerpo });
    expect(r.status(), nombre).toBeGreaterThanOrEqual(400);
    expect(r.status(), nombre).toBeLessThan(500);
    const json = (await r.json().catch(() => null)) as { error?: unknown; codigo?: unknown } | null;
    expect(typeof json?.error, nombre).toBe('string');
    expect(json?.codigo, nombre).toBeUndefined();
  }
});

test('the map shows one marker per experience with a place, and a list button opens its popup', async ({ page, request }) => {
  const { tours } = await catalogo(request);
  const conPlaza = tours.filter((t) => t.posicion !== null);
  await page.goto('/mapa/');
  await expect(page.locator('.punto')).toHaveCount(conPlaza.length);
  await expect(page.locator('.lista__boton')).toHaveCount(conPlaza.length);

  const t = conPlaza[0];
  await page.locator('.lista__boton').filter({ hasText: t.titulo }).click();
  const popup = page.locator('.leaflet-popup');
  await expect(popup).toBeVisible();
  await expect(popup).toContainText(t.titulo);
});

test('the operator panel sends a signed-out visitor to the sign-in page', async ({ page }) => {
  await page.goto('/operadores/');
  await expect(page).toHaveURL(/\/entrar\/$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Entrá a tu panel' })).toBeVisible();
});

// Skipped: the panel now needs a signed-in Clerk user, and the suite has no test account yet.
// Re-enable it once a test user can sign in against a development instance.
test.skip('the operator panel splits the default price over the largest group, and a saved draft survives a reload', async ({ page, request }) => {
  const { reparto } = await catalogo(request);
  await page.goto('/operadores/');
  const precio = Number(await page.locator('#f-precio').inputValue());
  const maximo = Number(await page.locator('#f-max').inputValue());
  const total = precio * maximo;

  await expect(page.locator('[data-r-total]')).not.toHaveText('Calculando');
  const operador = pesos(await page.locator('[data-r-operador]').textContent());
  const plataforma = pesos(await page.locator('[data-r-plataforma]').textContent());
  expect(pesos(await page.locator('[data-r-total]').textContent())).toBe(total);
  expect(plataforma).toBe(Math.floor(total * reparto.plataforma));
  expect(operador + plataforma).toBe(total);

  await page.locator('#f-titulo').fill('Taller de prueba');
  await page.locator('#f-lugar').fill('Suchitoto');
  await page.locator('#f-duracion').fill('3 horas');
  await page.locator('#f-bajada').fill('Una experiencia de prueba para el panel.');
  await page.getByRole('button', { name: 'Guardar borrador' }).click();
  await expect(page.locator('[data-estado]')).toHaveText('Borrador guardado en este navegador.');
  await expect(page.locator('.borrador h3')).toHaveText(['Taller de prueba']);

  await page.reload();
  await expect(page.locator('.borrador h3')).toHaveText(['Taller de prueba']);
  await expect(page.locator('[data-vacio]')).toBeHidden();
});

test('the credits page lists one entry per experience, and the home footer links to it', async ({ page, request }) => {
  const { tours } = await catalogo(request);
  await page.goto('/');
  const enlace = page.locator('footer').getByRole('link', { name: 'Créditos de fotos' });
  await expect(enlace).toHaveAttribute('href', '/creditos/');
  await enlace.click();

  await expect(page).toHaveURL(/\/creditos\/$/);
  await expect(page.locator('.creditos > li')).toHaveCount(tours.length);
  const enlaces = await page.locator('.creditos__titulo').evaluateAll((as) => as.map((a) => a.getAttribute('href') ?? ''));
  expect(enlaces.sort()).toEqual(tours.map((t) => `/experiencias/${t.id}/`).sort());
});

test('no page scrolls sideways at 320 px', async ({ page, request }) => {
  const { tours } = await catalogo(request);
  await page.setViewportSize({ width: 320, height: 700 });
  const rutas = ['/', `/experiencias/${tours[0].id}/`, '/mapa/', '/reservas/', '/operadores/', '/creditos/'];
  for (const ruta of rutas) {
    await page.goto(ruta);
    const desborde = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect.soft(desborde, `horizontal overflow on ${ruta}`).toBeLessThanOrEqual(0);
  }
});

test('an experience near bitcoin places shows the nearby section, with the no-partner line outside the booking box', async ({ page, request }) => {
  const { tours } = await catalogo(request);
  let conCerca: string | null = null;
  for (const t of tours) {
    await page.goto(`/experiencias/${t.id}/`);
    if ((await page.locator('[data-cerca]').count()) > 0) {
      conCerca = t.id;
      break;
    }
  }
  if (!conCerca) throw new Error('no experience has bitcoin places nearby');
  const seccion = page.locator('[data-cerca]');
  await expect(seccion).toBeVisible();
  await expect(seccion.locator('li').first()).toBeVisible();
  await expect(page.locator('[data-cerca-aviso]')).toContainText('Aceptan bitcoin según BTC Map. No son aliados de Cacao.');
  await expect(page.locator('.reserva [data-cerca]')).toHaveCount(0);
});

test('an unknown address returns 404 and shows the not-found heading', async ({ page }) => {
  const respuesta = await page.goto('/no-existe-esta-pagina/');
  expect(respuesta?.status()).toBe(404);
  await expect(page.getByRole('heading', { level: 1, name: 'Esta página no existe.' })).toBeVisible();
});

test.describe('intro', () => {
  test.use({ contextOptions: { reducedMotion: 'no-preference' } });

  test('on the first visit the intro runs and the page is clear within 2 seconds', async ({ page }) => {
    // Records the first moment the intro class is gone, measured from navigation start.
    await page.addInitScript(() => {
      const w = window as unknown as { __visto?: boolean; __fin?: number };
      const mirar = () => {
        const clases = document.documentElement?.classList;
        if (clases) {
          if (clases.contains('ct-intro')) w.__visto = true;
          else if (w.__visto && clases.length === 0 && w.__fin === undefined) w.__fin = performance.now();
        }
        requestAnimationFrame(mirar);
      };
      requestAnimationFrame(mirar);
    });
    await page.goto('/');
    await page.waitForFunction(() => (window as unknown as { __fin?: number }).__fin !== undefined);
    const { visto, fin } = await page.evaluate(() => {
      const w = window as unknown as { __visto?: boolean; __fin?: number };
      return { visto: w.__visto, fin: w.__fin };
    });
    expect(visto).toBe(true);
    expect(fin).toBeLessThan(2000);
  });

  test('a later page in the same tab has no intro', async ({ page }) => {
    // Counts every time the intro class shows up on the current document.
    await page.addInitScript(() => {
      const w = window as unknown as { __intro: number };
      w.__intro = 0;
      new MutationObserver(() => {
        if (document.documentElement?.classList.contains('ct-intro')) w.__intro++;
      }).observe(document, { subtree: true, attributes: true, attributeFilter: ['class'] });
    });
    await page.goto('/');
    // The first visit's intro ends on its own before the next page is opened.
    await expect(page.locator('html')).not.toHaveClass(/ct-intro/);
    // The recorder must have seen the intro on this first page, or the check below proves nothing.
    expect(await page.evaluate(() => (window as unknown as { __intro: number }).__intro)).toBeGreaterThan(0);

    await page.goto('/mapa/');
    expect(await page.evaluate(() => (window as unknown as { __intro: number }).__intro)).toBe(0);
    await expect(page.locator('#ct-telon')).toBeHidden();
  });

  test('pressing Escape during the intro ends it in well under a second', async ({ page }) => {
    // Times the Escape key and the moment the intro class is removed, both from the page clock.
    await page.addInitScript(() => {
      const w = window as unknown as { __tecla?: number; __fin?: number };
      addEventListener(
        'keydown',
        (e) => {
          if (e.key === 'Escape' && w.__tecla === undefined) w.__tecla = performance.now();
        },
        true,
      );
      new MutationObserver(() => {
        const clases = document.documentElement?.classList;
        if (clases && w.__tecla !== undefined && w.__fin === undefined && !clases.contains('ct-intro')) {
          w.__fin = performance.now();
        }
      }).observe(document, { subtree: true, attributes: true, attributeFilter: ['class'] });
    });
    await page.goto('/?intro=1', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('html')).toHaveClass(/ct-intro/);

    await page.keyboard.press('Escape');
    await page.waitForFunction(() => (window as unknown as { __fin?: number }).__fin !== undefined);
    const { tecla, fin } = await page.evaluate(() => {
      const w = window as unknown as { __tecla?: number; __fin?: number };
      return { tecla: w.__tecla, fin: w.__fin };
    });
    expect((fin ?? 0) - (tecla ?? 0)).toBeLessThan(1000);
  });
});
