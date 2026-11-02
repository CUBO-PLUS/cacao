import { expect, type Page, test } from '@playwright/test';

import { servicio } from './ayuda';
import { cafetalDeAdmin, idDe, paginaComo, type Persona } from './roles';

// The Cafetal shop belongs to the admin test account while this file runs, so the provider side can act on it.
let devolverCafetal: (() => Promise<void>) | undefined;
test.beforeAll(async () => {
  devolverCafetal = await cafetalDeAdmin();
});
test.afterAll(async () => {
  await devolverCafetal?.();
});

// Arranged data for one run. Titles carry the run time, so searches find only this test's service.
async function categoriaDeServicio(): Promise<number> {
  const { data, error } = await servicio().from('categorias_servicio').select('id').order('orden').limit(1).single();
  if (error) throw new Error(error.message);
  return data.id as number;
}

type ServicioPrueba = {
  id: string;
  negocioId: string;
  usuarioId: string;
  titulo: string;
  precio: number | null;
  unidad: string | null;
  tipo: 'fijo' | 'cotizar';
  categoriaId: number;
};

// A service of a shop owner, saved through the database function.
async function publicarServicio(
  dueno: Persona,
  datos: { titulo: string; tipo: 'fijo' | 'cotizar'; precio?: number; unidad?: string },
): Promise<ServicioPrueba> {
  const usuarioId = await idDe(dueno);
  const categoriaId = await categoriaDeServicio();
  const precio = datos.tipo === 'fijo' ? (datos.precio ?? 500) : null;
  const unidad = datos.tipo === 'fijo' ? (datos.unidad ?? 'por corte') : null;
  const { data, error } = await servicio().rpc('guardar_servicio', {
    p_usuario: usuarioId,
    p_servicio: null as unknown as string,
    p_categoria: categoriaId,
    p_titulo: datos.titulo,
    p_descripcion: 'Servicio de prueba del test de punta a punta.',
    p_zona: 'Suchitoto',
    p_tipo_precio: datos.tipo,
    p_precio: precio as unknown as number,
    p_unidad: unidad as unknown as string,
    p_activo: true,
    p_fotos: [],
  });
  if (error) throw new Error(error.message);
  return {
    id: data.id as string,
    negocioId: data.negocio_id as string,
    usuarioId,
    titulo: datos.titulo,
    precio,
    unidad,
    tipo: datos.tipo,
    categoriaId,
  };
}

// Pauses the service so it does not stay in the public catalogue after the test.
async function pausarServicio(s: ServicioPrueba) {
  await servicio().rpc('guardar_servicio', {
    p_usuario: s.usuarioId,
    p_servicio: s.id,
    p_categoria: s.categoriaId,
    p_titulo: s.titulo,
    p_descripcion: 'Servicio de prueba del test de punta a punta.',
    p_zona: 'Suchitoto',
    p_tipo_precio: s.tipo,
    p_precio: s.precio as unknown as number,
    p_unidad: s.unidad as unknown as string,
    p_activo: false,
    p_fotos: [],
  });
}

function ordenDeUrl(url: string): string {
  const coincidencia = /\/ordenes\/([0-9a-f-]{36})/i.exec(url);
  if (!coincidencia) throw new Error(`La URL no tiene una orden: ${url}`);
  return coincidencia[1];
}

// The header of the order card: the state badge is the only element with the state text there.
function cabeceraOrden(pagina: Page) {
  return pagina.getByRole('article').locator('header');
}

// Skip: the payment step needs "Simular pago", which only shows for a demo shop without a BTCPay store; the e2e seller charges through BTCPay (see btcpay-flujo.spec.ts).
test.skip('contratar un servicio de precio fijo: se paga al terminar, con reseña en el trabajo y en la tienda', async ({
  browser,
}) => {
  const ahora = Date.now();
  const titulo = `Corte e2e ${ahora}`;
  const nota = `Mañana a las 3 en mi casa, timbre azul ${ahora}.`;
  const comentario = `Muy buen corte, llegó puntual ${ahora}.`;
  const andres = await publicarServicio('andres', { titulo, tipo: 'fijo', precio: 500, unidad: 'por corte' });

  const lucia = await paginaComo(browser,'lucia');
  let andresPagina: Page | null = null;
  try {
    // Lucía finds the service through the search box and opens it.
    await lucia.goto('/servicios');
    await lucia.getByLabel('Buscar servicios').fill(titulo);
    await lucia.getByRole('button', { name: 'Buscar', exact: true }).click();
    await expect(lucia).toHaveURL(/q=Corte/);
    await lucia.getByRole('link', { name: titulo, exact: true }).click();
    await expect(lucia).toHaveURL(new RegExp(`/servicios/${andres.id}/?$`));

    // The price in dollars and in sats, and the payment promise, before any hire.
    await expect(lucia.getByRole('heading', { name: titulo, level: 1 })).toBeVisible();
    await expect(lucia.getByText('$5.00', { exact: true }).first()).toBeVisible();
    await expect(lucia.getByText('sats', { exact: true }).first()).toBeVisible();
    await expect(lucia.getByText('Pagás cuando el trabajo esté hecho. CacaoMarket no guarda tu dinero.')).toBeVisible();

    // Hire with a note: the job starts as agreed, and the note is the first chat message.
    await lucia.getByLabel('Contale cuándo y dónde').fill(nota);
    const contratar = lucia.getByRole('button', { name: 'Contratar', exact: true });
    await expect(contratar).toBeEnabled();
    await contratar.click();
    await expect(lucia).toHaveURL(/\/ordenes\/[0-9a-f-]{36}\/?$/);
    const ordenId = ordenDeUrl(lucia.url());
    await expect(lucia.getByRole('heading', { level: 1 })).toHaveText(/^Trabajo \d+$/);
    await expect(cabeceraOrden(lucia).getByText('Acordada', { exact: true })).toBeVisible();
    await expect(lucia.getByRole('log').getByText(nota, { exact: true })).toBeVisible();

    // The provider opens the same job and marks the work done.
    andresPagina = await paginaComo(browser,'andres');
    await andresPagina.goto(`/ordenes/${ordenId}`);
    await andresPagina.getByRole('button', { name: 'Marcar trabajo hecho' }).click();
    await andresPagina.getByRole('button', { name: 'Sí, está hecho' }).click();
    await expect(cabeceraOrden(andresPagina).getByText('Trabajo hecho', { exact: true })).toBeVisible();
    await expect(andresPagina.getByRole('heading', { name: 'Código de entrega' })).toHaveCount(0);

    // The client now pays. The payment screen shows sats, USD and the countdown.
    await lucia.goto(`/ordenes/${ordenId}`);
    await lucia.getByRole('link', { name: 'Pagar el trabajo' }).click();
    await expect(lucia).toHaveURL(new RegExp(`/ordenes/${ordenId}/pagar/?$`));
    await expect(lucia.getByRole('heading', { name: /^Pagar el trabajo \d+$/ })).toBeVisible();
    await expect(lucia.getByText('sats', { exact: true }).first()).toBeVisible();
    await expect(lucia.getByText('$5.00', { exact: true }).first()).toBeVisible();
    await expect(lucia.getByText(/Vence en \d+:\d{2}/)).toBeVisible();

    await lucia.getByRole('button', { name: 'Simular pago' }).click();
    await expect(lucia).toHaveURL(new RegExp(`/ordenes/${ordenId}/?$`), { timeout: 30_000 });
    await expect(cabeceraOrden(lucia).getByText('Entregada', { exact: true })).toBeVisible();
    // A job never shows a delivery code, paid or not.
    await expect(lucia.getByRole('heading', { name: 'Código de entrega' })).toHaveCount(0);

    // Five-star review with a comment.
    await lucia.getByLabel('5 estrellas').check();
    await lucia.getByLabel('Comentario (opcional)').fill(comentario);
    await lucia.getByRole('button', { name: 'Enviar reseña' }).click();
    const tuResena = lucia.getByRole('region', { name: 'Tu reseña', exact: true });
    await expect(tuResena.getByText(comentario, { exact: true })).toBeVisible();

    // The review also shows on the shop's public page.
    await lucia.goto(`/negocios/${andres.negocioId}`);
    const resenas = lucia.getByRole('region', { name: 'Reseñas', exact: true });
    await expect(resenas.getByText(comentario, { exact: true })).toBeVisible();
  } finally {
    await pausarServicio(andres).catch(() => undefined);
    await lucia.context().close();
    await andresPagina?.context().close();
  }
});
