import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The database and BTCPay are replaced: the claim flow is tested through its own rules.
const rpc = vi.hoisted(() => vi.fn());
const desde = vi.hoisted(() => vi.fn());
vi.mock('./supabase', () => ({ clienteServicio: () => ({ rpc, from: desde }) }));

import {
  cobrarEnvio,
  datosDeCobro,
  existeCobro,
  estadoDeCobro,
  hashDeFactura,
  leerFacturaDePago,
  marcarCobroFallido,
  satsDeFactura,
  tokenDeCobroDelDestinatario,
  vencimientoDeFactura,
} from './cobro';

const ALFABETO = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';

// Unix seconds now: an invoice made now is valid for its hour.
const ahoraSeg = () => Math.floor(Date.now() / 1000);

// A BOLT11 invoice with a real-looking structure: prefix and amount, then data with a 'p' tag holding the
// hash. The timestamp is the invoice's creation time (now by default), so it is not expired. The checksum is
// not verified by the code under test, so it is just six characters. The 104 values of the signature come
// before it, as in a real invoice, with `vigencia` in an 'x' tag when given.
function armar(prefijo: string, hashHex = 'ab'.repeat(32), emitida = ahoraSeg(), vigencia?: number): string {
  const valores: number[] = [];
  for (let i = 6; i >= 0; i--) valores.push(Math.floor(emitida / 32 ** i) % 32); // timestamp, 7 values
  valores.push(1, 1, 20); // tag 'p', length 52
  let bits = '';
  for (const byte of Buffer.from(hashHex, 'hex')) bits += byte.toString(2).padStart(8, '0');
  bits = bits.padEnd(260, '0');
  for (let i = 0; i < 260; i += 5) valores.push(parseInt(bits.slice(i, i + 5), 2));
  if (vigencia !== undefined) valores.push(6, 0, 4, Math.floor(vigencia / 32768) % 32, Math.floor(vigencia / 1024) % 32, Math.floor(vigencia / 32) % 32, vigencia % 32);
  return `${prefijo}1${valores.map((v) => ALFABETO[v]).join('')}${ALFABETO[0].repeat(104)}aaaaaa`;
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

describe('vencimientoDeFactura and leerFacturaDePago', () => {
  it('gives the invoice timestamp plus its hour of validity', () => {
    const emitida = 1_800_000_000;
    expect(vencimientoDeFactura(armar('lnbcrt50u', HASH, emitida))).toBe(emitida + 3600);
  });

  it('reads the expiry tag, and stops before the signature', () => {
    const emitida = 1_800_000_000;
    expect(vencimientoDeFactura(armar('lnbcrt50u', HASH, emitida, 86_400))).toBe(emitida + 86_400);
    expect(leerFacturaDePago(armar('lnbcrt50u', HASH, ahoraSeg() - 7200, 86_400)).ok).toBe(true);
  });

  it('accepts an invoice that is still valid', () => {
    const r = leerFacturaDePago(armar('lnbcrt50u', HASH));
    expect(r).toEqual({ ok: true, dato: { factura: armar('lnbcrt50u', HASH), sats: 5000, hash: HASH } });
  });

  it('refuses an expired invoice', () => {
    const r = leerFacturaDePago(armar('lnbcrt50u', HASH, ahoraSeg() - 7200));
    expect(r).toEqual({ ok: false, codigo: 'DATOS_INVALIDOS', mensaje: 'Esa factura ya venció. Pedí otra factura a tu billetera.' });
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

  it('refuses an invoice with no payment hash, without touching the database', async () => {
    const r = await cobrarEnvio(TOKEN, 'lnbcrt50u1qqqqqq');
    expect(r.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('refuses an expired invoice, without touching the database', async () => {
    const r = await cobrarEnvio(TOKEN, armar('lnbcrt50u', HASH, ahoraSeg() - 7200));
    expect(r.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('returns the window sentence when the database refuses a claim after the window', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'COBRO_VENCIDO: El enlace de cobro venció. Quien te mandó el dinero puede recuperarlo.' } });
    const r = await cobrarEnvio(TOKEN, FACTURA);
    expect(r).toEqual({
      ok: false,
      codigo: 'COBRO_VENCIDO',
      mensaje: 'El enlace de cobro venció. Quien te mandó el dinero puede recuperarlo.',
    });
    expect(fetchMock).not.toHaveBeenCalled();
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
    expect(rpc).toHaveBeenNthCalledWith(1, 'pay_iniciar_cobro', {
      p_token: TOKEN,
      p_factura: FACTURA,
      p_sats: 5000,
      p_hash: 'ab'.repeat(32),
    });
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

    // The payer is asked to come back later; the database keeps the claim as "pagando" (only one rpc call).
    expect(r).toEqual({
      ok: false,
      codigo: 'NO_DISPONIBLE',
      mensaje: 'Los pagos están en pausa por unos minutos. Probá de nuevo en un rato.',
    });
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});

// The claim's stored state, as the database returns it to the server.
function filaDeCobro(datos: Record<string, unknown>) {
  const consulta: Record<string, unknown> = {};
  consulta.select = () => consulta;
  consulta.eq = () => consulta;
  consulta.maybeSingle = async () => ({ data: datos, error: null });
  return consulta;
}

function haceMs(milisegundos: number): string {
  return new Date(Date.now() - milisegundos).toISOString();
}

describe('estadoDeCobro and marcarCobroFallido check the payment in BTCPay first', () => {
  const fetchMock = vi.fn();
  const enCurso = {
    codigo: 'CP-2345-ABCD',
    estado: 'procesando',
    entrega: 'lightning',
    monto_destino: 5000,
    cobro_estado: 'pagando',
    cobro_motivo: null,
    cobro_hash: HASH,
    cobrada_en: null,
    remitente: { nombre: 'Marta' },
  };

  beforeEach(() => {
    rpc.mockReset();
    fetchMock.mockReset();
    desde.mockReset();
    rpc.mockResolvedValue({ data: {}, error: null });
    vi.stubEnv('BTCPAY_URL', 'https://btcpay.test');
    vi.stubEnv('BTCPAY_API_KEY', 'clave-de-prueba');
    vi.stubEnv('BTCPAY_STORE_ID', 'TiendaDePrueba123');
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  function conIntento(intentoEn: string) {
    desde.mockImplementation(() => filaDeCobro({ ...enCurso, cobro_factura: FACTURA, cobro_intento_en: intentoEn }));
  }

  function respuesta(estado: number, cuerpo: unknown): Response {
    return new Response(JSON.stringify(cuerpo), { status: estado });
  }

  it('keeps the claim open while BTCPay says Pending', async () => {
    conIntento(haceMs(60_000));
    fetchMock.mockResolvedValueOnce(respuesta(200, { paymentHash: HASH, status: 'Pending' }));

    const r = await estadoDeCobro(TOKEN);

    expect(r).toEqual({ ok: true, dato: { cobroEstado: 'pagando' } });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('keeps the claim open for a payment BTCPay does not know yet, within the waiting time', async () => {
    conIntento(haceMs(60_000));
    fetchMock.mockResolvedValueOnce(respuesta(404, {}));

    const r = await estadoDeCobro(TOKEN);

    expect(r).toEqual({ ok: true, dato: { cobroEstado: 'pagando' } });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('fails a payment BTCPay does not know after the waiting time', async () => {
    conIntento(haceMs(11 * 60 * 1000));
    fetchMock.mockResolvedValueOnce(respuesta(404, {}));

    const r = await estadoDeCobro(TOKEN);

    expect(r).toEqual({ ok: true, dato: { cobroEstado: 'fallido' } });
    expect(rpc).toHaveBeenCalledWith('pay_terminar_cobro', expect.objectContaining({ p_ok: false, p_hash: null }));
  });

  it('marks the claim as paid when BTCPay says Complete, instead of failing it', async () => {
    conIntento(haceMs(60_000));
    fetchMock.mockResolvedValueOnce(respuesta(200, { paymentHash: HASH, status: 'Complete' }));

    const r = await marcarCobroFallido(TOKEN, 'Lo marcamos a mano');

    expect(r).toEqual({ ok: true, dato: { estado: 'pagado', motivo: null } });
    expect(rpc).toHaveBeenCalledWith('pay_terminar_cobro', {
      p_token: TOKEN,
      p_ok: true,
      p_hash: HASH,
      p_motivo: null,
    });
  });

  it('refuses to fail a payment that is still pending in BTCPay', async () => {
    conIntento(haceMs(60_000));
    fetchMock.mockResolvedValueOnce(respuesta(200, { paymentHash: HASH, status: 'Pending' }));

    const r = await marcarCobroFallido(TOKEN, 'Lo marcamos a mano');

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.mensaje).toBe('El pago anterior todavía está en curso en BTCPay; revisalo de nuevo en unos minutos.');
    expect(rpc).not.toHaveBeenCalled();
  });

  it('fails the claim when BTCPay says Failed', async () => {
    conIntento(haceMs(60_000));
    fetchMock.mockResolvedValueOnce(respuesta(200, { paymentHash: HASH, status: 'Failed' }));

    const r = await marcarCobroFallido(TOKEN, 'La factura venció');

    expect(r).toEqual({ ok: true, dato: { estado: 'fallido', motivo: 'La factura venció' } });
    expect(rpc).toHaveBeenCalledWith('pay_terminar_cobro', {
      p_token: TOKEN,
      p_ok: false,
      p_hash: null,
      p_motivo: 'La factura venció',
    });
  });

  it('never fails a claim while BTCPay cannot be asked', async () => {
    conIntento(haceMs(60_000));
    fetchMock.mockRejectedValueOnce(new Error('sin red'));

    const r = await marcarCobroFallido(TOKEN, 'Lo marcamos a mano');

    expect(r.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('fails a payment BTCPay does not know only after the waiting time', async () => {
    conIntento(haceMs(60_000));
    fetchMock.mockResolvedValueOnce(respuesta(404, {}));
    const reciente = await marcarCobroFallido(TOKEN, 'Lo marcamos a mano');
    expect(reciente.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();

    conIntento(haceMs(11 * 60 * 1000));
    fetchMock.mockResolvedValueOnce(respuesta(404, {}));
    const vencido = await marcarCobroFallido(TOKEN, 'Lo marcamos a mano');
    expect(vencido).toEqual({ ok: true, dato: { estado: 'fallido', motivo: 'Lo marcamos a mano' } });
  });
});

describe('tokenDeCobroDelDestinatario: the claim link reaches only the recipient, while the claim is open', () => {
  const ENVIO = '22222222-2222-4222-8222-222222222222';
  const RECIPIENTE = '44444444-4444-4444-8444-444444444444';
  const abierto = {
    cobro_token: TOKEN,
    cobro_estado: null,
    entrega: 'lightning',
    estado: 'procesando',
    destinatario_id: RECIPIENTE,
  };

  beforeEach(() => desde.mockReset());

  it('gives the token to the recipient of a paid Lightning transfer that is not yet collected', async () => {
    desde.mockImplementation(() => filaDeCobro(abierto));
    expect(await tokenDeCobroDelDestinatario(ENVIO, RECIPIENTE)).toBe(TOKEN);
  });

  it('gives nothing to anyone else, even when the transfer is claimable', async () => {
    desde.mockImplementation(() => filaDeCobro(abierto));
    expect(await tokenDeCobroDelDestinatario(ENVIO, '55555555-5555-4555-8555-555555555555')).toBeNull();
  });

  it('gives nothing once the claim is paid or being paid, and gives it again after a failed claim', async () => {
    desde.mockImplementation(() => filaDeCobro({ ...abierto, cobro_estado: 'pagado' }));
    expect(await tokenDeCobroDelDestinatario(ENVIO, RECIPIENTE)).toBeNull();
    desde.mockImplementation(() => filaDeCobro({ ...abierto, cobro_estado: 'pagando' }));
    expect(await tokenDeCobroDelDestinatario(ENVIO, RECIPIENTE)).toBeNull();
    desde.mockImplementation(() => filaDeCobro({ ...abierto, cobro_estado: 'fallido' }));
    expect(await tokenDeCobroDelDestinatario(ENVIO, RECIPIENTE)).toBe(TOKEN);
  });

  it('gives nothing for a transfer that is not Lightning or not yet paid', async () => {
    desde.mockImplementation(() => filaDeCobro({ ...abierto, entrega: 'cuenta' }));
    expect(await tokenDeCobroDelDestinatario(ENVIO, RECIPIENTE)).toBeNull();
    desde.mockImplementation(() => filaDeCobro({ ...abierto, estado: 'creada' }));
    expect(await tokenDeCobroDelDestinatario(ENVIO, RECIPIENTE)).toBeNull();
  });

  it('gives nothing once the claim window has closed', async () => {
    desde.mockImplementation(() => filaDeCobro({ ...abierto, cobro_vence_en: haceMs(60_000) }));
    expect(await tokenDeCobroDelDestinatario(ENVIO, RECIPIENTE)).toBeNull();
    desde.mockImplementation(() => filaDeCobro({ ...abierto, cobro_vence_en: haceMs(-60_000) }));
    expect(await tokenDeCobroDelDestinatario(ENVIO, RECIPIENTE)).toBe(TOKEN);
  });
});

describe('datosDeCobro: the claim page knows when the window has closed', () => {
  const datos = {
    codigo: 'CP-2345-ABCD',
    estado: 'procesando',
    entrega: 'lightning',
    monto_destino: 5000,
    cobro_estado: null,
    cobro_motivo: null,
    cobro_hash: null,
    cobrada_en: null,
    cobro_vence_en: null,
    remitente: { nombre: 'Marta Lopez' },
  };

  beforeEach(() => desde.mockReset());

  it('reports the window closed once its end has passed', async () => {
    desde.mockImplementation(() => filaDeCobro({ ...datos, cobro_vence_en: haceMs(60_000) }));
    const r = await datosDeCobro(TOKEN);
    expect(r?.vencido).toBe(true);
    expect(r?.remitenteNombre).toBe('Marta');
  });

  it('reports the window open before its end', async () => {
    desde.mockImplementation(() => filaDeCobro({ ...datos, cobro_vence_en: haceMs(-60_000) }));
    expect((await datosDeCobro(TOKEN))?.vencido).toBe(false);
  });
});

describe('existeCobro', () => {
  beforeEach(() => desde.mockReset());

  it('says yes for a Lightning transfer with this token, and asks nothing for a malformed one', async () => {
    desde.mockImplementation(() => filaDeCobro({ id: 'x' }));
    expect(await existeCobro(TOKEN)).toBe(true);
    desde.mockClear();
    expect(await existeCobro('corto')).toBe(false);
    expect(desde).not.toHaveBeenCalled();
  });

  it('says no for a token nobody has', async () => {
    desde.mockImplementation(() => filaDeCobro(null as unknown as Record<string, unknown>));
    expect(await existeCobro(TOKEN)).toBe(false);
  });
});
