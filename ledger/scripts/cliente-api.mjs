// Creates, lists or revokes clients of the CacaoLedger API (API v1). Run it with the environment of the project:
//
//   node --env-file=.env.local scripts/cliente-api.mjs crear --nombre "Cacao Pay" [--grupo]
//   node --env-file=.env.local scripts/cliente-api.mjs listar
//   node --env-file=.env.local scripts/cliente-api.mjs revocar cl_XXXXXXXX
//
// "crear" prints the key ONCE. Only its SHA-256 hash is stored. --grupo marks the client that may read the month's
// reports of the group (the group owner's); every other client can only register and read its own sales.

import { createHash, randomBytes } from 'node:crypto';

const [, , orden, ...resto] = process.argv;

function opcion(nombre) {
  const i = resto.indexOf(`--${nombre}`);
  return i >= 0 ? resto[i + 1] : undefined;
}

const url = (process.env.SUPABASE_URL ?? '').replace(/\/+$/, '');
const clave = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
if (!url || !clave) {
  console.error('Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY. Corré el script con --env-file=.env.local.');
  process.exit(1);
}

const cabeceras = { apikey: clave, authorization: `Bearer ${clave}`, accept: 'application/json' };

function error(mensaje) {
  console.error(mensaje);
  process.exit(1);
}

async function pedir(ruta, init = {}) {
  const r = await fetch(`${url}/rest/v1/${ruta}`, { ...init, headers: { ...cabeceras, ...(init.headers ?? {}) } });
  if (!r.ok) error(`La base respondió ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r.status === 204 ? null : r.json();
}

if (orden === 'crear') {
  const nombre = opcion('nombre');
  if (!nombre || nombre.length > 80) error('Falta --nombre (hasta 80 caracteres).');
  const grupo = resto.includes('--grupo');

  const clienteApi = `cl_${randomBytes(24).toString('base64url')}`;
  const prefijo = clienteApi.slice(0, 11);
  const hash = createHash('sha256').update(clienteApi, 'utf8').digest('hex');

  const [fila] = await pedir('ledger_clientes_api?select=id', {
    method: 'POST',
    headers: { 'content-type': 'application/json', prefer: 'return=representation' },
    body: JSON.stringify({ nombre, prefijo, clave_hash: hash, grupo }),
  });
  console.log(`Cliente creado: ${nombre} (id ${fila.id})${grupo ? ' · puede leer los reportes del grupo' : ''}`);
  console.log('');
  console.log('Clave de la API (se muestra una sola vez; guardala en el servidor del cliente):');
  console.log(clienteApi);
} else if (orden === 'listar') {
  const filas = await pedir('ledger_clientes_api?select=nombre,prefijo,grupo,creado_en,revocado_en&order=creado_en');
  for (const c of filas) {
    const estado = c.revocado_en ? `revocado ${c.revocado_en}` : 'activo';
    console.log(`${c.prefijo}  ${c.nombre}  ${c.grupo ? 'grupo' : 'solo sus ventas'}  ${estado}`);
  }
} else if (orden === 'revocar') {
  const prefijo = resto[0];
  if (!prefijo || !/^cl_[A-Za-z0-9_-]{8}$/.test(prefijo)) error('Indicá el prefijo de la clave: cl_XXXXXXXX.');
  const filas = await pedir(`ledger_clientes_api?prefijo=eq.${prefijo}&revocado_en=is.null`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', prefer: 'return=representation' },
    body: JSON.stringify({ revocado_en: new Date().toISOString() }),
  });
  console.log(filas.length > 0 ? `Clave ${prefijo} revocada.` : `No hay una clave activa con el prefijo ${prefijo}.`);
} else {
  error('Uso: crear --nombre NOMBRE [--grupo] | listar | revocar cl_XXXXXXXX');
}
