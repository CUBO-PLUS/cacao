import { randomUUID } from 'node:crypto';

import { expect, type Locator, type Page, test } from '@playwright/test';

import { servicio } from './ayuda';
import { cafetalDeAdmin, idDe, paginaComo, type Persona } from './roles';

// Review Focus cases of the services plan. Each test arranges its own data and cleans up what
// would otherwise stay in the public lists.
const COTIZACION_BTC = 100000;

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
  negocioId: string;
  usuarioId: string;
  titulo: string;
  tipo: 'fijo' | 'cotizar';
  precio: number | null;
  unidad: string | null;
};

// A service of a shop owner, saved through the database function.
async function publicarServicio(
  dueno: Persona,
  datos: { titulo: string; tipo: 'fijo' | 'cotizar'; precio?: number; unidad?: string },
): Promise<ServicioPrueba> {
  const usuarioId = await idDe(dueno);
  const precio = datos.tipo === 'fijo' ? (datos.precio ?? 500) : null;
  const unidad = datos.tipo === 'fijo' ? (datos.unidad ?? 'por corte') : null;
  const { data, error } = await servicio().rpc('guardar_servicio', {
    p_usuario: usuarioId,
    p_servicio: null as unknown as string,
    p_categoria: await categoriaDeServicio(),
    p_titulo: datos.titulo,
    p_descripcion: 'Servicio de prueba de riesgos.',
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
    tipo: datos.tipo,
    precio,
    unidad,
  };
}

// Pauses a service the test created, so it leaves the public catalogue.
async function pausarServicio(s: ServicioPrueba) {
  await servicio()
    .rpc('guardar_servicio', {
      p_usuario: s.usuarioId,
      p_servicio: s.id,
      p_categoria: await categoriaDeServicio(),
      p_titulo: s.titulo,
      p_descripcion: 'Servicio de prueba de riesgos.',
      p_zona: 'Suchitoto',
      p_tipo_precio: s.tipo,
      p_precio: s.precio as unknown as number,
      p_unidad: s.unidad as unknown as string,
      p_activo: false,
      p_fotos: [],
    })
    .then(() => undefined, () => undefined);
}

// A need of a user, published through the database function.
async function publicarNecesidad(autor: Persona, titulo: string): Promise<{ id: string; usuarioId: string }> {
  const usuarioId = await idDe(autor);
  const { data, error } = await servicio().rpc('publicar_necesidad', {
    p_usuario: usuarioId,
    p_categoria: await categoriaDeServicio(),
    p_titulo: titulo,
    p_descripcion: 'Necesidad de prueba de riesgos.',
    p_zona: 'Suchitoto',
    p_presupuesto: null as unknown as number,
  });
  if (error) throw new Error(error.message);
  return { id: data.id as string, usuarioId };
}

// Cancels a need the test published, so it leaves the board.
async function cancelarNecesidad(necesidadId: string, usuarioId: string) {
  await servicio()
    .rpc('cancelar_necesidad', { p_necesidad: necesidadId, p_usuario: usuarioId })
    .then(() => undefined, () => undefined);
}

async function ofertar(persona: Persona, necesidadId: string, precio: number, mensaje: string) {
  const { error } = await servicio().rpc('ofertar', {
    p_usuario: await idDe(persona),
    p_necesidad: necesidadId,
    p_precio: precio,
    p_mensaje: mensaje,
  });
  if (error) throw new Error(error.message);
}

// A quote a client asks from a quoted service.
async function pedirCotizacion(cliente: Persona, servicioId: string, descripcion: string) {
  const { error } = await servicio().rpc('solicitar_cotizacion', {
    p_cliente: await idDe(cliente),
    p_servicio: servicioId,
    p_descripcion: descripcion,
  });
  if (error) throw new Error(error.message);
}

// Hires a fixed-price service as the client. The clave is what the browser sends for one form.
async function contratar(cliente: Persona, servicioId: string) {
  const { data, error } = await servicio().rpc('contratar_servicio', {
    p_cliente: await idDe(cliente),
    p_servicio: servicioId,
    p_nota: '',
    p_clave: randomUUID(),
    p_cotizacion_btc: COTIZACION_BTC,
  });
  if (error) throw new Error(error.message);
  return { ordenId: data.id as string, numero: data.numero as number };
}

async function marcarHecha(ordenId: string, proveedor: Persona) {
  const { error } = await servicio().rpc('marcar_hecha', { p_orden: ordenId, p_actor: await idDe(proveedor) });
  if (error) throw new Error(error.message);
}

async function nombreDeNegocio(persona: Persona): Promise<{ id: string; nombre: string }> {
  const { data, error } = await servicio()
    .from('negocios')
    .select('id, nombre')
    .eq('usuario_id', await idDe(persona))
    .single();
  if (error) throw new Error(error.message);
  return { id: data.id as string, nombre: data.nombre as string };
}

// The offers of one need, as stored.
async function ofertasDeNecesidad(necesidadId: string) {
  const { data, error } = await servicio()
    .from('cotizaciones')
    .select('negocio_id, estado, orden_id')
    .eq('necesidad_id', necesidadId);
  if (error) throw new Error(error.message);
  return data as { negocio_id: string; estado: string; orden_id: string | null }[];
}

function ordenDeUrl(url: string): string {
  const coincidencia = /\/ordenes\/([0-9a-f-]{36})/i.exec(url);
  if (!coincidencia) throw new Error(`La URL no tiene una orden: ${url}`);
  return coincidencia[1];
}

function cabeceraOrden(pagina: Page) {
  return pagina.getByRole('article').locator('header');
}

// The card of one offer on a need, found by the shop's name (the offer heading links to the shop).
function ofertaDe(pagina: Page, nombreNegocio: string): Locator {
  return pagina.getByRole('article').filter({ has: pagina.getByRole('link', { name: nombreNegocio, exact: true }) });
}

// Riesgo 1: two accepts of different offers at the same moment, from two tabs of the same author.
// Omitido: necesita dos prestadores con negocios distintos; solo hay una cuenta de prueba de vendedor.
test.skip('dos aceptaciones a la vez de ofertas distintas: nace una sola orden', async ({ browser }) => {
  const ahora = Date.now();
  const necesidad = await publicarNecesidad('diego', `Carrera de aceptar e2e ${ahora}`);
  const rosa = await nombreDeNegocio('rosa');
  const andres = await nombreDeNegocio('andres');
  await ofertar('rosa', necesidad.id, 3000, `Oferta de Rosa ${ahora}.`);
  await ofertar('andres', necesidad.id, 2200, `Oferta de Andrés ${ahora}.`);

  const primera = await paginaComo(browser,'diego');
  const segunda = await paginaComo(browser,'diego');
  try {
    for (const pagina of [primera, segunda]) {
      await pagina.goto(`/necesito/${necesidad.id}`);
      await expect(pagina.getByRole('heading', { level: 1 })).toBeVisible();
    }
    // Each tab picks a different offer, then both confirm at the same moment.
    await ofertaDe(primera, rosa.nombre).getByRole('button', { name: 'Aceptar', exact: true }).click();
    await ofertaDe(segunda, andres.nombre).getByRole('button', { name: 'Aceptar', exact: true }).click();
    await Promise.all([
      primera.getByRole('button', { name: 'Sí, acordar el trabajo' }).click(),
      segunda.getByRole('button', { name: 'Sí, acordar el trabajo' }).click(),
    ]);

    // One tab reaches the job; the other stays on the need and shows a Spanish message.
    await expect.poll(() => /\/ordenes\//.test(primera.url()) || /\/ordenes\//.test(segunda.url())).toBe(true);
    const perdedora = /\/ordenes\//.test(primera.url()) ? segunda : primera;
    // The route announcer is also role=alert, so only the page's main area counts.
    const alerta = perdedora.getByRole('main').getByRole('alert');
    await expect(alerta).toBeVisible();
    const texto = (await alerta.innerText()).trim();
    expect(texto).toMatch(/[a-záéíóúñ]/i);
    expect(texto).not.toMatch(/error|exception|undefined/i);
    await expect(perdedora.getByText('Application error')).toHaveCount(0);

    // Exactly one accepted offer with one order; the other offer rejected; the need assigned.
    const ofertas = await ofertasDeNecesidad(necesidad.id);
    expect(ofertas.filter((o) => o.estado === 'aceptada')).toHaveLength(1);
    expect(ofertas.filter((o) => o.estado === 'rechazada')).toHaveLength(1);
    const ordenes = new Set(ofertas.map((o) => o.orden_id).filter((id): id is string => id !== null));
    expect(ordenes.size).toBe(1);
    const { data: fila, error } = await servicio().from('necesidades').select('estado').eq('id', necesidad.id).single();
    if (error) throw error;
    expect(fila.estado).toBe('asignada');
  } finally {
    await cancelarNecesidad(necesidad.id, necesidad.usuarioId);
    await primera.context().close();
    await segunda.context().close();
  }
});

// Riesgo 1 (second half): a double tap on the confirm button of one accept.
// Omitido: necesita dos prestadores con negocios distintos; solo hay una cuenta de prueba de vendedor.
test.skip('doble toque en "Sí, acordar el trabajo": una sola orden', async ({ browser }) => {
  const ahora = Date.now();
  const necesidad = await publicarNecesidad('diego', `Doble confirmar e2e ${ahora}`);
  const rosa = await nombreDeNegocio('rosa');
  const andres = await nombreDeNegocio('andres');
  await ofertar('rosa', necesidad.id, 3000, `Oferta de Rosa doble ${ahora}.`);
  await ofertar('andres', necesidad.id, 2200, `Oferta de Andrés doble ${ahora}.`);

  const diego = await paginaComo(browser,'diego');
  try {
    await diego.goto(`/necesito/${necesidad.id}`);
    await ofertaDe(diego, rosa.nombre).getByRole('button', { name: 'Aceptar', exact: true }).click();
    await diego.getByRole('button', { name: 'Sí, acordar el trabajo' }).dblclick();
    await expect(diego).toHaveURL(/\/ordenes\/[0-9a-f-]{36}\/?$/);

    const ofertas = await ofertasDeNecesidad(necesidad.id);
    expect(ofertas.filter((o) => o.estado === 'aceptada')).toHaveLength(1);
    expect(ofertas.filter((o) => o.estado === 'rechazada')).toHaveLength(1);
    const ordenes = new Set(ofertas.map((o) => o.orden_id).filter((id): id is string => id !== null));
    expect(ordenes.size).toBe(1);
    expect(ofertas.find((o) => o.negocio_id === andres.id)?.estado).toBe('rechazada');
  } finally {
    await cancelarNecesidad(necesidad.id, necesidad.usuarioId);
    await diego.context().close();
  }
});

// Riesgo 2: a double tap on "Contratar" creates one job for that service and client.
for (const [indice, gesto] of (['doble toque', 'dos clics seguidos'] as const).entries()) {
  test(`${gesto} en "Contratar" crea un solo trabajo`, async ({ browser }) => {
    const servicioPrueba = await publicarServicio('andres', {
      titulo: `Contratar doble e2e ${Date.now()} ${indice}`,
      tipo: 'fijo',
    });
    const lucia = await paginaComo(browser,'lucia');
    try {
      await lucia.goto(`/servicios/${servicioPrueba.id}`);
      const contratar = lucia.getByRole('button', { name: 'Contratar', exact: true });
      await expect(contratar).toBeEnabled();

      if (gesto === 'doble toque') {
        await contratar.dblclick();
      } else {
        // Two clicks in one task: the second lands before React re-renders the button.
        await contratar.evaluate((boton) => {
          (boton as HTMLButtonElement).click();
          (boton as HTMLButtonElement).click();
        });
      }
      await expect(lucia).toHaveURL(/\/ordenes\/[0-9a-f-]{36}\/?$/);

      // One job for this service and this client, and it stays one.
      const contar = async () => {
        const { data, error } = await servicio().from('lineas_orden').select('orden_id').eq('servicio_id', servicioPrueba.id);
        if (error) throw error;
        return new Set(data.map((f) => f.orden_id as string)).size;
      };
      await expect.poll(contar, { timeout: 10_000 }).toBe(1);
      await lucia.waitForTimeout(2_000); // a second request would need this long to land
      expect(await contar()).toBe(1);
    } finally {
      await pausarServicio(servicioPrueba);
      await lucia.context().close();
    }
  });
}

// Riesgo 3: a late payment of a lapsed request never marks the job paid (database level).
test('un pago tardío de una solicitud vencida no marca el trabajo como pagado', async () => {
  const servicioPrueba = await publicarServicio('andres', { titulo: `Pago tardio e2e ${Date.now()}`, tipo: 'fijo' });
  const trabajo = await contratar('lucia', servicioPrueba.id);
  await marcarHecha(trabajo.ordenId, 'andres');
  try {
    // A request as the payment screen makes it, then its deadline moves into the past.
    const { error: errorCobro } = await servicio().rpc('registrar_cobro_servicio', {
      p_orden: trabajo.ordenId,
      p_proveedor: 'falso',
      p_referencia: null as unknown as string,
      p_bolt11: null as unknown as string,
      p_destino: null as unknown as string,
      p_verificar_url: null as unknown as string,
      p_expira_en: new Date(Date.now() + 600_000).toISOString(),
      p_cotizacion_btc: COTIZACION_BTC,
    });
    if (errorCobro) throw new Error(errorCobro.message);
    const { error } = await servicio()
      .from('cobros')
      .update({ expira_en: new Date(Date.now() - 60_000).toISOString() })
      .eq('orden_id', trabajo.ordenId);
    if (error) throw error;

    // Paying the lapsed request is refused, and the job stays unpaid.
    const { error: errorTardio } = await servicio().rpc('confirmar_pago', {
      p_orden: trabajo.ordenId,
      p_actor: null as unknown as string,
    });
    expect(errorTardio?.message ?? '').toMatch(/FUERA_DE_PLAZO|ESTADO_INVALIDO/);
    const { data: orden, error: errorOrden } = await servicio()
      .from('ordenes')
      .select('estado, pagada_en')
      .eq('id', trabajo.ordenId)
      .single();
    if (errorOrden) throw errorOrden;
    expect(orden.pagada_en).toBeNull();
    expect(orden.estado).not.toBe('entregada');
  } finally {
    await pausarServicio(servicioPrueba);
  }
});

// Riesgo 3 on screen: the payment screen tells the client and offers a new request. It must not
// renew the request by itself, because the amount in sats can change.
// Skip: the test ends by paying with "Simular pago", which only shows for a demo shop without a BTCPay store; the e2e seller charges through BTCPay (see btcpay-flujo.spec.ts).
test.skip('la solicitud de pago de un trabajo vence con la pantalla abierta: se avisa, vuelve a "Trabajo hecho" y se puede pedir otra', async ({
  browser,
}) => {
  const servicioPrueba = await publicarServicio('andres', { titulo: `Vence trabajo e2e ${Date.now()}`, tipo: 'fijo' });
  const trabajo = await contratar('lucia', servicioPrueba.id);
  await marcarHecha(trabajo.ordenId, 'andres');

  const lucia = await paginaComo(browser,'lucia');
  try {
    await lucia.goto(`/ordenes/${trabajo.ordenId}/pagar`);
    await expect(lucia.getByRole('button', { name: 'Simular pago' })).toBeVisible();
    await expect(lucia.getByText(/Vence en \d+:\d{2}/)).toBeVisible();

    const { error } = await servicio()
      .from('cobros')
      .update({ expira_en: new Date(Date.now() - 60_000).toISOString() })
      .eq('orden_id', trabajo.ordenId);
    if (error) throw error;

    await expect(lucia.getByText('El tiempo de esta solicitud de pago se acabó', { exact: false })).toBeVisible({
      timeout: 20_000,
    });
    await expect(lucia.getByRole('button', { name: 'Generar otra solicitud' })).toBeVisible();
    await expect(lucia.locator('body')).not.toContainText(/cancelad/i);

    const { data: orden, error: errorOrden } = await servicio()
      .from('ordenes')
      .select('estado, pagada_en')
      .eq('id', trabajo.ordenId)
      .single();
    if (errorOrden) throw errorOrden;
    expect(orden.estado).toBe('hecha');
    expect(orden.pagada_en).toBeNull();

    await lucia.getByRole('button', { name: 'Generar otra solicitud' }).click();
    await expect(lucia.getByRole('button', { name: 'Simular pago' })).toBeVisible({ timeout: 20_000 });
    await lucia.getByRole('button', { name: 'Simular pago' }).click();
    await expect(lucia).toHaveURL(new RegExp(`/ordenes/${trabajo.ordenId}/?$`), { timeout: 30_000 });
    await expect(cabeceraOrden(lucia).getByText('Entregada', { exact: true })).toBeVisible();
  } finally {
    await pausarServicio(servicioPrueba);
    await lucia.context().close();
  }
});

// Riesgo 4: the provider changes the price and pauses the service after a hire; the job keeps the agreed price.
test('el precio acordado sobrevive: si el negocio cambia el precio o pausa el servicio, el trabajo y el pago siguen en $5.00', async ({
  browser,
}) => {
  const servicioPrueba = await publicarServicio('andres', { titulo: `Precio acordado e2e ${Date.now()}`, tipo: 'fijo' });
  const lucia = await paginaComo(browser,'lucia');
  const andres = await paginaComo(browser,'andres');
  try {
    // Lucía hires at $5.00 from the service page.
    await lucia.goto(`/servicios/${servicioPrueba.id}`);
    await expect(lucia.getByText('$5.00', { exact: true }).first()).toBeVisible();
    await lucia.getByRole('button', { name: 'Contratar', exact: true }).click();
    await expect(lucia).toHaveURL(/\/ordenes\/[0-9a-f-]{36}\/?$/);
    const ordenId = ordenDeUrl(lucia.url());

    // Andrés changes the price to $9.00 and pauses the service.
    await andres.goto(`/mi-negocio/servicios/${servicioPrueba.id}`);
    await andres.getByLabel('Precio en dólares (USD)').fill('9.00');
    await andres.getByLabel('Activo', { exact: true }).uncheck();
    await andres.getByRole('button', { name: 'Guardar servicio', exact: true }).click();
    await expect(andres).toHaveURL(/\/mi-negocio\/servicios\/?\?guardado=1$/);
    const { data: fila, error } = await servicio()
      .from('servicios')
      .select('precio_usd_centavos, activo')
      .eq('id', servicioPrueba.id)
      .single();
    if (error) throw error;
    expect(fila.precio_usd_centavos).toBe(900);
    expect(fila.activo).toBe(false);

    // The paused service is gone from its public page.
    await lucia.goto(`/servicios/${servicioPrueba.id}`);
    await expect(lucia.getByRole('heading', { name: 'Esta página no existe.' })).toBeVisible();

    // Andrés marks the work done; the job and its payment still say $5.00.
    await andres.goto(`/ordenes/${ordenId}`);
    await andres.getByRole('button', { name: 'Marcar trabajo hecho' }).click();
    await andres.getByRole('button', { name: 'Sí, está hecho' }).click();
    await expect(cabeceraOrden(andres).getByText('Trabajo hecho', { exact: true })).toBeVisible();

    await lucia.goto(`/ordenes/${ordenId}`);
    await expect(lucia.getByRole('region', { name: 'Qué se acordó' })).toContainText('$5.00');
    await expect(lucia.getByRole('region', { name: 'Qué se acordó' })).not.toContainText('$9.00');

    await lucia.goto(`/ordenes/${ordenId}/pagar`);
    await expect(lucia.getByRole('heading', { name: /^Pagar el trabajo \d+$/ })).toBeVisible();
    await expect(lucia.getByText('$5.00', { exact: true }).first()).toBeVisible();
    await expect(lucia.locator('body')).not.toContainText('$9.00');
  } finally {
    await pausarServicio(servicioPrueba);
    await lucia.context().close();
    await andres.context().close();
  }
});

// Riesgo 5: a stranger guesses URLs of a job, its payment, a quote, a need's offers and a service.
// Omitido: necesita una tercera persona ajena; la cuenta de compradora ya es la clienta del trabajo.
test.skip('URLs ajenas: trabajo, pago, cotizaciones, ofertas y servicio de otra persona no muestran datos', async ({
  browser,
}) => {
  const ahora = Date.now();
  const servicioPrueba = await publicarServicio('andres', { titulo: `Ajeno e2e ${ahora}`, tipo: 'fijo' });
  const trabajo = await contratar('lucia', servicioPrueba.id);
  const necesidad = await publicarNecesidad('diego', `Necesidad ajena e2e ${ahora}`);
  const mensajeAjeno = `Oferta privada de Rosa ${ahora}.`;
  await ofertar('rosa', necesidad.id, 3000, mensajeAjeno);
  const cotizable = await publicarServicio('sofia', { titulo: `Cotizacion ajena e2e ${ahora}`, tipo: 'cotizar' });
  const descripcionAjena = `Descripción privada de Lucía ${ahora}.`;
  await pedirCotizacion('lucia', cotizable.id, descripcionAjena);

  const mario = await paginaComo(browser,'mario');
  try {
    // Lucía's job and its payment screen.
    for (const ruta of [`/ordenes/${trabajo.ordenId}`, `/ordenes/${trabajo.ordenId}/pagar`]) {
      await mario.goto(ruta);
      await expect(mario.getByRole('heading', { name: 'Esta página no existe.' }), ruta).toBeVisible();
      await expect(mario.locator('body'), ruta).not.toContainText(servicioPrueba.titulo);
    }

    // Diego's need is public, but no offer and no "Tu oferta" is shown to Mario.
    await mario.goto(`/necesito/${necesidad.id}`);
    await expect(mario.getByRole('heading', { level: 1 })).toHaveText(`Necesidad ajena e2e ${ahora}`);
    await expect(mario.getByText(mensajeAjeno)).toHaveCount(0);
    await expect(mario.getByRole('region', { name: 'Tu oferta', exact: true })).toHaveCount(0);

    // Lucía's quote does not show on Mario's own quote pages.
    for (const ruta of ['/cotizaciones', '/mi-negocio/cotizaciones']) {
      await mario.goto(ruta);
      await expect(mario.getByRole('heading', { level: 1 })).toBeVisible();
      await expect(mario.locator('body'), ruta).not.toContainText(descripcionAjena);
      await expect(mario.locator('body'), ruta).not.toContainText(cotizable.titulo);
    }

    // Andrés's service on Mario's provider panel: not found.
    await mario.goto(`/mi-negocio/servicios/${servicioPrueba.id}`);
    await expect(mario.getByRole('heading', { name: 'Esta página no existe.' })).toBeVisible();
    await expect(mario.locator('body')).not.toContainText(servicioPrueba.titulo);
  } finally {
    await cancelarNecesidad(necesidad.id, necesidad.usuarioId);
    await pausarServicio(cotizable);
    await pausarServicio(servicioPrueba);
    await mario.context().close();
  }
});

// A suspended shop: its services leave the catalogue, and a direct link cannot hire them.
test('un negocio suspendido: sus servicios no se ven en /servicios y no se pueden contratar por URL', async ({
  browser,
}) => {
  const ahora = Date.now();
  const titulo = `Suspendido e2e ${ahora}`;
  const tomas = await nombreDeNegocio('tomas');
  const { data: negocioAntes, error: errorNegocio } = await servicio()
    .from('negocios')
    .select('estado')
    .eq('id', tomas.id)
    .single();
  if (errorNegocio) throw errorNegocio;
  const estadoAntes = negocioAntes.estado as string;

  const servicioPrueba = await publicarServicio('tomas', { titulo, tipo: 'fijo', precio: 200, unidad: 'por viaje' });
  const lucia = await paginaComo(browser,'lucia');
  try {
    // Visible before the suspension.
    await lucia.goto(`/servicios?q=${encodeURIComponent(titulo)}`);
    await expect(lucia.getByRole('link', { name: titulo, exact: true })).toBeVisible();

    // Ana suspends the shop.
    const { error } = await servicio().rpc('cambiar_estado_negocio', {
      p_negocio: tomas.id,
      p_actor: await idDe('ana'),
      p_estado: 'suspendido' as unknown as 'aprobado',
    });
    if (error) throw error;

    await lucia.goto(`/servicios?q=${encodeURIComponent(titulo)}`);
    await expect(lucia.locator('#contenido').getByText('No hay servicios con esa búsqueda o categoría.')).toBeVisible();
    await expect(lucia.getByRole('link', { name: titulo, exact: true })).toHaveCount(0);

    // The direct link is not found, and the database refuses the hire as well.
    await lucia.goto(`/servicios/${servicioPrueba.id}`);
    await expect(lucia.getByRole('heading', { name: 'Esta página no existe.' })).toBeVisible();
    const { error: errorContratar } = await servicio().rpc('contratar_servicio', {
      p_cliente: await idDe('lucia'),
      p_servicio: servicioPrueba.id,
      p_nota: '',
      p_clave: randomUUID(),
      p_cotizacion_btc: COTIZACION_BTC,
    });
    expect(errorContratar).not.toBeNull();
  } finally {
    // Restores the shop whatever happened above, then takes the test service off the catalogue.
    const { error } = await servicio().rpc('cambiar_estado_negocio', {
      p_negocio: tomas.id,
      p_actor: await idDe('ana'),
      p_estado: estadoAntes as unknown as 'aprobado',
    });
    await pausarServicio(servicioPrueba);
    await lucia.context().close();
    if (error) throw new Error(`No pude restaurar el negocio de prueba: ${error.message}`);
  }
});
