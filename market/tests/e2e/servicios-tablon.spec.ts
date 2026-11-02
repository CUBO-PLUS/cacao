import { expect, type Locator, type Page, test } from '@playwright/test';

import { OPCIONES_CONTEXTO, servicio } from './ayuda';
import { idDe, paginaComo, type Persona } from './roles';

async function negocioDe(persona: Persona): Promise<{ id: string; nombre: string }> {
  const { data, error } = await servicio()
    .from('negocios')
    .select('id, nombre')
    .eq('usuario_id', await idDe(persona))
    .single();
  if (error) throw new Error(error.message);
  return { id: data.id as string, nombre: data.nombre as string };
}

// Offers of one need, by the shop that made them.
async function estadoDeOferta(necesidadId: string, negocioId: string) {
  const { data, error } = await servicio()
    .from('cotizaciones')
    .select('estado, orden_id')
    .eq('necesidad_id', necesidadId)
    .eq('negocio_id', negocioId)
    .single();
  if (error) throw new Error(error.message);
  return data as { estado: string; orden_id: string | null };
}

function ordenDeUrl(url: string): string {
  const coincidencia = /\/ordenes\/([0-9a-f-]{36})/i.exec(url);
  if (!coincidencia) throw new Error(`La URL no tiene una orden: ${url}`);
  return coincidencia[1];
}

function cabeceraOrden(pagina: Page) {
  return pagina.getByRole('article').locator('header');
}

// The card of one offer, found by the shop's name (the offer heading is a link to the shop).
function ofertaDe(pagina: Page, nombreNegocio: string): Locator {
  return pagina.getByRole('article').filter({ has: pagina.getByRole('link', { name: nombreNegocio, exact: true }) });
}

// Omitido: necesita dos prestadores con negocios distintos (rosa y andrés) y dos compradores; solo hay una cuenta de prueba de cada rol.
test.skip('tablón: se publica, dos ofertas, se acepta una, se cancela y vuelve al tablón', async ({ browser }) => {
  const ahora = Date.now();
  const titulo = `Reparar goteras e2e ${ahora}`;
  const descripcion = `Hay goteras en el cuarto de atrás desde la última lluvia ${ahora}.`;
  const mensajeRosa = `Puedo ir el jueves por la mañana ${ahora}.`;
  const mensajeAndres = `Llevo herramienta y materiales ${ahora}.`;
  const motivo = `Encontré a otra persona antes ${ahora}.`;

  const diego = await paginaComo(browser,'diego');
  const rosa = await paginaComo(browser,'rosa');
  const andres = await paginaComo(browser,'andres');
  const lucia = await paginaComo(browser,'lucia');
  const anonima = await browser.newContext(OPCIONES_CONTEXTO);
  const visitante = await anonima.newPage();

  const negocioRosa = await negocioDe('rosa');
  const negocioAndres = await negocioDe('andres');
  let necesidadId = '';
  let ordenId = '';

  try {
    // Diego publishes a need with a budget.
    await diego.goto('/necesito/nuevo');
    await diego.getByLabel('Qué necesitás').fill(titulo);
    await diego.getByLabel('Categoría').selectOption({ index: 1 });
    await diego.getByLabel('Descripción', { exact: true }).fill(descripcion);
    await diego.getByLabel('Zona').fill('Suchitoto');
    await diego.getByLabel('Presupuesto en dólares (opcional)').fill('25.00');
    await diego.getByRole('button', { name: 'Publicar necesidad', exact: true }).click();
    await expect(diego).toHaveURL(/\/necesito\/[0-9a-f-]{36}$/);
    necesidadId = /\/necesito\/([0-9a-f-]{36})/.exec(diego.url())?.[1] ?? '';
    await expect(diego.getByRole('heading', { name: titulo, level: 1 })).toBeVisible();
    // The empty-state wording is the screen's; match either sentence it uses.
    await expect(diego.getByText(/ofertas todavía|no hay ofertas/i).first()).toBeVisible();

    // It appears on the board.
    await diego.goto('/necesito');
    await expect(diego.getByRole('link', { name: titulo, exact: true })).toBeVisible();

    // Two providers make different offers.
    for (const [pagina, precio, mensaje] of [
      [rosa, '30.00', mensajeRosa],
      [andres, '22.00', mensajeAndres],
    ] as const) {
      await pagina.goto(`/necesito/${necesidadId}`);
      await pagina.getByLabel('Precio en dólares (USD)').fill(precio);
      await pagina.getByLabel('Tu mensaje').fill(mensaje);
      await pagina.getByRole('button', { name: 'Ofertar', exact: true }).click();
      // The saved offer replaces the form, so the offer itself is what to check.
      await expect(pagina.getByRole('region', { name: 'Tu oferta', exact: true }).getByText(mensaje)).toBeVisible();
    }

    // Signed-out visitors and Lucía see the count only: no offer text or price in the HTML.
    await visitante.goto('/necesito');
    await expect(visitante.getByRole('article').filter({ hasText: titulo }).getByText('2 ofertas')).toBeVisible();
    await visitante.goto(`/necesito/${necesidadId}`);
    await expect(visitante.getByText('2 ofertas')).toBeVisible();
    const htmlVisitante = await visitante.content();
    expect(htmlVisitante).not.toContain(mensajeRosa);
    expect(htmlVisitante).not.toContain(mensajeAndres);
    expect(htmlVisitante).not.toContain('$30.00');
    expect(htmlVisitante).not.toContain('$22.00');

    await lucia.goto(`/necesito/${necesidadId}`);
    await expect(lucia.getByText('2 ofertas')).toBeVisible();
    const htmlLucia = await lucia.content();
    expect(htmlLucia).not.toContain(mensajeRosa);
    expect(htmlLucia).not.toContain(mensajeAndres);

    // The author sees both offers with the shop names and prices.
    await diego.goto(`/necesito/${necesidadId}`);
    await expect(diego.getByText(mensajeRosa)).toBeVisible();
    await expect(diego.getByText(mensajeAndres)).toBeVisible();
    await expect(ofertaDe(diego, negocioRosa.nombre).getByText('$30.00', { exact: false })).toBeVisible();
    await expect(ofertaDe(diego, negocioAndres.nombre).getByText('$22.00', { exact: false })).toBeVisible();

    // Diego accepts Andrés's offer through the confirm step.
    const ofertaAndres = ofertaDe(diego, negocioAndres.nombre);
    await ofertaAndres.getByRole('button', { name: 'Aceptar', exact: true }).click();
    await diego.getByRole('button', { name: 'Sí, acordar el trabajo' }).click();
    await expect(diego).toHaveURL(/\/ordenes\/[0-9a-f-]{36}$/);
    ordenId = ordenDeUrl(diego.url());
    await expect(diego.getByRole('heading', { level: 1 })).toHaveText(/^Trabajo \d+$/);
    await expect(cabeceraOrden(diego).getByText('Acordada', { exact: true })).toBeVisible();

    // The need is assigned, Rosa's offer is rejected, Andrés's is accepted.
    const { data: necesidad, error } = await servicio().from('necesidades').select('estado').eq('id', necesidadId).single();
    if (error) throw error;
    expect(necesidad.estado).toBe('asignada');
    expect((await estadoDeOferta(necesidadId, negocioRosa.id)).estado).toBe('rechazada');
    const aceptada = await estadoDeOferta(necesidadId, negocioAndres.id);
    expect(aceptada.estado).toBe('aceptada');
    expect(aceptada.orden_id).toBe(ordenId);

    // The need is gone from the public board.
    await visitante.goto('/necesito');
    await expect(visitante.getByRole('heading', { name: 'Necesito', level: 1 })).toBeVisible();
    await expect(visitante.getByRole('link', { name: titulo, exact: true })).toHaveCount(0);

    // Diego cancels the job with a reason.
    await diego.getByRole('button', { name: 'Cancelar este trabajo' }).click();
    await diego.getByLabel('Motivo de la cancelación').fill(motivo);
    await diego.getByRole('button', { name: 'Cancelar el trabajo', exact: true }).click();
    await diego.getByRole('button', { name: 'Sí, cancelar el trabajo' }).click();
    await expect(cabeceraOrden(diego).getByText('Cancelada', { exact: true })).toBeVisible();
    await expect(diego.getByText(`Motivo: ${motivo}`, { exact: true })).toBeVisible();

    // Andrés sees the same cancellation and reason.
    await andres.goto(`/ordenes/${ordenId}`);
    await expect(cabeceraOrden(andres).getByText('Cancelada', { exact: true })).toBeVisible();
    await expect(andres.getByText(`Motivo: ${motivo}`, { exact: true })).toBeVisible();

    // The need goes back to the board, and Andrés's offer is withdrawn.
    const { data: tras, error: errorTras } = await servicio().from('necesidades').select('estado').eq('id', necesidadId).single();
    if (errorTras) throw errorTras;
    expect(tras.estado).toBe('abierta');
    expect((await estadoDeOferta(necesidadId, negocioAndres.id)).estado).toBe('retirada');
    await visitante.goto('/necesito');
    await expect(visitante.getByRole('link', { name: titulo, exact: true })).toBeVisible();
  } finally {
    if (necesidadId) {
      // Cancels the need so it leaves the board, when it is still open.
      await servicio()
        .rpc('cancelar_necesidad', { p_necesidad: necesidadId, p_usuario: await idDe('diego') })
        .then(() => undefined, () => undefined);
    }
    await Promise.all([diego, rosa, andres, lucia].map((pagina) => pagina.context().close().catch(() => undefined)));
    await anonima.close().catch(() => undefined);
  }
});
