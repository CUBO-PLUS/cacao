// End-to-end test of the Cacao Pay payments API (v1), against the running dev server and the demo BTCPay.
//
//   node --env-file=.env.local tests/api/cobros-api.mjs
//
// It creates two API clients with scripts/cliente-api.mjs, then: creates a charge with a key, repeats it (same
// charge, no new invoice), refuses a changed body, pays the invoice from the test wallet, sees it paid, receives the
// signed notice and checks its signature here (not with the server's code), reads it back, checks that another client
// cannot read it, cancels a second charge, and checks auth and the BTCPay webhook signature.
//
// Keys and secrets are never printed. Output is one line per check.

import { spawnSync } from 'node:child_process';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const APP = (process.env.PAY_URL ?? 'http://localhost:4324').replace(/\/+$/, '');
const BILLETERA = 'http://127.0.0.1:8088/billetera/api';

let fallos = 0;
function comprobar(nombre, condicion, detalle = '') {
  console.log(`${condicion ? 'OK  ' : 'FALLO'} ${nombre}${detalle && !condicion ? ` (${detalle})` : ''}`);
  if (!condicion) fallos++;
}

// Creates an API client with the script, and reads its key and notice secret from the output without printing them.
function crearCliente(nombre) {
  const r = spawnSync(process.execPath, ['scripts/cliente-api.mjs', 'crear', '--nombre', nombre, '--producto', 'market'], {
    cwd: raiz,
    env: process.env,
    encoding: 'utf8',
  });
  if (r.status !== 0) throw new Error(`No se creó el cliente de prueba (salida ${r.status}).`);
  const lineas = r.stdout.split('\n').map((l) => l.trim());
  const clave = lineas[lineas.indexOf('Clave de la API (se muestra una sola vez; guardala en el servidor del cliente):') + 1];
  const secreto = lineas[lineas.indexOf('Secreto de los avisos (Cacao-Firma; se muestra una sola vez):') + 1];
  if (!/^cp_[A-Za-z0-9_-]{32}$/.test(clave ?? '') || !/^[0-9a-f]{64}$/.test(secreto ?? '')) {
    throw new Error('La salida del script no trae la clave ni el secreto.');
  }
  return { clave, secreto, prefijo: clave.slice(0, 11) };
}

// The signature check, written again here so the test does not trust the server's own code.
function firmaValidaEnPrueba(cabecera, cuerpo, secreto) {
  const partes = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(cabecera ?? '');
  if (!partes) return false;
  const t = Number(partes[1]);
  if (Math.abs(Date.now() / 1000 - t) > 300) return false;
  const esperada = createHmac('sha256', secreto).update(`${t}.${cuerpo}`, 'utf8').digest();
  const recibida = Buffer.from(partes[2], 'hex');
  return recibida.length === esperada.length && timingSafeEqual(recibida, esperada);
}

// The notice receiver: a local server that records every notice it gets.
const avisos = [];
const receptor = createServer((req, res) => {
  let cuerpo = '';
  req.on('data', (trozo) => (cuerpo += trozo));
  req.on('end', () => {
    avisos.push({ ruta: req.url, cabecera: req.headers['cacao-firma'], id: req.headers['cacao-aviso-id'], cuerpo });
    res.writeHead(200).end('ok');
  });
});
await new Promise((resolver) => receptor.listen(0, '127.0.0.1', resolver));
const puerto = receptor.address().port;
const AVISO_URL = `http://127.0.0.1:${puerto}/aviso`;

function esperar(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function llamar(metodo, ruta, { clave, cuerpo, idempotencia, cabeceras = {} } = {}) {
  const h = { 'content-type': 'application/json', ...cabeceras };
  if (clave) h.authorization = `Bearer ${clave}`;
  if (idempotencia) h['idempotency-key'] = idempotencia;
  const r = await fetch(APP + (ruta.endsWith('/') ? ruta : ruta + '/'), { method: metodo, headers: h, body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo) });
  const texto = await r.text();
  let json = null;
  try {
    json = texto ? JSON.parse(texto) : null;
  } catch {
    json = null;
  }
  return { status: r.status, json, cabeceras: r.headers };
}

try {
  const tienda = process.env.BTCPAY_STORE_ID;
  if (!tienda) throw new Error('Falta BTCPAY_STORE_ID en el entorno.');
  const pagos = crearCliente('Prueba e2e API');
  const otro = crearCliente('Prueba e2e ajena');

  const ref = `e2e-${Date.now()}`;
  const cuerpo = { monto: 2500, moneda: 'USD', descripcion: 'Prueba e2e de la API', referencia: ref, aviso_url: AVISO_URL };
  const idem = `idem-${ref}`;

  // 0. A request cannot choose the product: the client's product labels every charge.
  const conProducto = await llamar('POST', '/api/v1/cobros', {
    clave: pagos.clave,
    cuerpo: { ...cuerpo, producto: 'negocios' },
    idempotencia: `${idem}-prod`,
  });
  comprobar('un cuerpo con "producto" se rechaza (400)', conProducto.status === 400, `estado ${conProducto.status}`);

  // 1. Create a charge.
  const creado = await llamar('POST', '/api/v1/cobros', { clave: pagos.clave, cuerpo, idempotencia: idem });
  comprobar('crear un cobro responde 201', creado.status === 201, `estado ${creado.status} ${JSON.stringify(creado.json?.error ?? '')}`);
  const cobro = creado.json ?? {};
  comprobar('el cobro trae factura Lightning, sats y centavos', /^lnbcrt/.test(cobro.factura ?? '') && cobro.sats > 0 && cobro.usd_centavos === 2500);
  comprobar('el cobro empieza pendiente con enlace de pago', cobro.estado === 'pendiente' && typeof cobro.enlace_pago === 'string');

  // 2. The same key and body: the same charge, no new invoice.
  const repetido = await llamar('POST', '/api/v1/cobros', { clave: pagos.clave, cuerpo, idempotencia: idem });
  comprobar('repetir la misma clave devuelve el mismo cobro (200)', repetido.status === 200 && repetido.json?.id === cobro.id, `estado ${repetido.status}`);
  comprobar('la repetición no hace una factura nueva', repetido.json?.factura === cobro.factura);
  comprobar('la repetición avisa que es una repetición', repetido.cabeceras.get('idempotent-replayed') === 'true');

  // 3. The same key with another body is refused.
  const cambiado = await llamar('POST', '/api/v1/cobros', {
    clave: pagos.clave,
    cuerpo: { ...cuerpo, monto: 2600 },
    idempotencia: idem,
  });
  comprobar('la misma clave con otro cuerpo responde 409', cambiado.status === 409 && cambiado.json?.error?.codigo === 'IDEMPOTENCIA_CONFLICTO');

  // 4. Simultaneous creates with a new key make one charge.
  const idemSimultanea = `idem-sim-${ref}`;
  const simultaneos = await Promise.all(
    [1, 2, 3].map(() => llamar('POST', '/api/v1/cobros', { clave: pagos.clave, cuerpo: { ...cuerpo, referencia: `${ref}-sim` }, idempotencia: idemSimultanea })),
  );
  const exitosos = simultaneos.filter((r) => r.status === 200 || r.status === 201);
  const ids = new Set(exitosos.map((r) => r.json?.id));
  comprobar('tres creaciones simultáneas: al menos una crea y todas dan el mismo cobro', exitosos.length >= 1 && ids.size === 1,
    simultaneos.map((r) => r.status).join(','));

  // 5. Read the live state.
  const leido = await llamar('GET', `/api/v1/cobros/${cobro.id}`, { clave: pagos.clave });
  comprobar('leer el cobro responde 200 y está pendiente', leido.status === 200 && leido.json?.estado === 'pendiente');

  // 6. Pay the invoice from the test wallet, and read it back: the server asks BTCPay and sees it paid.
  const pago = await fetch(`${BILLETERA}/pagar`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ factura: cobro.factura }),
  });
  comprobar('la billetera de prueba paga la factura', pago.ok, `estado ${pago.status}`);

  let pagado = null;
  for (let i = 0; i < 20 && pagado?.estado !== 'pagado'; i++) {
    await esperar(1000);
    pagado = (await llamar('GET', `/api/v1/cobros/${cobro.id}`, { clave: pagos.clave })).json;
  }
  comprobar('el cobro pasa a pagado tras leerlo de nuevo en BTCPay', pagado?.estado === 'pagado', `estado ${pagado?.estado}`);

  // 7. The notice: received, signed, with the charge id and the new state.
  let aviso = null;
  for (let i = 0; i < 25 && !aviso; i++) {
    aviso = avisos.find((a) => a.cuerpo.includes(cobro.id)) ?? null;
    if (!aviso) await esperar(1000);
  }
  comprobar('llega el aviso del cambio a la dirección del cliente', aviso !== null);
  if (aviso) {
    const datos = JSON.parse(aviso.cuerpo);
    comprobar('el aviso trae el cobro y el estado pagado', datos.id === cobro.id && datos.estado === 'pagado' && datos.tipo === 'cobro.estado');
    comprobar('la firma Cacao-Firma del aviso es válida con el secreto del cliente', firmaValidaEnPrueba(aviso.cabecera, aviso.cuerpo, pagos.secreto));
    comprobar('la firma no vale con otro secreto', !firmaValidaEnPrueba(aviso.cabecera, aviso.cuerpo, otro.secreto));
    comprobar('el aviso trae Cacao-Aviso-Id igual a su id en el cuerpo', aviso.id === datos.aviso);
  }

  // 8. Another client cannot read the charge: it is not found.
  const ajeno = await llamar('GET', `/api/v1/cobros/${cobro.id}`, { clave: otro.clave });
  comprobar('otro cliente no lee el cobro (404)', ajeno.status === 404);

  // 9. Cancel: a pending charge is cancelled; a paid one is refused.
  const otroRef = `${ref}-cancelar`;
  const nuevo = await llamar('POST', '/api/v1/cobros', {
    clave: pagos.clave,
    cuerpo: { ...cuerpo, referencia: otroRef },
    idempotencia: `idem-${otroRef}`,
  });
  const cancelado = await llamar('POST', `/api/v1/cobros/${nuevo.json?.id}/cancelar`, { clave: pagos.clave });
  comprobar('cancelar un cobro pendiente responde cancelado', cancelado.status === 200 && cancelado.json?.estado === 'cancelado', `estado ${cancelado.status}`);
  const cancelarDeNuevo = await llamar('POST', `/api/v1/cobros/${nuevo.json?.id}/cancelar`, { clave: pagos.clave });
  comprobar('cancelar otra vez no cambia nada (200)', cancelarDeNuevo.status === 200 && cancelarDeNuevo.json?.estado === 'cancelado');
  const cancelarPagado = await llamar('POST', `/api/v1/cobros/${cobro.id}/cancelar`, { clave: pagos.clave });
  comprobar('un cobro pagado no se cancela (409)', cancelarPagado.status === 409 && cancelarPagado.json?.error?.codigo === 'ESTADO_INVALIDO');

  // 10. Auth: no key, an unknown key, and a revoked key are all refused.
  const sinClave = await llamar('GET', `/api/v1/cobros/${cobro.id}`);
  comprobar('sin clave responde 401', sinClave.status === 401);
  const falsa = await llamar('GET', `/api/v1/cobros/${cobro.id}`, { clave: `cp_${'x'.repeat(32)}` });
  comprobar('una clave que no existe responde 401', falsa.status === 401);
  spawnSync(process.execPath, ['scripts/cliente-api.mjs', 'revocar', otro.prefijo], { cwd: raiz, env: process.env, encoding: 'utf8' });
  const revocada = await llamar('GET', `/api/v1/cobros/${cobro.id}`, { clave: otro.clave });
  comprobar('una clave revocada responde 401', revocada.status === 401);

  // 11. CORS is closed: the API answers no cross-origin headers.
  const cors = await fetch(APP + '/api/v1/cobros/x/', { method: 'OPTIONS', headers: { origin: 'https://ejemplo.com' } });
  comprobar('sin CORS: ningún origen externo recibe permiso', cors.headers.get('access-control-allow-origin') === null);

  // 12. The BTCPay webhook refuses a body without a valid signature.
  const webhook = await llamar('POST', '/api/v1/btcpay/aviso', { cuerpo: { type: 'InvoiceSettled', invoiceId: cobro.id, storeId: tienda } });
  comprobar('el aviso de BTCPay sin firma válida responde 401', webhook.status === 401);
  // With a valid signature, a notice about an invoice that is no charge here is accepted and changes nothing.
  const cuerpoHook = JSON.stringify({ type: 'InvoiceSettled', invoiceId: 'ZZZZZZZZZZZZZZZZZZZZ', storeId: tienda });
  const firma = 'sha256=' + createHmac('sha256', process.env.PAY_BTCPAY_WEBHOOK_SECRET ?? '').update(cuerpoHook).digest('hex');
  const hookFirmado = await fetch(APP + '/api/v1/btcpay/aviso/', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'btcpay-sig': firma },
    body: cuerpoHook,
  });
  comprobar('un aviso de BTCPay con firma válida responde 200', hookFirmado.status === 200, `estado ${hookFirmado.status}`);
} catch (error) {
  console.error('La prueba se detuvo:', error instanceof Error ? error.message : error);
  fallos++;
} finally {
  receptor.close();
}

console.log(fallos === 0 ? '\nTodo bien.' : `\n${fallos} comprobación(es) fallaron.`);
process.exit(fallos === 0 ? 0 : 1);
