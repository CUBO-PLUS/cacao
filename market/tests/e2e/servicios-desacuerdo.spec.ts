import { randomUUID } from 'node:crypto';

import { expect, type Locator, type Page, test } from '@playwright/test';

import { servicio } from './ayuda';
import { cafetalDeAdmin, idDe, paginaComo } from './roles';

// The Cafetal shop belongs to the admin test account while this file runs, so the provider side can act on it.
let devolverCafetal: (() => Promise<void>) | undefined;
test.beforeAll(async () => {
  devolverCafetal = await cafetalDeAdmin();
});
test.afterAll(async () => {
  await devolverCafetal?.();
});

const COTIZACION_BTC = 100000;

async function categoriaDeServicio(): Promise<number> {
  const { data, error } = await servicio().from('categorias_servicio').select('id').order('orden').limit(1).single();
  if (error) throw new Error(error.message);
  return data.id as number;
}

// A fixed-price service of Andrés, saved through the database function.
async function publicarServicioFijo(titulo: string): Promise<{ id: string; usuarioId: string }> {
  const usuarioId = await idDe('andres');
  const { data, error } = await servicio().rpc('guardar_servicio', {
    p_usuario: usuarioId,
    p_servicio: null as unknown as string,
    p_categoria: await categoriaDeServicio(),
    p_titulo: titulo,
    p_descripcion: 'Servicio de prueba del test de desacuerdos.',
    p_zona: 'Suchitoto',
    p_tipo_precio: 'fijo',
    p_precio: 500,
    p_unidad: 'por corte',
    p_activo: true,
    p_fotos: [],
  });
  if (error) throw new Error(error.message);
  return { id: data.id as string, usuarioId };
}

async function pausarServicio(id: string, usuarioId: string, titulo: string) {
  await servicio().rpc('guardar_servicio', {
    p_usuario: usuarioId,
    p_servicio: id,
    p_categoria: await categoriaDeServicio(),
    p_titulo: titulo,
    p_descripcion: 'Servicio de prueba del test de desacuerdos.',
    p_zona: 'Suchitoto',
    p_tipo_precio: 'fijo',
    p_precio: 500,
    p_unidad: 'por corte',
    p_activo: false,
    p_fotos: [],
  });
}

// A job at "Trabajo hecho": hired by Lucía, marked done by Andrés, with the database functions.
async function trabajoHecho(titulo: string): Promise<{ ordenId: string; numero: number; servicioId: string; usuarioId: string; titulo: string }> {
  const andresId = await idDe('andres');
  const luciaId = await idDe('lucia');
  const publicado = await publicarServicioFijo(titulo);
  const { data: orden, error } = await servicio().rpc('contratar_servicio', {
    p_cliente: luciaId,
    p_servicio: publicado.id,
    p_nota: 'Nota del test de desacuerdos.',
    p_clave: randomUUID(),
    p_cotizacion_btc: COTIZACION_BTC,
  });
  if (error) throw new Error(error.message);
  const { error: errorHecha } = await servicio().rpc('marcar_hecha', { p_orden: orden.id, p_actor: andresId });
  if (errorHecha) throw new Error(errorHecha.message);
  return { ordenId: orden.id as string, numero: orden.numero as number, servicioId: publicado.id, usuarioId: publicado.usuarioId, titulo };
}

function cabeceraOrden(pagina: Page) {
  return pagina.getByRole('article').locator('header');
}

// The card of one dispute on the admin page, by its order number.
function tarjetaDisputa(admin: Page, numero: number): Locator {
  return admin
    .getByRole('article')
    .filter({ has: admin.getByRole('heading', { name: `Orden ${numero}`, exact: true }) });
}

// Lucía opens the dispute from a job that is done and not paid.
async function abrirDisputa(lucia: Page, ordenId: string, motivo: string) {
  await lucia.goto(`/ordenes/${ordenId}`);
  await expect(cabeceraOrden(lucia).getByText('Trabajo hecho', { exact: true })).toBeVisible();
  await lucia.getByRole('button', { name: 'No estoy de acuerdo con el trabajo' }).click();
  await lucia.getByLabel('Contá qué pasó').fill(motivo);
  await lucia.getByRole('button', { name: 'Abrir disputa', exact: true }).click();
  await expect(cabeceraOrden(lucia).getByText('En disputa', { exact: true })).toBeVisible();
}

// Skip: the payment step needs "Simular pago", which only shows for a demo shop without a BTCPay store; the e2e seller charges through BTCPay (see btcpay-flujo.spec.ts).
test.skip('desacuerdo: corresponde pagar devuelve el trabajo a "Trabajo hecho" y Lucía puede pagarlo', async ({
  browser,
}) => {
  const ahora = Date.now();
  const titulo = `Desacuerdo pagar e2e ${ahora}`;
  const motivo = `El trabajo quedó a medias, el baño sigue con fuga ${ahora}.`;
  const nota = 'Se revisó el trabajo y sí quedó hecho.';
  const trabajo = await trabajoHecho(titulo);

  const lucia = await paginaComo(browser,'lucia');
  const admin = await paginaComo(browser,'ana');
  try {
    await abrirDisputa(lucia, trabajo.ordenId, motivo);
    await lucia.context().close();

    // The admin sees only the two results for an unpaid job.
    await admin.goto('/admin/disputas');
    const tarjeta = tarjetaDisputa(admin, trabajo.numero);
    await expect(tarjeta).toBeVisible();
    await expect(tarjeta.getByRole('radio')).toHaveCount(2);
    await expect(tarjeta.getByRole('radio', { name: 'Corresponde pagar', exact: true })).toBeVisible();
    await expect(tarjeta.getByRole('radio', { name: 'No corresponde pagar', exact: true })).toBeVisible();
    await tarjeta.getByRole('radio', { name: 'Corresponde pagar', exact: true }).check();
    await tarjeta.getByLabel('Nota de resolución').fill(nota);
    await tarjeta.getByRole('button', { name: 'Resolver disputa', exact: true }).click();
    await expect(tarjeta.getByText('Resuelta', { exact: true }).first()).toBeVisible();
    await expect(tarjeta.getByText('Corresponde pagar', { exact: true })).toBeVisible();

    // Back at "Trabajo hecho": Lucía can pay the job.
    const luciaDeNuevo = await paginaComo(browser,'lucia');
    try {
      await luciaDeNuevo.goto(`/ordenes/${trabajo.ordenId}`);
      await expect(cabeceraOrden(luciaDeNuevo).getByText('Trabajo hecho', { exact: true })).toBeVisible();
      await luciaDeNuevo.getByRole('link', { name: 'Pagar el trabajo' }).click();
      await expect(luciaDeNuevo).toHaveURL(new RegExp(`/ordenes/${trabajo.ordenId}/pagar/?$`));
      await luciaDeNuevo.getByRole('button', { name: 'Simular pago' }).click();
      await expect(luciaDeNuevo).toHaveURL(new RegExp(`/ordenes/${trabajo.ordenId}/?$`), { timeout: 30_000 });
      await expect(cabeceraOrden(luciaDeNuevo).getByText('Entregada', { exact: true })).toBeVisible();
    } finally {
      await luciaDeNuevo.context().close();
    }
  } finally {
    await pausarServicio(trabajo.servicioId, trabajo.usuarioId, trabajo.titulo).catch(() => undefined);
    await admin.context().close().catch(() => undefined);
  }
});

test('desacuerdo: no corresponde pagar deja el trabajo cancelado', async ({ browser }) => {
  const ahora = Date.now();
  const titulo = `Desacuerdo cancelar e2e ${ahora}`;
  const motivo = `No vino a hacer el trabajo, lo que hizo no sirve ${ahora}.`;
  const nota = 'El trabajo no se hizo como se acordó.';
  const trabajo = await trabajoHecho(titulo);

  const lucia = await paginaComo(browser,'lucia');
  const admin = await paginaComo(browser,'ana');
  try {
    await abrirDisputa(lucia, trabajo.ordenId, motivo);
    await lucia.context().close();

    await admin.goto('/admin/disputas');
    const tarjeta = tarjetaDisputa(admin, trabajo.numero);
    await expect(tarjeta).toBeVisible();
    await tarjeta.getByRole('radio', { name: 'No corresponde pagar', exact: true }).check();
    await tarjeta.getByLabel('Nota de resolución').fill(nota);
    await tarjeta.getByRole('button', { name: 'Resolver disputa', exact: true }).click();
    await expect(tarjeta.getByText('Resuelta', { exact: true }).first()).toBeVisible();
    await expect(tarjeta.getByText('No corresponde pagar', { exact: true })).toBeVisible();

    // The job ends cancelled for the client, with the result in the dispute.
    const luciaDeNuevo = await paginaComo(browser,'lucia');
    try {
      await luciaDeNuevo.goto(`/ordenes/${trabajo.ordenId}`);
      await expect(cabeceraOrden(luciaDeNuevo).getByText('Cancelada', { exact: true })).toBeVisible();
      await expect(luciaDeNuevo.getByRole('link', { name: 'Pagar el trabajo' })).toHaveCount(0);
      // Scoped to the dispute section inside the page content: the same text also appears outside it.
      await expect(
        luciaDeNuevo
          .locator('#contenido section[aria-labelledby="disputa-titulo"]')
          .getByText('No corresponde pagar', { exact: true }),
      ).toBeVisible();
    } finally {
      await luciaDeNuevo.context().close();
    }
  } finally {
    await pausarServicio(trabajo.servicioId, trabajo.usuarioId, trabajo.titulo).catch(() => undefined);
    await admin.context().close().catch(() => undefined);
  }
});

test('trabajo hecho hace más de 48 horas sin pagar aparece en "Trabajos sin pagar" del admin', async ({ browser }) => {
  const ahora = Date.now();
  const viejo = await trabajoHecho(`Sin pagar viejo e2e ${ahora}`);
  const reciente = await trabajoHecho(`Sin pagar reciente e2e ${ahora}`);
  const admin = await paginaComo(browser,'ana');
  try {
    // Done 49 hours ago; the other one was done just now.
    const hace49h = new Date(Date.now() - 49 * 60 * 60 * 1000).toISOString();
    const { error } = await servicio().from('ordenes').update({ hecha_en: hace49h }).eq('id', viejo.ordenId);
    if (error) throw error;

    await admin.goto('/admin/ordenes');
    const bloque = admin.getByRole('region', { name: 'Trabajos sin pagar hace más de 48 horas' });
    await expect(bloque).toBeVisible();
    const fila = bloque.getByRole('listitem').filter({
      has: admin.getByRole('link', { name: `Trabajo ${viejo.numero}`, exact: true }),
    });
    await expect(fila).toBeVisible();
    await expect(fila).toContainText('2 días');
    // A job done just now is not in the list yet.
    await expect(bloque.getByRole('link', { name: `Trabajo ${reciente.numero}`, exact: true })).toHaveCount(0);
  } finally {
    await pausarServicio(viejo.servicioId, viejo.usuarioId, viejo.titulo).catch(() => undefined);
    await pausarServicio(reciente.servicioId, reciente.usuarioId, reciente.titulo).catch(() => undefined);
    await admin.context().close().catch(() => undefined);
  }
});
