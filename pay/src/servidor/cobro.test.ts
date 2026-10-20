import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The database and BTCPay are replaced: the claim flow is tested through its own rules.
const rpc = vi.hoisted(() => vi.fn());
vi.mock('./supabase', () => ({ clienteServicio: () => ({ rpc }) }));

import { cobrarEnvio, hashDeFactura, satsDeFactura } from './cobro';

const ALFABETO = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';

// A BOLT11 invoice with a real-looking structure: prefix and amount, then data with a 'p' tag holding the
// hash. The checksum is not verified by the code under test, so it is just six characters.
function armar(prefijo: string, hashHex = 'ab'.repeat(32)): string {
  const valores: number[] = [0, 0, 0, 0, 0, 0, 0]; // timestamp
  valores.push(1, 1, 20); // tag 'p', length 52
  let bits = '';
  for (const byte of Buffer.from(hashHex, 'hex')) bits += byte.toString(2).padStart(8, '0');
  bits = bits.padEnd(260, '0');
  for (let i = 0; i < 260; i += 5) valores.push(parseInt(bits.slice(i, i + 5), 2));
  return `${prefijo}1${valores.map((v) => ALFABETO[v]).join('')}aaaaaa`;
}

const TOKEN = 'a'.repeat(43);
const HASH = 'cd'.repeat(32);
const FACTURA = armar('lnbcrt50u');

describe('satsDeFactura', () => {
  it('reads the amount of regtest invoices', () => {
    expect(satsDeFactura('lnbcrt50u1pvjluezpp5qqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqypqdq5xysxxatsyp3k7enxv4jsxqzpu')).toBe(5000);
    expect(satsDeFactura(FACTURA)).toBe(5000);
    expect(satsDeFactura(armar('lnbcrt1200n'))).toBe(120);
    expect(satsDeFactura(armar('lnbcrt600u'))).toBe(60000);
  });

  it('reads the other networks and multipliers', () => {
    expect(satsDeFactura(armar('lnbc2m'))).toBe(200_000);
    expect(satsDeFactura(armar('lntb3m'))).toBe(300_000);
    expect(satsDeFactura(armar('lntbs1m'))).toBe(100_000);
    expect(satsDeFactura(armar('lnbcrt10000p'))).toBe(1);
  });

  it('refuses an invoice with no amount', () => {
    expect(satsDeFactura(armar('lnbc'))).toBeNull();
    expect(satsDeFactura(armar('lnbcrt'))).toBeNull();
  });

  it('refuses an amount that is not a whole number of sats', () => {
    expect(satsDeFactura(armar('lnbcrt1n'))).toBeNull(); // 0.1 sat
    expect(satsDeFactura(armar('lnbcrt10p'))).toBeNull(); // 0.001 sat
  });

  it('refuses text that is not a Lightning invoice', () => {
    expect(satsDeFactura('bitcoin:bc1qexample')).toBeNull();
    expect(satsDeFactura('')).toBeNull();
  });
});

describe('hashDeFactura', () => {
  it('reads the payment hash from the p tag', () => {
    expect(hashDeFactura(armar('lnbcrt50u', HASH))).toBe(HASH);
  });

  it('returns null for text with no hash tag', () => {
    expect(hashDeFactura('lnbcrt50u1qqqqqq')).toBeNull();
  });
});

describe('cobrarEnvio', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    rpc.mockReset();
    fetchMock.mockReset();
    vi.stubEnv('BTCPAY_URL', 'https://btcpay.test');
    vi.stubEnv('BTCPAY_API_KEY', 'clave-de-prueba');
    vi.stubEnv('BTCPAY_STORE_ID', 'TiendaDePrueba123');
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  function respuesta(estado: number, cuerpo: unknown): Response {
    return new Response(JSON.stringify(cuerpo), { status: estado });
  }

  it('refuses an unknown token shape without touching the database', async () => {
    const r = await cobrarEnvio('corto', FACTURA);
    expect(r.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('refuses an invoice without a fixed amount without touching the database', async () => {
    const r = await cobrarEnvio(TOKEN, armar('lnbc'));
    expect(r.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('reports BTCPay as not set up before it marks the transfer', async () => {
    vi.stubEnv('BTCPAY_URL', '');
    const r = await cobrarEnvio(TOKEN, FACTURA);
    expect(r.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('returns the database sentence when the claim cannot start', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'ESTADO_INVALIDO: Ya hay un cobro en curso.' } });
    const r = await cobrarEnvio(TOKEN, FACTURA);
    expect(r).toEqual({ ok: false, codigo: 'ESTADO_INVALIDO', mensaje: 'Ya hay un cobro en curso.' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('pays the invoice and completes the transfer when BTCPay says Complete', async () => {
    rpc.mockResolvedValueOnce({ data: {}, error: null });
    rpc.mockResolvedValueOnce({ data: {}, error: null });
    fetchMock.mockResolvedValueOnce(respuesta(200, { paymentHash: HASH, status: 'Complete' }));

    const r = await cobrarEnvio(`${TOKEN}`, `  ${FACTURA.toUpperCase()}  `);

    expect(r).toEqual({ ok: true, dato: { estado: 'pagado', motivo: null } });
    expect(rpc).toHaveBeenNthCalledWith(1, 'pay_iniciar_cobro', { p_token: TOKEN, p_factura: FACTURA, p_sats: 5000 });
    expect(rpc).toHaveBeenNthCalledWith(2, 'pay_terminar_cobro', {
      p_token: TOKEN,
      p_ok: true,
      p_hash: HASH,
      p_motivo: null,
    });
    const [url, opciones] = fetchMock.mock.calls[0];
    expect(url).toBe('https://btcpay.test/api/v1/stores/TiendaDePrueba123/lightning/BTC/invoices/pay');
    expect(opciones.headers.authorization).toBe('token clave-de-prueba');
    expect(JSON.parse(opciones.body)).toEqual({ BOLT11: FACTURA });
  });

  it('records a failed payment with a sentence for the recipient', async () => {
    rpc.mockResolvedValueOnce({ data: {}, error: null });
    rpc.mockResolvedValueOnce({ data: {}, error: null });
    fetchMock.mockResolvedValueOnce(respuesta(422, { code: 'could-not-find-route', message: 'no route' }));

    const r = await cobrarEnvio(TOKEN, FACTURA);

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.dato.estado).toBe('fallido');
    expect(r.dato.motivo).toMatch(/ruta Lightning/);
    expect(rpc).toHaveBeenNthCalledWith(2, 'pay_terminar_cobro', expect.objectContaining({ p_ok: false, p_hash: null }));
  });

  it('keeps the claim open while BTCPay says Pending', async () => {
    rpc.mockResolvedValueOnce({ data: {}, error: null });
    fetchMock.mockResolvedValueOnce(respuesta(200, { paymentHash: HASH, status: 'Pending' }));

    const r = await cobrarEnvio(TOKEN, FACTURA);

    expect(r).toEqual({ ok: true, dato: { estado: 'pendiente', motivo: null } });
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it('keeps the claim open when BTCPay does not answer, so no second invoice is paid', async () => {
    rpc.mockResolvedValueOnce({ data: {}, error: null });
    fetchMock.mockRejectedValueOnce(new Error('sin red'));

    const r = await cobrarEnvio(TOKEN, FACTURA);

    expect(r).toEqual({ ok: true, dato: { estado: 'pendiente', motivo: null } });
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});
