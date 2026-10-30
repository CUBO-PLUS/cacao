import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The database and BTCPay are replaced: the refund is tested through its own rules, as the claim is.
const rpc = vi.hoisted(() => vi.fn());
const desde = vi.hoisted(() => vi.fn());
vi.mock('./supabase', () => ({ clienteServicio: () => ({ rpc, from: desde }) }));

import { devolverEnvio, estadoDeDevolucion } from './devolucion';

const ALFABETO = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
const ahoraSeg = () => Math.floor(Date.now() / 1000);

// Same shape as the claim tests: a BOLT11 invoice with the amount, its timestamp and a 'p' tag holding the hash.
function armar(prefijo: string, hashHex = 'ab'.repeat(32), emitida = ahoraSeg()): string {
  const valores: number[] = [];
  for (let i = 6; i >= 0; i--) valores.push(Math.floor(emitida / 32 ** i) % 32);
  valores.push(1, 1, 20);
  let bits = '';
  for (const byte of Buffer.from(hashHex, 'hex')) bits += byte.toString(2).padStart(8, '0');
  bits = bits.padEnd(260, '0');
  for (let i = 0; i < 260; i += 5) valores.push(parseInt(bits.slice(i, i + 5), 2));
  return `${prefijo}1${valores.map((v) => ALFABETO[v]).join('')}${ALFABETO[0].repeat(104)}aaaaaa`;
}

const ENVIO = '22222222-2222-4222-8222-222222222222';
const REMITENTE = '33333333-3333-4333-8333-333333333333';
const OTRA_PERSONA = '55555555-5555-4555-8555-555555555555';
const HASH = 'cd'.repeat(32);
const FACTURA = armar('lnbcrt50u');

// The transfer's stored state, as the database returns it to the server.
function fila(datos: Record<string, unknown>) {
  const consulta: Record<string, unknown> = {};
  consulta.select = () => consulta;
  consulta.eq = () => consulta;
  consulta.maybeSingle = async () => ({ data: { id: ENVIO, remitente_id: REMITENTE, ...datos }, error: null });
  return consulta;
}

function haceMs(milisegundos: number): string {
  return new Date(Date.now() - milisegundos).toISOString();
}

function respuesta(estado: number, cuerpo: unknown): Response {
  return new Response(JSON.stringify(cuerpo), { status: estado });
}

describe('devolverEnvio: the sender takes the money back, once, through BTCPay', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    rpc.mockReset();
    desde.mockReset();
    fetchMock.mockReset();
    rpc.mockResolvedValue({ data: {}, error: null });
    desde.mockImplementation(() => fila({ cobro_estado: null, cobro_token: null, devolucion_estado: null }));
    vi.stubEnv('BTCPAY_URL', 'https://btcpay.test');
    vi.stubEnv('BTCPAY_API_KEY', 'clave-de-prueba');
    vi.stubEnv('BTCPAY_STORE_ID', 'TiendaDePrueba123');
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('refuses anyone who did not send the transfer, with the same answer as a missing one', async () => {
    desde.mockImplementation(() => fila({}));
    const r = await devolverEnvio(OTRA_PERSONA, ENVIO, FACTURA);
    expect(r).toEqual({ ok: false, codigo: 'NO_ENCONTRADA', mensaje: 'No encontramos esa transferencia.' });
    expect(rpc).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses an expired invoice without touching the database', async () => {
    const r = await devolverEnvio(REMITENTE, ENVIO, armar('lnbcrt50u', HASH, ahoraSeg() - 7200));
    expect(r.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('reserves the transfer for the sats paid, pays the invoice and records Complete', async () => {
    rpc.mockResolvedValueOnce({ data: {}, error: null });
    rpc.mockResolvedValueOnce({ data: {}, error: null });
    fetchMock.mockResolvedValueOnce(respuesta(200, { paymentHash: HASH, status: 'Complete' }));

    const r = await devolverEnvio(REMITENTE, ENVIO, FACTURA);

    expect(r).toEqual({ ok: true, dato: { estado: 'pagado', motivo: null } });
    expect(rpc).toHaveBeenNthCalledWith(1, 'pay_iniciar_devolucion', {
      p_transferencia: ENVIO,
      p_actor: REMITENTE,
      p_factura: FACTURA,
      p_sats: 5000,
      p_hash: 'ab'.repeat(32),
    });
    expect(rpc).toHaveBeenNthCalledWith(2, 'pay_terminar_devolucion', {
      p_transferencia: ENVIO,
      p_ok: true,
      p_hash: HASH,
      p_motivo: null,
    });
    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe('https://btcpay.test/api/v1/stores/TiendaDePrueba123/lightning/BTC/invoices/pay');
  });

  it('records a refused payment as failed, so the sender can try another invoice', async () => {
    rpc.mockResolvedValueOnce({ data: {}, error: null });
    rpc.mockResolvedValueOnce({ data: {}, error: null });
    fetchMock.mockResolvedValueOnce(respuesta(422, { code: 'could-not-find-route' }));

    const r = await devolverEnvio(REMITENTE, ENVIO, FACTURA);

    expect(r.ok).toBe(true);
    expect(rpc).toHaveBeenNthCalledWith(2, 'pay_terminar_devolucion', expect.objectContaining({ p_ok: false, p_hash: null }));
  });

  it('keeps the transfer reserved when BTCPay does not answer, so no second refund is paid', async () => {
    rpc.mockResolvedValueOnce({ data: {}, error: null });
    fetchMock.mockRejectedValueOnce(new Error('sin red'));

    const r = await devolverEnvio(REMITENTE, ENVIO, FACTURA);

    // The sender is asked to come back later, and nothing closes the refund: only the reservation was made.
    expect(r).toEqual({
      ok: false,
      codigo: 'NO_DISPONIBLE',
      mensaje: 'Los pagos están en pausa por unos minutos. Probá de nuevo en un rato.',
    });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('pay_iniciar_devolucion', expect.any(Object));
  });

  it('returns the database sentence when the refund is refused, and never calls BTCPay', async () => {
    rpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'PLAZO_VIGENTE: Todavía se puede cobrar este envío. Vas a poder recuperar el dinero cuando venza el plazo.' },
    });
    const r = await devolverEnvio(REMITENTE, ENVIO, FACTURA);
    expect(r).toEqual({
      ok: false,
      codigo: 'PLAZO_VIGENTE',
      mensaje: 'Todavía se puede cobrar este envío. Vas a poder recuperar el dinero cuando venza el plazo.',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('estadoDeDevolucion: a refund that is being paid is settled with BTCPay, never guessed', () => {
  const fetchMock = vi.fn();
  const enCurso = { devolucion_estado: 'pagando', devolucion_factura: FACTURA, devolucion_hash: HASH, devolucion_intento_en: haceMs(60_000) };

  beforeEach(() => {
    rpc.mockReset();
    desde.mockReset();
    fetchMock.mockReset();
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

  it('answers nobody but the sender', async () => {
    desde.mockImplementation(() => fila({ ...enCurso, remitente_id: OTRA_PERSONA }));
    expect(await estadoDeDevolucion(REMITENTE, ENVIO)).toEqual({
      ok: false,
      codigo: 'NO_ENCONTRADA',
      mensaje: 'No encontramos esa transferencia.',
    });
  });

  it('reports a refund that is not pending as it is, without asking BTCPay', async () => {
    desde.mockImplementation(() => fila({ devolucion_estado: 'pagado' }));
    expect(await estadoDeDevolucion(REMITENTE, ENVIO)).toEqual({ ok: true, dato: { devolucion: 'pagado' } });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('stays pending while BTCPay says Pending', async () => {
    desde.mockImplementation(() => fila(enCurso));
    fetchMock.mockResolvedValueOnce(respuesta(200, { paymentHash: HASH, status: 'Pending' }));
    expect(await estadoDeDevolucion(REMITENTE, ENVIO)).toEqual({ ok: true, dato: { devolucion: 'pagando' } });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('stays pending for a payment BTCPay does not know yet, within the waiting time', async () => {
    desde.mockImplementation(() => fila(enCurso));
    fetchMock.mockResolvedValueOnce(respuesta(404, {}));
    expect(await estadoDeDevolucion(REMITENTE, ENVIO)).toEqual({ ok: true, dato: { devolucion: 'pagando' } });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('fails a payment BTCPay does not know after the waiting time, so the sender can try again', async () => {
    desde.mockImplementation(() => fila({ ...enCurso, devolucion_intento_en: haceMs(11 * 60_000) }));
    fetchMock.mockResolvedValueOnce(respuesta(404, {}));
    expect(await estadoDeDevolucion(REMITENTE, ENVIO)).toEqual({ ok: true, dato: { devolucion: 'fallido' } });
    expect(rpc).toHaveBeenCalledWith('pay_terminar_devolucion', expect.objectContaining({ p_ok: false }));
  });

  it('completes the refund when BTCPay says Complete on a later check', async () => {
    desde.mockImplementation(() => fila(enCurso));
    fetchMock.mockResolvedValueOnce(respuesta(200, { paymentHash: HASH, status: 'Complete' }));
    expect(await estadoDeDevolucion(REMITENTE, ENVIO)).toEqual({ ok: true, dato: { devolucion: 'pagado' } });
    expect(rpc).toHaveBeenCalledWith('pay_terminar_devolucion', { p_transferencia: ENVIO, p_ok: true, p_hash: HASH, p_motivo: null });
  });

  it('leaves the refund pending when BTCPay cannot be asked', async () => {
    desde.mockImplementation(() => fila(enCurso));
    fetchMock.mockRejectedValueOnce(new Error('sin red'));
    expect(await estadoDeDevolucion(REMITENTE, ENVIO)).toEqual({ ok: true, dato: { devolucion: 'pagando' } });
    expect(rpc).not.toHaveBeenCalled();
  });
});
