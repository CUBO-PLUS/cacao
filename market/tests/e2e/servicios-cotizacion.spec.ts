import { expect, type Locator, type Page, test } from '@playwright/test';

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

async function categoriaDeServicio(): Promise<number> {
  const { data, error } = await servicio().from('categorias_servicio').select('id').order('orden').limit(1).single();
  if (error) throw new Error(error.message);
  return data.id as number;
}

type ServicioPrueba = {
  id: string;
  usuarioId: string;
  titulo: string;
  categoriaId: number;
};

// A quoted service ("A cotizar") of a shop owner, saved through the database function.
async function publicarServicioACotizar(dueno: Persona, titulo: string): Promise<ServicioPrueba> {
  const usuarioId = await idDe(dueno);
  const categoriaId = await categoriaDeServicio();
  const { data, error } = await servicio().rpc('guardar_servicio', {
    p_usuario: usuarioId,
    p_servicio: null as unknown as string,
    p_categoria: categoriaId,
    p_titulo: titulo,
    p_descripcion: 'Servicio de prueba del test de cotizaciones.',
    p_zona: 'Suchitoto',
    p_tipo_precio: 'cotizar',
    p_precio: null as unknown as number,
    p_unidad: null as unknown as string,
    p_activo: true,
    p_fotos: [],
  });
  if (error) throw new Error(error.message);
  return { id: data.id as string, usuarioId, titulo, categoriaId };
}

// Pauses the service so it leaves the public catalogue.
async function pausarServicio(s: ServicioPrueba) {
  await servicio().rpc('guardar_servicio', {
    p_usuario: s.usuarioId,
    p_servicio: s.id,
    p_categoria: s.categoriaId,
    p_titulo: s.titulo,
    p_descripcion: 'Servicio de prueba del test de cotizaciones.',
    p_zona: 'Suchitoto',
    p_tipo_precio: 'cotizar',
    p_precio: null as unknown as number,
    p_unidad: null as unknown as string,
    p_activo: false,
    p_fotos: [],
  });
}

// The card of one quote on a list, found by its title.
function tarjetaDe(pagina: Page, titulo: string): Locator {
  return pagina.getByRole('article').filter({ has: pagina.getByRole('heading', { name: titulo, exact: true }) });
}

// Lucía opens the service page by its title, asks for a quote with a description.
async function pedirCotizacion(lucia: Page, titulo: string, descripcion: string) {
  await lucia.goto('/servicios');
  await lucia.getByLabel('Buscar servicios').fill(titulo);
  await lucia.getByRole('button', { name: 'Buscar', exact: true }).click();
  await lucia.getByRole('link', { name: titulo, exact: true }).click();
  await expect(lucia.getByRole('heading', { name: titulo, level: 1 })).toBeVisible();
  await expect(lucia.getByText('Precio según el trabajo.')).toBeVisible();

  await lucia.getByLabel('Describí el trabajo').fill(descripcion);
  const pedir = lucia.getByRole('button', { name: 'Pedir cotización', exact: true });
  await expect(pedir).toBeEnabled();
  await pedir.click();
  await expect(lucia).toHaveURL(/\/cotizaciones\/?$/);
}

test('pedir una cotización: el proveedor responde, el cliente acepta y el trabajo queda acordado', async ({
  browser,
}) => {
  const ahora = Date.now();
  const titulo = `Revision electrica e2e ${ahora}`;
  const descripcion = `Hay un corto en la cocina y saltan los breakers ${ahora}.`;
  const respuesta = `Puedo ir el jueves por la mañana ${ahora}.`;
  const sofia = await publicarServicioACotizar('sofia', titulo);

  const luciaPagina = await paginaComo(browser,'lucia');
  const sofiaPagina = await paginaComo(browser,'sofia');
  try {
    // Lucía asks for a quote; the request lands on her quotes page.
    await pedirCotizacion(luciaPagina, titulo, descripcion);
    await expect(tarjetaDe(luciaPagina, titulo)).toContainText('Esperando respuesta');

    // Sofía sees the request under "Por responder" and answers with a price and a message.
    await sofiaPagina.goto('/mi-negocio/cotizaciones');
    const porResponder = sofiaPagina.getByRole('region', { name: 'Por responder' });
    const pedido = porResponder.getByRole('listitem').filter({
      has: sofiaPagina.getByRole('heading', { name: titulo, exact: true }),
    });
    await expect(pedido).toBeVisible();
    await expect(pedido.getByText(descripcion)).toBeVisible();
    await pedido.getByLabel('Tu precio en dólares (USD)').fill('45.00');
    await pedido.getByLabel('Mensaje para el cliente').fill(respuesta);
    await pedido.getByRole('button', { name: 'Enviar cotización' }).click();
    await expect(sofiaPagina.getByRole('status').filter({ hasText: 'Enviamos tu cotización.' })).toBeVisible();
    // The answered quote leaves "Por responder" for "Ofertas que hice".
    const ofertasHechas = sofiaPagina.getByRole('region', { name: 'Ofertas que hice' });
    await expect(ofertasHechas.getByRole('heading', { name: titulo, exact: true })).toBeVisible();

    // Lucía sees the offer, accepts it through the confirm step, and lands on the job.
    await luciaPagina.goto('/cotizaciones');
    const oferta = tarjetaDe(luciaPagina, titulo);
    await expect(oferta).toContainText('Ofrecida');
    await expect(oferta.getByText('$45.00')).toBeVisible();
    await expect(oferta.getByText(respuesta)).toBeVisible();
    await oferta.getByRole('button', { name: 'Aceptar', exact: true }).click();
    await expect(
      oferta.getByText(/Vas a acordar este trabajo con .+ por \$45\.00\. Pagás cuando esté hecho\./),
    ).toBeVisible();
    await oferta.getByRole('button', { name: 'Sí, acordar el trabajo' }).click();
    await expect(luciaPagina).toHaveURL(/\/ordenes\/[0-9a-f-]{36}\/?$/);

    // The job is agreed at the quoted price.
    await expect(luciaPagina.getByRole('heading', { level: 1 })).toHaveText(/^Trabajo \d+$/);
    await expect(luciaPagina.getByRole('article').locator('header').getByText('Acordada', { exact: true })).toBeVisible();
    await expect(luciaPagina.getByRole('region', { name: 'Qué se acordó' })).toContainText('$45.00');

    // Second request: Lucía rejects the answer; both sides see it as rejected.
    const titulo2 = `Cambio de enchufes e2e ${ahora}`;
    const sofiaDos = await publicarServicioACotizar('sofia', titulo2);
    try {
      await pedirCotizacion(luciaPagina, titulo2, `Cambiar cuatro enchufes del cuarto ${ahora}.`);

      await sofiaPagina.goto('/mi-negocio/cotizaciones');
      const pedidoDos = sofiaPagina
        .getByRole('region', { name: 'Por responder' })
        .getByRole('listitem')
        .filter({ has: sofiaPagina.getByRole('heading', { name: titulo2, exact: true }) });
      await pedidoDos.getByLabel('Tu precio en dólares (USD)').fill('60.00');
      await pedidoDos.getByLabel('Mensaje para el cliente').fill('Tengo lugar la próxima semana.');
      await pedidoDos.getByRole('button', { name: 'Enviar cotización' }).click();
      await expect(sofiaPagina.getByRole('status').filter({ hasText: 'Enviamos tu cotización.' })).toBeVisible();

      await luciaPagina.goto('/cotizaciones');
      const rechazable = tarjetaDe(luciaPagina, titulo2);
      await expect(rechazable).toContainText('Ofrecida');
      // Rejecting needs no confirm step. The card moves to "Rechazada" at once; the
      // confirmation sentence unmounts with the buttons, so it is not asserted here.
      await rechazable.getByRole('button', { name: 'Rechazar', exact: true }).click();
      await expect(tarjetaDe(luciaPagina, titulo2)).toContainText('Rechazada');

      await sofiaPagina.goto('/mi-negocio/cotizaciones');
      await expect(
        sofiaPagina.getByRole('region', { name: 'Ofertas que hice' }).getByRole('listitem').filter({
          has: sofiaPagina.getByRole('heading', { name: titulo2, exact: true }),
        }),
      ).toContainText('Rechazada');
    } finally {
      await pausarServicio(sofiaDos).catch(() => undefined);
    }
  } finally {
    await pausarServicio(sofia).catch(() => undefined);
    await luciaPagina.context().close();
    await sofiaPagina.context().close();
  }
});
