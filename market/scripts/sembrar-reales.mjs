// Demo sellers: real businesses from BTC Map, shown in the catalog as examples. For each entry of
// src/data/negocios-demo.json it creates one user row without a Clerk id, one approved shop with its
// btcmap_id, and sample products or services (examples, every one with a licensed photo). A demo seller
// is never shown as a real one: the screens label it. Idempotent: rows are updated to the list below and
// nothing is deleted. Products and services no longer in the list are switched off (activo false).
//
// Sellers in the catalog are interleaved, so the first screen mixes them.
//
// The six fictional shops of sembrar.mjs can be hidden with --ocultar-ficticios (estado suspendido) and
// shown again with --mostrar-ficticios. A demo seller that left the list is hidden the same way.
//
// Run from the market folder: node --env-file=.env.local scripts/sembrar-reales.mjs
// Only the local Supabase (127.0.0.1) is accepted, unless --produccion is given.

import { readFileSync } from 'node:fs';

import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const claveServicio = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !claveServicio) {
  console.error('Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY. Usá --env-file=.env.local.');
  process.exit(1);
}
if (new URL(url).hostname !== '127.0.0.1' && !process.argv.includes('--produccion')) {
  console.error('Sin --produccion, este script solo corre contra el Supabase local (127.0.0.1). No se hizo nada.');
  process.exit(1);
}

const argumentos = new Set(process.argv.slice(2));
const ocultarFicticios = argumentos.has('--ocultar-ficticios');
const mostrarFicticios = argumentos.has('--mostrar-ficticios');
if (ocultarFicticios && mostrarFicticios) {
  console.error('Usá solo uno: --ocultar-ficticios o --mostrar-ficticios.');
  process.exit(1);
}

const s = createClient(url, claveServicio, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});

const DEMO = JSON.parse(readFileSync(new URL('../src/data/negocios-demo.json', import.meta.url), 'utf8')).negocios;

// The six fictional shops of sembrar.mjs. Matched by name, and only the ones without a btcmap_id.
const FICTICIOS = [
  'Huerta La Ceiba',
  'Cafetal El Mirador',
  'Quesería Las Brisas',
  'Hierbas del Cerro',
  'Barbería Don Andrés',
  'Sofía Electricista',
];

const DESCRIPCION_TIPO = {
  cafe: 'Cafetería que acepta bitcoin según BTC Map.',
  comida: 'Restaurante o lugar de comida que acepta bitcoin según BTC Map.',
  servicios: 'Servicio que acepta bitcoin según BTC Map.',
};

// Sample products per shop, by BTC Map id. Generic to the kind of place, never a claim about its menu.
// Every product has a photo. [nombre, categoría, unidad, precio en centavos de USD, stock, foto]
const PRODUCTOS_POR_NEGOCIO = {
  // Cafés: each one a different pair of examples.
  23673: [
    ['Café molido', 'Granos y café', 'bolsa de 1 libra', 1100, 20, '/productos/cafe-molido.jpg'],
    ['Café en grano', 'Granos y café', 'bolsa de 1 libra', 1200, 20, '/productos/cafe-tostado-en-grano.jpg'],
  ],
  27428: [
    ['Café de altura en bolsa', 'Granos y café', 'bolsa de 1 libra', 1400, 15, '/productos/leer-la-etiqueta-bolsa-de-cafe.jpg'],
    ['Café en grano', 'Granos y café', 'bolsa de 1 libra', 1200, 20, '/productos/cafe-tostado-en-grano.jpg'],
  ],
  18673: [
    ['Café molido', 'Granos y café', 'bolsa de 1 libra', 1100, 20, '/productos/cafe-molido.jpg'],
    ['Café coado', 'Comida preparada', 'taza', 350, 40, '/productos/como-pedir-un-cafe-de-altura.jpg'],
  ],
  21869: [
    ['Café en grano', 'Granos y café', 'bolsa de 1 libra', 1200, 20, '/productos/una-cata-de-cafe-paso-a-paso.jpg'],
    ['Café coado', 'Comida preparada', 'taza', 350, 40, '/productos/como-pedir-un-cafe-de-altura.jpg'],
  ],
  3986: [
    ['Café de altura en bolsa', 'Granos y café', 'bolsa de 1 libra', 1400, 15, '/productos/leer-la-etiqueta-bolsa-de-cafe.jpg'],
    ['Café molido', 'Granos y café', 'bolsa de 1 libra', 1100, 20, '/productos/cafe-molido.jpg'],
  ],
  12509: [
    ['Café coado', 'Comida preparada', 'taza', 350, 40, '/productos/como-pedir-un-cafe-de-altura.jpg'],
    ['Café de altura en bolsa', 'Granos y café', 'bolsa de 1 libra', 1400, 15, '/productos/leer-la-etiqueta-bolsa-de-cafe.jpg'],
  ],
  // Comida.
  18714: [
    ['Pupusas', 'Comida preparada', 'porción de 3', 450, 30, '/productos/pupusas-de-madrugada.jpg'],
    ['Yuca frita', 'Comida preparada', 'porción', 400, 30, '/productos/yuca-frita-pasteles-y-la-tarde.jpg'],
  ],
  23179: [
    ['Sopa de pata', 'Comida preparada', 'plato', 650, 20, '/productos/sopa-de-pata-en-domingo.jpg'],
    ['Tamales', 'Comida preparada', 'unidad', 150, 40, '/productos/tamales-atol-y-la-mesa-de-diciembre.jpg'],
  ],
  5783: [
    ['Cóctel de conchas', 'Comida preparada', 'porción', 1200, 15, '/productos/cocteles-de-conchas.jpg'],
    ['Limonada natural', 'Frutas', 'vaso', 250, 40, '/productos/limon-mandarina.jpg'],
  ],
  30785: [
    ['Pupusa de arroz', 'Comida preparada', 'unidad', 125, 50, '/productos/pupusa-de-arroz-contra-la-de-maiz.jpg'],
    ['Horchata de morro', 'Comida preparada', 'vaso', 250, 30, '/productos/horchata-de-morro-ensalada-y-frescos.jpg'],
  ],
  27418: [
    ['Jugo natural de maracuyá', 'Frutas', 'vaso', 250, 40, '/productos/maracuya.jpg'],
    ['Jugo natural de mango', 'Frutas', 'vaso', 250, 40, '/productos/mango-manila.jpg'],
  ],
  23187: [
    ['Atol de maíz', 'Comida preparada', 'vaso', 200, 30, '/productos/tamales-atol-y-la-mesa-de-diciembre.jpg'],
    ['Limonada natural', 'Frutas', 'vaso', 250, 40, '/productos/limon-mandarina.jpg'],
  ],
};

// Sample services per shop, by BTC Map id. [título, categoría de servicio, tipo de precio, precio, unidad, foto]
const SERVICIOS_POR_NEGOCIO = {
  4745: [['Clase de surf', 'Clases y tutorías', 'fijo', 2500, 'por clase', '/productos/clase-de-surf-en-el-tunco.jpg']],
  34300: [
    ['Tour guiado por el Centro Histórico', 'Comida y eventos', 'fijo', 1500, 'por persona', '/productos/centro-historico-caminado-con-guia.jpg'],
    ['Caminata guiada en El Imposible', 'Comida y eventos', 'fijo', 2500, 'por persona', '/productos/caminata-en-el-imposible.jpg'],
  ],
  16566: [['Traslado en moto dentro de la ciudad', 'Transporte y mandados', 'fijo', 400, 'por viaje', '/productos/servicio-mandados-moto-suchitoto.jpg']],
  42794: [['Asesoría para huerto casero', 'Clases y tutorías', 'fijo', 800, 'por hora', '/productos/servicio-asesoria-huerto-casero.jpg']],
};

const CATEGORIA_NUEVA = { nombre: 'Comida preparada', orden: 7 };

// Calls a database function and stops with its message when it fails.
async function rpc(nombre, args) {
  const { data, error } = await s.rpc(nombre, args);
  if (error) throw new Error(`${nombre}: ${error.message}`);
  return data;
}

async function unico(tabla, columnas, filtros) {
  let consulta = s.from(tabla).select(columnas);
  for (const [columna, valor] of Object.entries(filtros)) consulta = consulta.eq(columna, valor);
  const { data, error } = await consulta.maybeSingle();
  if (error) throw error;
  return data;
}

// Product categories: the one new category is added when it is missing; the rest are read.
async function categoriasDeProducto() {
  const { error } = await s.from('categorias').upsert([CATEGORIA_NUEVA], { onConflict: 'nombre', ignoreDuplicates: true });
  if (error) throw error;
  return categoriaIds('categorias');
}

async function categoriaIds(tabla) {
  const { data, error } = await s.from(tabla).select('id, nombre');
  if (error) throw error;
  return Object.fromEntries(data.map((c) => [c.nombre, c.id]));
}

// One user row per demo seller, with no Clerk id. The phone column is unique, so a fixed text per BTC Map id.
async function usuarioDeDemo(negocio) {
  const telefono = `demo-btcmap-${negocio.btcmapId}`;
  const previo = await unico('usuarios', 'id', { telefono });
  if (previo) return previo.id;
  const { data, error } = await s.from('usuarios').insert({ telefono, nombre: negocio.nombre }).select('id').single();
  if (error) throw error;
  return data.id;
}

// The shop: created through the same function the app uses, then approved and given its btcmap_id.
async function negocioDeDemo(negocio, idUsuario) {
  const previo = await unico('negocios', 'id, estado', { btcmap_id: negocio.btcmapId });
  if (previo) {
    if (previo.estado !== 'aprobado') {
      const { error } = await s.from('negocios').update({ estado: 'aprobado' }).eq('id', previo.id);
      if (error) throw error;
    }
    return previo.id;
  }
  const creado = await rpc('solicitar_negocio', {
    p_usuario: idUsuario,
    p_nombre: negocio.nombre,
    p_descripcion: DESCRIPCION_TIPO[negocio.categoria],
    p_ubicacion: 'El Salvador',
    p_lightning_address: null,
  });
  const { error } = await s.from('negocios').update({ btcmap_id: negocio.btcmapId, estado: 'aprobado' }).eq('id', creado.id);
  if (error) throw error;
  return creado.id;
}

// Brings the shop's products in line with the list. Returns their ids in list order.
async function productosDeDemo(negocio, idUsuario, negocioId, categorias) {
  const lista = PRODUCTOS_POR_NEGOCIO[negocio.btcmapId] ?? [];
  const { data: existentes, error } = await s.from('productos').select('id, nombre').eq('negocio_id', negocioId);
  if (error) throw error;
  const porNombre = new Map((existentes ?? []).map((p) => [p.nombre, p.id]));
  const ids = [];

  for (const [nombre, categoria, unidad, precio, stock, foto] of lista) {
    const campos = {
      categoria_id: categorias[categoria],
      unidad,
      precio_usd_centavos: precio,
      stock,
      activo: true,
      fotos: [foto],
      descripcion: 'Producto de ejemplo para la demostración.',
    };
    let id = porNombre.get(nombre);
    if (id) {
      const { error: errorActualizar } = await s.from('productos').update(campos).eq('id', id);
      if (errorActualizar) throw errorActualizar;
    } else {
      await rpc('guardar_producto', {
        p_usuario: idUsuario,
        p_producto: null,
        p_categoria: categorias[categoria],
        p_nombre: nombre,
        p_descripcion: campos.descripcion,
        p_unidad: unidad,
        p_precio: precio,
        p_stock: stock,
        p_activo: true,
        p_fotos: [foto],
      });
      const { data: nuevo, error: errorNuevo } = await s
        .from('productos')
        .select('id')
        .eq('negocio_id', negocioId)
        .eq('nombre', nombre)
        .single();
      if (errorNuevo) throw errorNuevo;
      id = nuevo.id;
    }
    ids.push(id);
  }

  // Products that left the list stay in the database, switched off.
  const enLista = new Set(lista.map((p) => p[0]));
  const quitar = (existentes ?? []).filter((p) => !enLista.has(p.nombre)).map((p) => p.id);
  if (quitar.length > 0) {
    const { error: errorQuitar } = await s.from('productos').update({ activo: false }).in('id', quitar);
    if (errorQuitar) throw errorQuitar;
  }
  return ids;
}

async function serviciosDeDemo(negocio, idUsuario, negocioId, categoriasServicio) {
  const lista = SERVICIOS_POR_NEGOCIO[negocio.btcmapId] ?? [];
  const { data: existentes, error } = await s.from('servicios').select('id, titulo').eq('negocio_id', negocioId);
  if (error) throw error;
  const porTitulo = new Map((existentes ?? []).map((x) => [x.titulo, x.id]));
  const ids = [];

  for (const [titulo, categoria, tipo, precio, unidad, foto] of lista) {
    const campos = {
      categoria_id: categoriasServicio[categoria],
      descripcion: 'Servicio de ejemplo para la demostración.',
      zona: 'El Salvador',
      tipo_precio: tipo,
      precio_usd_centavos: precio,
      unidad,
      activo: true,
      fotos: [foto],
    };
    let id = porTitulo.get(titulo);
    if (id) {
      const { error: errorActualizar } = await s.from('servicios').update(campos).eq('id', id);
      if (errorActualizar) throw errorActualizar;
    } else {
      await rpc('guardar_servicio', {
        p_usuario: idUsuario,
        p_servicio: null,
        p_categoria: categoriasServicio[categoria],
        p_titulo: titulo,
        p_descripcion: campos.descripcion,
        p_zona: campos.zona,
        p_tipo_precio: tipo,
        p_precio: precio,
        p_unidad: unidad,
        p_activo: true,
        p_fotos: [foto],
      });
      const { data: nuevo, error: errorNuevo } = await s
        .from('servicios')
        .select('id')
        .eq('negocio_id', negocioId)
        .eq('titulo', titulo)
        .single();
      if (errorNuevo) throw errorNuevo;
      id = nuevo.id;
    }
    ids.push(id);
  }

  const enLista = new Set(lista.map((x) => x[0]));
  const quitar = (existentes ?? []).filter((x) => !enLista.has(x.titulo)).map((x) => x.id);
  if (quitar.length > 0) {
    const { error: errorQuitar } = await s.from('servicios').update({ activo: false }).in('id', quitar);
    if (errorQuitar) throw errorQuitar;
  }
  return ids;
}

// Round robin across the shops: the first screen shows one item of each shop in turn.
function intercalar(listas) {
  const salida = [];
  const largo = Math.max(0, ...listas.map((l) => l.length));
  for (let i = 0; i < largo; i++) {
    for (const lista of listas) if (i < lista.length) salida.push(lista[i]);
  }
  return salida;
}

// Shops of different kinds take turns, so the first screen never opens with one kind in a row.
function alternarCategorias(porCategoria) {
  const grupos = [porCategoria.cafe, porCategoria.comida, porCategoria.servicios];
  const largo = Math.max(0, ...grupos.map((g) => g.length));
  const listas = [];
  for (let i = 0; i < largo; i++) {
    for (const grupo of grupos) if (i < grupo.length) listas.push(grupo[i]);
  }
  return listas;
}

// The catalog lists the newest first, so the newest timestamp goes to the first item of the mix.
async function ordenarCatalogo(tabla, listas) {
  const orden = intercalar(listas);
  const base = Date.now();
  for (let i = 0; i < orden.length; i++) {
    const { error } = await s
      .from(tabla)
      .update({ creado_en: new Date(base - i * 60 * 1000).toISOString() })
      .eq('id', orden[i]);
    if (error) throw error;
  }
}

// Shows or hides the fictional shops by estado: suspendido hides them from every catalog read.
async function ficticios(estadoDestino) {
  const { data, error } = await s.from('negocios').select('id, nombre, estado').in('nombre', FICTICIOS).is('btcmap_id', null);
  if (error) throw error;

  for (const nombre of FICTICIOS) {
    const fila = (data ?? []).find((n) => n.nombre === nombre);
    if (!fila) {
      console.log(`No está en la base: ${nombre}`);
      continue;
    }
    if (fila.estado === estadoDestino) {
      console.log(`Ya estaba ${estadoDestino === 'suspendido' ? 'oculto' : 'visible'}: ${nombre}`);
      continue;
    }
    const { error: errorActualizar } = await s.from('negocios').update({ estado: estadoDestino }).eq('id', fila.id);
    if (errorActualizar) throw errorActualizar;
    console.log(`${estadoDestino === 'suspendido' ? 'Oculto' : 'Visible'} (estado ${estadoDestino}): ${nombre}`);
  }
}

// A demo seller that left the list is hidden, not deleted.
async function ocultarRetirados() {
  const ids = DEMO.map((n) => n.btcmapId);
  const { data, error } = await s.from('negocios').select('id, nombre, estado, btcmap_id').not('btcmap_id', 'is', null);
  if (error) throw error;
  for (const fila of data ?? []) {
    if (ids.includes(fila.btcmap_id) || fila.estado === 'suspendido') continue;
    const { error: errorActualizar } = await s.from('negocios').update({ estado: 'suspendido' }).eq('id', fila.id);
    if (errorActualizar) throw errorActualizar;
    console.log(`Oculto (ya no está en la lista de demostración): ${fila.nombre}`);
  }
}

async function main() {
  if (ocultarFicticios) return ficticios('suspendido');
  if (mostrarFicticios) return ficticios('aprobado');

  const categorias = await categoriasDeProducto();
  const categoriasServicio = await categoriaIds('categorias_servicio');

  const productosPorCategoria = { cafe: [], comida: [], servicios: [] };
  const serviciosPorCategoria = { cafe: [], comida: [], servicios: [] };
  for (const negocio of DEMO) {
    const idUsuario = await usuarioDeDemo(negocio);
    const negocioId = await negocioDeDemo(negocio, idUsuario);
    productosPorCategoria[negocio.categoria].push(await productosDeDemo(negocio, idUsuario, negocioId, categorias));
    serviciosPorCategoria[negocio.categoria].push(await serviciosDeDemo(negocio, idUsuario, negocioId, categoriasServicio));
    console.log(`${negocio.nombre}: OK`);
  }

  await ordenarCatalogo('productos', alternarCategorias(productosPorCategoria));
  await ordenarCatalogo('servicios', alternarCategorias(serviciosPorCategoria));
  await ocultarRetirados();
}

main().catch((error) => {
  console.error('El sembrado de demostración falló:', error.message);
  process.exit(1);
});
