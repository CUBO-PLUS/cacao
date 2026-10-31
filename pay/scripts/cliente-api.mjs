// Creates, lists or revokes clients of the Cacao Pay API (API v1). Run it with the environment of the project:
//
//   node --env-file=.env.local scripts/cliente-api.mjs crear --nombre "Market" --producto market [--tienda ID] [--elegir] [--tiendas A,B]
//   node --env-file=.env.local scripts/cliente-api.mjs listar
//   node --env-file=.env.local scripts/cliente-api.mjs revocar cp_XXXXXXXX
//
// --producto is required: every charge of the client is labelled with it (media, travel, market, pay or negocios), and a
// request cannot choose another. "crear" prints the key and the notice secret ONCE. Only the SHA-256 hash of the key is stored; the notice secret is
// stored so the server can sign notices. --tienda defaults to BTCPAY_STORE_ID. --elegir lets the client charge the
// stores in --tiendas as well as its own.

import { createHash, randomBytes } from 'node:crypto';

import { createClient } from '@supabase/supabase-js';

const [, , orden, ...resto] = process.argv;

function opcion(nombre) {
  const i = resto.indexOf(`--${nombre}`);
  return i >= 0 ? resto[i + 1] : undefined;
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const clave = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !clave) {
  console.error('Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY. Corré el script con --env-file=.env.local.');
  process.exit(1);
}
const servicio = createClient(url, clave, { auth: { persistSession: false, autoRefreshToken: false } });

function error(mensaje) {
  console.error(mensaje);
  process.exit(1);
}

if (orden === 'crear') {
  const nombre = opcion('nombre');
  if (!nombre) error('Falta --nombre.');
  const producto = opcion('producto');
  if (!['media', 'travel', 'market', 'pay', 'negocios'].includes(producto ?? '')) {
    error('Falta --producto: media, travel, market, pay o negocios.');
  }
  const tienda = opcion('tienda') ?? process.env.BTCPAY_STORE_ID;
  if (!tienda) error('Falta --tienda (o BTCPAY_STORE_ID en el entorno).');
  const tiendas = (opcion('tiendas') ?? '').split(',').map((t) => t.trim()).filter(Boolean);
  const puedeElegir = resto.includes('--elegir') || tiendas.length > 0;

  const clienteApi = `cp_${randomBytes(24).toString('base64url')}`;
  const prefijo = clienteApi.slice(0, 11);
  const hash = createHash('sha256').update(clienteApi, 'utf8').digest('hex');
  const secretoAviso = randomBytes(32).toString('hex');

  const { data, error: fallo } = await servicio.rpc('pay_crear_cliente_api', {
    p_nombre: nombre,
    p_prefijo: prefijo,
    p_clave_hash: hash,
    p_tienda: tienda,
    p_puede_elegir: puedeElegir,
    p_aviso_secreto: secretoAviso,
    p_producto: producto,
    p_tiendas: tiendas,
  });
  if (fallo) error(`No se creó el cliente: ${fallo.message}`);

  console.log(`Cliente creado: ${nombre} (id ${data})`);
  console.log(`Tienda por defecto: ${tienda}${puedeElegir ? ` · puede elegir tienda entre ${tiendas.length} más` : ''}`);
  console.log('');
  console.log('Clave de la API (se muestra una sola vez; guardala en el servidor del cliente):');
  console.log(clienteApi);
  console.log('');
  console.log('Secreto de los avisos (Cacao-Firma; se muestra una sola vez):');
  console.log(secretoAviso);
} else if (orden === 'listar') {
  const { data, error: fallo } = await servicio
    .from('pay_api_clientes')
    .select('id, nombre, prefijo, tienda_btcpay, puede_elegir_tienda, creado_en, revocado_en')
    .order('creado_en');
  if (fallo) error(`No pudimos listar los clientes: ${fallo.message}`);
  for (const c of data ?? []) {
    const estado = c.revocado_en ? `revocado ${c.revocado_en}` : 'activo';
    console.log(`${c.prefijo}  ${c.nombre}  tienda ${c.tienda_btcpay}  ${c.puede_elegir_tienda ? 'elige tienda' : 'solo su tienda'}  ${estado}`);
  }
} else if (orden === 'revocar') {
  const prefijo = resto[0];
  if (!prefijo || !/^cp_[A-Za-z0-9_-]{8}$/.test(prefijo)) error('Indicá el prefijo de la clave: cp_XXXXXXXX.');
  const { data, error: fallo } = await servicio.rpc('pay_revocar_cliente_api', { p_prefijo: prefijo });
  if (fallo) error(`No se revocó: ${fallo.message}`);
  console.log(data ? `Clave ${prefijo} revocada.` : `No hay una clave activa con el prefijo ${prefijo}.`);
} else {
  error('Uso: crear --nombre NOMBRE [--tienda ID] [--elegir] [--tiendas A,B] | listar | revocar cp_XXXXXXXX');
}
