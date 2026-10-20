import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The database, the BTC price and BTCPay are replaced. The rules of the transfer functions are what is tested.
const { rpc, tablas, cotizacionUsdBtc, consultaDe } = vi.hoisted(() => {
  const tablas: Record<string, unknown> = {};
  // A query of the database: any chain of filters ends in maybeSingle (one row) or is awaited (a list).
  const consultaDe = (nombre: string) => {
    const consulta: Record<string, unknown> = {};
    for (const metodo of ['select', 'eq', 'in', 'or', 'order', 'range']) consulta[metodo] = () => consulta;
    consulta.maybeSingle = async () => ({ data: tablas[nombre] ?? null, error: null });
    consulta.then = (ok: (valor: unknown) => unknown, ko?: (error: unknown) => unknown) =>
      Promise.resolve({ data: tablas[nombre] ?? [], error: null }).then(ok, ko);
    return consulta;
  };
  return { rpc: vi.fn(), tablas, cotizacionUsdBtc: vi.fn(), consultaDe };
});

vi.mock('./supabase', () => ({ clienteServicio: () => ({ rpc, from: consultaDe }) }));
vi.mock('@/lib/precio/fuente', () => ({ cotizacionUsdBtc }));

import { cancelarEnvio, pagarEnvio, procesarEnvio, simularFallar } from './transferencias';

const USUARIO = '11111111-1111-4111-8111-111111111111';
const ADMIN = '33333333-3333-4333-8333-333333333333';
const ENVIO = '22222222-2222-4222-8222-222222222222';
const TIENDA = 'TiendaDePrueba123';
const FACTURA_ANTERIOR = 'FacturaAnterior01';
const FACTURA_NUEVA = 'FacturaNueva0001';
const BOLT11_NUEVA = 'lnbcrt1000n1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq';
const USD_BTC = 100_000;

const hace = (milisegundos: number) => new Date(Date.now() - milisegundos).toISOString();
const ayer = () => hace(24 * 60 * 60 * 1000);

// The transfer as the database holds it, with a quote made just now and no invoice.
function envio(extra: Record<string, unknown> = {}) {
  return {
    id: ENVIO,
    codigo: 'CP-2345-ABCD',
    remitente_id: USUARIO,
    estado: 'creada',
    moneda_origen: 'USD',
    monto_origen_centavos: 10_000,
    comision_centavos: 50,
    neto_centavos: 9_950,
    tasa: USD_BTC,
    tasa_fuente: 'Precio de bitcoin: Coinbase y Kraken',
    moneda_destino: 'SATS',
    monto_destino: 99_500,
    entrega: 'lightning',
    destinatario_nombre: 'Ana',
    destinatario_contacto: '+503 7000 0002',
    destinatario_id: null,
    nota: '',
    creada_en: hace(60_000),
    procesando_en: null,
    completada_en: null,
    fallida_en: null,
    cancelada_en: null,
    motivo: null,
    pagada_en: null,
    factura_expira: null,
    pago_tardio_en: null,
    cotizada_en: hace(60_000),
    btcpay_factura_id: null,
    btcpay_tienda_id: null,
    factura: null,
    factura_sats: null,
    factura_usd_centavos: null,
    remitente: { nombre: 'Marta' },
    ...extra,
  };
}

// BTCPay as the server reads it: one invoice that is already known, and one new invoice when asked for.
function respuesta(estado: number, cuerpo: unknown): Response {
  return new Response(JSON.stringify(cuerpo), { status: estado });
}

function facturaApi(id: string, estado: string) {
  return {
    id,
    storeId: TIENDA,
    status: estado,
    amount: '100000',
    expirationTime: Math.floor(Date.now() / 1000) + 900,
    metadata: {},
  };
}

const fetchMock = vi.fn();

function btcpayCon(previa: 'Settled' | 'Processing' | 'New' | 'no-existe' | 'caido') {
  fetchMock.mockImplementation(async (url: string, opciones?: { method?: string }) => {
    const ruta = url.replace('https://btcpay.test', '');
    if (previa === 'caido') throw new Error('sin red');
    if (opciones?.method === 'POST' && ruta === `/api/v1/stores/${TIENDA}/invoices`) {
      return respuesta(200, facturaApi(FACTURA_NUEVA, 'New'));
    }
    if (ruta === `/api/v1/stores/${TIENDA}/invoices/${FACTURA_NUEVA}/payment-methods`) {
      return respuesta(200, [{ paymentMethodId: 'BTC-LN', destination: BOLT11_NUEVA, payments: [] }]);
    }
    if (ruta === `/api/v1/stores/${TIENDA}/invoices/${FACTURA_ANTERIOR}/payment-methods`) {
      return respuesta(200, [{ paymentMethodId: 'BTC-LN', destination: 'lnbcrt1', payments: [] }]);
    }
    if (ruta === `/api/v1/stores/${TIENDA}/invoices/${FACTURA_ANTERIOR}`) {
      if (previa === 'no-existe') return respuesta(404, {});
      return respuesta(200, facturaApi(FACTURA_ANTERIOR, previa));
    }
    return respuesta(404, {});
  });
}

function llamadas(nombre: string) {
  return rpc.mock.calls.filter(([n]) => n === nombre);
}

beforeEach(() => {
  for (const clave of Object.keys(tablas)) delete tablas[clave];
  tablas.pay_tarifas = [
    { entrega: 'lightning', fijo_centavos: 0, porcentaje_bps: 50, minutos_estimados: 1, descripcion: 'Lightning' },
    { entrega: 'cuenta', fijo_centavos: 99, porcentaje_bps: 100, minutos_estimados: 60, descripcion: 'Cuenta' },
    { entrega: 'efectivo', fijo_centavos: 199, porcentaje_bps: 150, minutos_estimados: 30, descripcion: 'Efectivo' },
  ];
  tablas.pay_tasas = { tasa: 1.08, fuente: 'Tasa fija de demostración', actualizada_en: ayer() };
  rpc.mockReset();
  rpc.mockResolvedValue({ data: {}, error: null });
  cotizacionUsdBtc.mockReset();
  cotizacionUsdBtc.mockResolvedValue(USD_BTC);
  fetchMock.mockReset();
  vi.stubEnv('BTCPAY_URL', 'https://btcpay.test');
  vi.stubEnv('BTCPAY_API_KEY', 'clave-de-prueba');
  vi.stubEnv('BTCPAY_STORE_ID', TIENDA);
  vi.stubEnv('NEXT_PUBLIC_DEMO', '1');
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('pagarEnvio', () => {
  it('issues the invoice for the quote as it stands when the quote is fresh', async () => {
    tablas.pay_transferencias = envio();
    btcpayCon('no-existe');

    const r = await pagarEnvio(USUARIO, ENVIO);

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.dato.sats).toBe(100_000);
    expect(r.dato.montoDestinoActualizado).toBeUndefined();
    expect(llamadas('pay_recotizar')).toHaveLength(0);
    expect(llamadas('pay_registrar_factura')[0][1]).toMatchObject({ p_sats: 100_000, p_factura_id: FACTURA_NUEVA });
  });

  it('quotes again a stale quote before the invoice, at the same BTC price', async () => {
    tablas.pay_transferencias = envio({ cotizada_en: hace(10 * 60 * 1000), monto_destino: 90_000 });
    btcpayCon('no-existe');

    const r = await pagarEnvio(USUARIO, ENVIO);

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(llamadas('pay_recotizar')[0][1]).toMatchObject({
      p_transferencia: ENVIO,
      p_actor: USUARIO,
      p_comision: 50,
      p_monto_destino: 99_500,
    });
    expect(r.dato.montoDestinoActualizado).toBe(99_500);
    expect(r.dato.sats).toBe(100_000);
    expect(llamadas('pay_registrar_factura')[0][1]).toMatchObject({ p_sats: 100_000 });
  });

  it('confirms the invoice before that was already paid, and issues no new one', async () => {
    tablas.pay_transferencias = envio({
      btcpay_factura_id: FACTURA_ANTERIOR,
      btcpay_tienda_id: TIENDA,
      factura_expira: hace(60_000),
    });
    btcpayCon('Settled');

    const r = await pagarEnvio(USUARIO, ENVIO);

    expect(r.ok).toBe(false);
    expect(llamadas('pay_confirmar_btcpay')[0][1]).toEqual({ p_factura_id: FACTURA_ANTERIOR });
    expect(fetchMock.mock.calls.some(([, o]) => o?.method === 'POST')).toBe(false);
  });

  it('refuses a new invoice while the one before is still being paid', async () => {
    tablas.pay_transferencias = envio({
      btcpay_factura_id: FACTURA_ANTERIOR,
      btcpay_tienda_id: TIENDA,
      factura_expira: hace(60_000),
    });
    btcpayCon('Processing');

    const r = await pagarEnvio(USUARIO, ENVIO);

    expect(r).toMatchObject({ ok: false, codigo: 'ESTADO_INVALIDO' });
    expect(fetchMock.mock.calls.some(([, o]) => o?.method === 'POST')).toBe(false);
    expect(llamadas('pay_registrar_factura')).toHaveLength(0);
  });
});

describe('cancelarEnvio', () => {
  it('confirms an invoice BTCPay says was paid, and refuses the cancel', async () => {
    tablas.pay_transferencias = envio({
      btcpay_factura_id: FACTURA_ANTERIOR,
      btcpay_tienda_id: TIENDA,
      factura_expira: ayer(),
    });
    btcpayCon('Settled');

    const r = await cancelarEnvio(USUARIO, ENVIO);

    expect(r).toMatchObject({ ok: false, codigo: 'ESTADO_INVALIDO' });
    expect(llamadas('pay_confirmar_btcpay')).toHaveLength(1);
    expect(llamadas('pay_cancelar')).toHaveLength(0);
  });

  it('cancels when BTCPay says the invoice is still open', async () => {
    tablas.pay_transferencias = envio({
      btcpay_factura_id: FACTURA_ANTERIOR,
      btcpay_tienda_id: TIENDA,
      factura_expira: ayer(),
    });
    btcpayCon('New');

    const r = await cancelarEnvio(USUARIO, ENVIO);

    expect(r.ok).toBe(true);
    expect(llamadas('pay_cancelar')).toHaveLength(1);
  });

  it('does not cancel when BTCPay cannot be asked', async () => {
    tablas.pay_transferencias = envio({
      btcpay_factura_id: FACTURA_ANTERIOR,
      btcpay_tienda_id: TIENDA,
      factura_expira: ayer(),
    });
    btcpayCon('caido');

    const r = await cancelarEnvio(USUARIO, ENVIO);

    expect(r).toMatchObject({ ok: false, codigo: 'BTCPAY' });
    expect(llamadas('pay_cancelar')).toHaveLength(0);
  });
});

describe('procesar y fallar un envío por Lightning', () => {
  it('never starts a Lightning transfer by hand, not even as an administrator', async () => {
    tablas.pay_transferencias = envio();
    tablas.usuarios = { es_admin: true };

    const r = await procesarEnvio(ADMIN, ENVIO);

    expect(r).toMatchObject({ ok: false, codigo: 'NO_PERMITIDO' });
    expect(llamadas('pay_procesar')).toHaveLength(0);
  });

  it('refuses to fail a Lightning transfer that is already paid', async () => {
    tablas.pay_transferencias = envio({ estado: 'procesando', pagada_en: hace(60_000) });

    const r = await simularFallar({ id: USUARIO, esAdmin: false }, ENVIO, 'Motivo de prueba');

    expect(r).toMatchObject({ ok: false, codigo: 'ESTADO_INVALIDO' });
    expect(llamadas('pay_fallar')).toHaveLength(0);
  });
});
