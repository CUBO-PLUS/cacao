import { randomUUID } from 'node:crypto';

import { expect, type Browser, type Page, test } from '@playwright/test';

import { OPCIONES_CONTEXTO, seDesborda, servicio } from './ayuda';
import { cafetalDeAdmin, idDe, paginaComo, type Persona } from './roles';

// The Cafetal shop belongs to the admin test account while this file runs, so the provider side can act on it.
let devolverCafetal: (() => Promise<void>) | undefined;
test.beforeAll(async () => {
  devolverCafetal = await cafetalDeAdmin();
});
test.afterAll(async () => {
  await devolverCafetal?.();
});

// Every new screen at 320 px: no sideways scroll. Data is arranged per test with the database functions.
const COTIZACION_BTC = 100000;

async function categoriaDeServicio(): Promise<number> {
  const { data, error } = await servicio().from('categorias_servicio').select('id').order('orden').limit(1).single();
  if (error) throw new Error(error.message);
  return data.id as number;
}

type ServicioPrueba = {
  id: string;
  usuarioId: string;
  titulo: string;
  tipo: 'fijo' | 'cotizar';
  precio: number | null;
  unidad: string | null;
};

// A service of a shop owner, saved through the database function.
async function publicarServicio(dueno: Persona, tipo: 'fijo' | 'cotizar', titulo: string): Promise<ServicioPrueba> {
  const usuarioId = await idDe(dueno);
  const precio = tipo === 'fijo' ? 500 : null;
  const unidad = tipo === 'fijo' ? 'por corte' : null;
  const { data, error } = await servicio().rpc('guardar_servicio', {
    p_usuario: usuarioId,
    p_servicio: null as unknown as string,
    p_categoria: await categoriaDeServicio(),
    p_titulo: titulo,
    p_descripcion: 'Servicio de prueba de pantallas en 320 px.',
    p_zona: 'Suchitoto',
    p_tipo_precio: tipo,
    p_precio: precio as unknown as number,
    p_unidad: unidad as unknown as string,
    p_activo: true,
    p_fotos: [],
  });
  if (error) throw new Error(error.message);
  return { id: data.id as string, usuarioId, titulo, tipo, precio, unidad };
}

async function pausarServicio(s: ServicioPrueba) {
  await servicio()
    .rpc('guardar_servicio', {
      p_usuario: s.usuarioId,
      p_servicio: s.id,
      p_categoria: await categoriaDeServicio(),
      p_titulo: s.titulo,
      p_descripcion: 'Servicio de prueba de pantallas en 320 px.',
      p_zona: 'Suchitoto',
      p_tipo_precio: s.tipo,
      p_precio: s.precio as unknown as number,
      p_unidad: s.unidad as unknown as string,
      p_activo: false,
      p_fotos: [],
    })
    .then(() => undefined, () => undefined);
}

async function publicarNecesidad(autor: Persona, titulo: string): Promise<{ id: string; usuarioId: string }> {
  const usuarioId = await idDe(autor);
  const { data, error } = await servicio().rpc('publicar_necesidad', {
    p_usuario: usuarioId,
    p_categoria: await categoriaDeServicio(),
    p_titulo: titulo,
    p_descripcion: 'Necesidad de prueba de pantallas en 320 px.',
    p_zona: 'Suchitoto',
    p_presupuesto: 2500,
  });
  if (error) throw new Error(error.message);
  return { id: data.id as string, usuarioId };
}

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

// A job agreed by the client with the provider, through the database functions.
async function contratar(cliente: Persona, servicioId: string): Promise<{ ordenId: string }> {
  const { data, error } = await servicio().rpc('contratar_servicio', {
    p_cliente: await idDe(cliente),
    p_servicio: servicioId,
    p_nota: 'Nota de prueba de pantallas en 320 px.',
    p_clave: randomUUID(),
    p_cotizacion_btc: COTIZACION_BTC,
  });
  if (error) throw new Error(error.message);
  return { ordenId: data.id as string };
}

async function marcarHecha(ordenId: string, proveedor: Persona) {
  const { error } = await servicio().rpc('marcar_hecha', { p_orden: ordenId, p_actor: await idDe(proveedor) });
  if (error) throw new Error(error.message);
}

// A quote asked by the client and answered by the provider, so it sits in "Ofrecida".
async function cotizacionOfrecida(cliente: Persona, servicioId: string, titulo: string) {
  const { data: pedida, error } = await servicio().rpc('solicitar_cotizacion', {
    p_cliente: await idDe(cliente),
    p_servicio: servicioId,
    p_descripcion: `Descripción de prueba para ${titulo}.`,
  });
  if (error) throw new Error(error.message);
  const { error: errorRespuesta } = await servicio().rpc('responder_cotizacion', {
    p_cotizacion: pedida.id as string,
    p_actor: await idDe('sofia'),
    p_precio: 4500,
    p_mensaje: 'Puedo ir el jueves por la mañana.',
  });
  if (errorRespuesta) throw new Error(errorRespuesta.message);
}

// The page at 320 px. Waits for the page to settle, then measures the sideways scroll.
async function sinDesborde(pagina: Page, ruta: string) {
  await pagina.goto(ruta);
  await pagina.waitForLoadState('networkidle');
  expect(await seDesborda(pagina), `hay desborde horizontal en ${ruta}`).toBe(false);
}

// A signed-in page, moved to 320 px after the session is ready.
async function enPantalla320(browser: Browser, persona: Persona): Promise<Page> {
  const pagina = await paginaComo(browser, persona);
  await pagina.setViewportSize({ width: 320, height: 640 });
  return pagina;
}

test('320 px sin desborde: inicio, catálogo, servicios y tablón (sin cuenta)', async ({ browser }) => {
  const ahora = Date.now();
  const fijo = await publicarServicio('andres', 'fijo', `Pantalla fija 320 ${ahora}`);
  const cotizable = await publicarServicio('sofia', 'cotizar', `Pantalla cotizar 320 ${ahora}`);
  const necesidad = await publicarNecesidad('diego', `Pantalla tablón 320 ${ahora}`);
  const anonima = await browser.newContext({ ...OPCIONES_CONTEXTO, viewport: { width: 320, height: 640 } });
  const pagina = await anonima.newPage();
  try {
    await sinDesborde(pagina, '/');
    await sinDesborde(pagina, '/servicios');
    await sinDesborde(pagina, `/servicios/${fijo.id}`);
    await sinDesborde(pagina, `/servicios/${cotizable.id}`);
    await sinDesborde(pagina, '/necesito');
    await sinDesborde(pagina, `/necesito/${necesidad.id}`);
  } finally {
    await pausarServicio(fijo);
    await pausarServicio(cotizable);
    await cancelarNecesidad(necesidad.id, necesidad.usuarioId);
    await anonima.close();
  }
});

test('320 px sin desborde: publicar necesidad y la necesidad como autor y como oferente', async ({ browser }) => {
  const ahora = Date.now();
  const necesidad = await publicarNecesidad('diego', `Necesidad 320 ${ahora}`);
  await ofertar('rosa', necesidad.id, 3000, `Oferta de Rosa en 320 ${ahora}.`);
  const diego = await enPantalla320(browser, 'diego');
  const rosa = await enPantalla320(browser, 'rosa');
  try {
    await sinDesborde(diego, '/necesito/nuevo');
    await sinDesborde(diego, `/necesito/${necesidad.id}`);
    await sinDesborde(rosa, `/necesito/${necesidad.id}`);
  } finally {
    await cancelarNecesidad(necesidad.id, necesidad.usuarioId);
    await diego.context().close();
    await rosa.context().close();
  }
});

test('320 px sin desborde: cotizaciones de la clienta y el trabajo acordado, hecho y su pago', async ({ browser }) => {
  const ahora = Date.now();
  const fijo = await publicarServicio('andres', 'fijo', `Trabajo 320 ${ahora}`);
  const cotizable = await publicarServicio('sofia', 'cotizar', `Cotizacion 320 ${ahora}`);
  const trabajo = await contratar('lucia', fijo.id);
  await cotizacionOfrecida('lucia', cotizable.id, `Cotizacion 320 ${ahora}`);
  const lucia = await enPantalla320(browser, 'lucia');
  try {
    await sinDesborde(lucia, '/cotizaciones');
    await sinDesborde(lucia, `/ordenes/${trabajo.ordenId}`);

    await marcarHecha(trabajo.ordenId, 'andres');
    await sinDesborde(lucia, `/ordenes/${trabajo.ordenId}`);
    await sinDesborde(lucia, `/ordenes/${trabajo.ordenId}/pagar`);
  } finally {
    await pausarServicio(fijo);
    await pausarServicio(cotizable);
    await lucia.context().close();
  }
});

test('320 px sin desborde: panel de servicios y cotizaciones de quien ofrece, y sus órdenes', async ({ browser }) => {
  const ahora = Date.now();
  const fijo = await publicarServicio('andres', 'fijo', `Panel 320 ${ahora}`);
  const cotizable = await publicarServicio('sofia', 'cotizar', `Panel cotizar 320 ${ahora}`);
  await cotizacionOfrecida('lucia', cotizable.id, `Panel cotizar 320 ${ahora}`);
  const andres = await enPantalla320(browser, 'andres');
  const sofia = await enPantalla320(browser, 'sofia');
  try {
    await sinDesborde(andres, '/mi-negocio/servicios');
    await sinDesborde(andres, '/mi-negocio/servicios/nuevo');
    await sinDesborde(andres, `/mi-negocio/servicios/${fijo.id}`);
    await sinDesborde(andres, '/mi-negocio/ordenes');
    await sinDesborde(sofia, '/mi-negocio/cotizaciones');
  } finally {
    await pausarServicio(fijo);
    await pausarServicio(cotizable);
    await andres.context().close();
    await sofia.context().close();
  }
});

test('320 px sin desborde: pantallas de administración de servicios, órdenes y disputas', async ({ browser }) => {
  const ana = await enPantalla320(browser, 'ana');
  try {
    await sinDesborde(ana, '/admin/servicios');
    await sinDesborde(ana, '/admin/ordenes');
    await sinDesborde(ana, '/admin/disputas');
  } finally {
    await ana.context().close();
  }
});
