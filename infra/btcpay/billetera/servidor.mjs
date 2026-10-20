// Front door of the demo. ngrok publishes this one port.
// - /billetera: the test wallet. It pays a regtest Lightning invoice from the lnd_comprador node, so anyone can try
//   the demo without a wallet of their own. Regtest coins have no value.
// - Everything else is passed to BTCPay Server unchanged.
// No dependencies: only Node's own modules.
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { readFileSync } from 'node:fs';

const PUERTO = 8088;
const BTCPAY = { host: 'btcpayserver', port: 49392 };
const LND = 'lnd_comprador';
const DIR_LND = '/lnd/data/chain/bitcoin/regtest/admin.macaroon';
// The test wallet pays at most this amount per invoice.
const MAXIMO_SATS = 1_000_000;

function lnd(metodo, ruta, cuerpo) {
  const macaroon = readFileSync(DIR_LND).toString('hex');
  const ca = readFileSync('/lnd/tls.cert');
  const datos = cuerpo ? JSON.stringify(cuerpo) : undefined;
  return new Promise((resolver, rechazar) => {
    const pedido = https.request(
      { host: LND, port: 8080, path: ruta, method: metodo, ca, servername: LND, timeout: 60_000,
        headers: { 'Grpc-Metadata-macaroon': macaroon, 'content-type': 'application/json' } },
      (r) => {
        let t = '';
        r.on('data', (c) => (t += c));
        r.on('end', () => {
          let lineas = [];
          try { lineas = [JSON.parse(t)]; } catch {
            for (const l of t.split('\n')) { try { if (l.trim()) lineas.push(JSON.parse(l)); } catch {} }
          }
          resolver({ estado: r.statusCode, json: lineas[0] ?? {}, lineas });
        });
      },
    );
    pedido.on('timeout', () => pedido.destroy(new Error('LND no respondió')));
    pedido.on('error', rechazar);
    if (datos) pedido.write(datos);
    pedido.end();
  });
}

const FACTURA = /^lnbcrt[0-9a-z]{20,2000}$/;

function leerCuerpo(req) {
  return new Promise((resolver) => {
    let t = '';
    req.on('data', (c) => { t += c; if (t.length > 8000) req.destroy(); });
    req.on('end', () => resolver(t));
  });
}

function json(res, estado, cuerpo) {
  res.writeHead(estado, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(cuerpo));
}

async function decodificar(factura) {
  const r = await lnd('GET', `/v1/payreq/${factura}`);
  if (r.estado !== 200) return null;
  return { sats: Number(r.json.num_satoshis), descripcion: r.json.description ?? '', expira: Number(r.json.timestamp) + Number(r.json.expiry) };
}

async function apiBilletera(req, res, url) {
  if (url.pathname === '/billetera/api/ver' && req.method === 'GET') {
    const factura = (url.searchParams.get('factura') ?? '').trim().toLowerCase();
    if (!FACTURA.test(factura)) return json(res, 400, { error: 'Esa no es una factura Lightning de prueba (lnbcrt…).' });
    const d = await decodificar(factura);
    if (!d) return json(res, 400, { error: 'No se pudo leer la factura.' });
    return json(res, 200, d);
  }
  if (url.pathname === '/billetera/api/pagar' && req.method === 'POST') {
    let factura = '';
    try { factura = String(JSON.parse(await leerCuerpo(req)).factura ?? '').trim().toLowerCase(); } catch {}
    if (!FACTURA.test(factura)) return json(res, 400, { error: 'Esa no es una factura Lightning de prueba (lnbcrt…).' });
    const d = await decodificar(factura);
    if (!d) return json(res, 400, { error: 'No se pudo leer la factura.' });
    if (!(d.sats > 0) || d.sats > MAXIMO_SATS) return json(res, 400, { error: `La billetera de prueba paga facturas de 1 a ${MAXIMO_SATS} sats.` });
    if (d.expira * 1000 < Date.now()) return json(res, 400, { error: 'La factura ya venció.' });
    // The router streams one JSON line per payment update. The last line holds the final status.
    const r = await lnd('POST', '/v2/router/send', { payment_request: factura, timeout_seconds: 30, fee_limit_sat: 100 });
    const final = r.lineas.at(-1) ?? {};
    const estado = final.result?.status;
    if (estado === 'SUCCEEDED') return json(res, 200, { pagada: true, sats: d.sats });
    if (/already paid/i.test(final.error?.message ?? '')) return json(res, 200, { pagada: true, sats: d.sats });
    return json(res, 502, { error: 'El pago no salió. Probá de nuevo en un momento.' });
  }
  // Receive: the test wallet makes an invoice for an exact amount, so a remittance recipient without a wallet of
  // their own can paste it in Cacao Pay and get paid.
  if (url.pathname === '/billetera/api/recibir' && req.method === 'POST') {
    let sats = 0;
    try { sats = Number(JSON.parse(await leerCuerpo(req)).sats); } catch {}
    if (!Number.isInteger(sats) || sats < 1 || sats > MAXIMO_SATS) {
      return json(res, 400, { error: `La billetera de prueba recibe de 1 a ${MAXIMO_SATS} sats por factura.` });
    }
    const r = await lnd('POST', '/v1/invoices', { value: String(sats), memo: 'Billetera de prueba', expiry: '3600' });
    if (r.estado !== 200 || !r.json.payment_request) return json(res, 502, { error: 'No se pudo crear la factura. Probá de nuevo.' });
    return json(res, 200, { factura: r.json.payment_request, sats, hash: Buffer.from(r.json.r_hash, 'base64').toString('hex') });
  }
  // Whether an invoice made by this wallet was paid, by its payment hash.
  if (url.pathname === '/billetera/api/recibida' && req.method === 'GET') {
    const hash = (url.searchParams.get('hash') ?? '').toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(hash)) return json(res, 400, { error: 'Hash inválido.' });
    const r = await lnd('GET', `/v1/invoice/${hash}`);
    if (r.estado !== 200) return json(res, 404, { error: 'No existe.' });
    return json(res, 200, { pagada: r.json.state === 'SETTLED', sats: Number(r.json.value) });
  }
  return json(res, 404, { error: 'No existe.' });
}

const PAGINA = readFileSync(new URL('./pagina.html', import.meta.url));
const PAGINA_RECIBIR = readFileSync(new URL('./recibir.html', import.meta.url));

function aBtcpay(req, res) {
  const p = http.request(
    { ...BTCPAY, path: req.url, method: req.method, headers: { ...req.headers, 'x-forwarded-proto': 'https', 'x-forwarded-host': req.headers.host ?? '' } },
    (r) => { res.writeHead(r.statusCode ?? 502, r.headers); r.pipe(res); },
  );
  p.on('error', () => { if (!res.headersSent) json(res, 502, { error: 'BTCPay no responde.' }); else res.end(); });
  req.pipe(p);
}

const servidor = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://local');
  try {
    if (url.pathname === '/billetera/recibir' || url.pathname === '/billetera/recibir/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      return res.end(PAGINA_RECIBIR);
    }
    if (url.pathname === '/billetera' || url.pathname === '/billetera/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      return res.end(PAGINA);
    }
    if (url.pathname.startsWith('/billetera/api/')) return await apiBilletera(req, res, url);
    return aBtcpay(req, res);
  } catch {
    if (!res.headersSent) json(res, 500, { error: 'Algo falló. Probá de nuevo.' });
  }
});

// The BTCPay checkout follows the invoice over a WebSocket: pass the upgraded connection through as raw bytes.
servidor.on('upgrade', (req, socket, cabeza) => {
  const destino = net.connect(BTCPAY.port, BTCPAY.host, () => {
    const lineas = [`${req.method} ${req.url} HTTP/1.1`];
    for (let i = 0; i < req.rawHeaders.length; i += 2) lineas.push(`${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}`);
    destino.write(lineas.join('\r\n') + '\r\n\r\n');
    if (cabeza?.length) destino.write(cabeza);
    socket.pipe(destino).pipe(socket);
  });
  destino.on('error', () => socket.destroy());
  socket.on('error', () => destino.destroy());
});

servidor.listen(PUERTO, () => console.log(`puerta en ${PUERTO}`));
