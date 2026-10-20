import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { confirmarPagoBtcpay } = vi.hoisted(() => ({
  confirmarPagoBtcpay: vi.fn(async () => ({ ok: true as const, dato: { id: 'envio-1', estado: 'procesando' as const } })),
}));

vi.mock('@/servidor/transferencias', () => ({ confirmarPagoBtcpay }));

import { POST } from './route';

const SECRETO = 'secreto-de-prueba';
const TIENDA = 'TiendaDePrueba123';
const FACTURA = 'FacturaPrueba01';

function cuerpoDe(tipo: string, tienda = TIENDA): string {
  return JSON.stringify({ type: tipo, invoiceId: FACTURA, storeId: tienda });
}

function peticion(cuerpo: string, firma: string | null): Request {
  const cabeceras: Record<string, string> = {};
  if (firma !== null) cabeceras['btcpay-sig'] = firma;
  return new Request('https://pay.example.test/api/pagos/btcpay/', { method: 'POST', body: cuerpo, headers: cabeceras });
}

const firmar = (cuerpo: string, secreto = SECRETO) =>
  'sha256=' + createHmac('sha256', secreto).update(cuerpo, 'utf8').digest('hex');

// BTCPay answers for the invoice; the test controls its state.
function btcpayDice(estado: string) {
  const llamadas: string[] = [];
  vi.stubGlobal('fetch', async (entrada: RequestInfo | URL) => {
    const url = String(entrada);
    llamadas.push(url);
    if (url.endsWith('/payment-methods')) return new Response('[]', { status: 200 });
    return new Response(
      JSON.stringify({ id: FACTURA, storeId: TIENDA, status: estado, amount: '1000', expirationTime: 4102444800, metadata: {} }),
      { status: 200 },
    );
  });
  return llamadas;
}

describe('POST /api/pagos/btcpay', () => {
  const entornoAnterior = { ...process.env };

  beforeEach(() => {
    process.env.BTCPAY_URL = 'https://btcpay.example.test';
    process.env.BTCPAY_API_KEY = 'clave-de-prueba';
    process.env.BTCPAY_STORE_ID = TIENDA;
    process.env.BTCPAY_WEBHOOK_SECRET = SECRETO;
    confirmarPagoBtcpay.mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    process.env = { ...entornoAnterior };
  });

  it('refuses a body without a valid signature, and never asks BTCPay', async () => {
    const cuerpo = cuerpoDe('InvoiceSettled');
    const respuesta = await POST(peticion(cuerpo, firmar(cuerpo, 'otro')));
    expect(respuesta.status).toBe(401);
    expect(confirmarPagoBtcpay).not.toHaveBeenCalled();
  });

  it('refuses a request with no signature at all', async () => {
    const respuesta = await POST(peticion(cuerpoDe('InvoiceSettled'), null));
    expect(respuesta.status).toBe(401);
  });

  it('moves the transfer on only when BTCPay says the invoice is Settled', async () => {
    const llamadas = btcpayDice('Settled');
    const cuerpo = cuerpoDe('InvoiceSettled');
    const respuesta = await POST(peticion(cuerpo, firmar(cuerpo)));
    expect(respuesta.status).toBe(200);
    expect(llamadas.some((u) => u.includes(`/invoices/${FACTURA}`))).toBe(true);
    expect(confirmarPagoBtcpay).toHaveBeenCalledWith(FACTURA);
  });

  it('does not move the transfer when the webhook says paid but BTCPay does not', async () => {
    btcpayDice('New');
    const cuerpo = cuerpoDe('InvoiceSettled');
    const respuesta = await POST(peticion(cuerpo, firmar(cuerpo)));
    expect(respuesta.status).toBe(200);
    expect(confirmarPagoBtcpay).not.toHaveBeenCalled();
  });

  it('ignores other stores and other events', async () => {
    const llamadas = btcpayDice('Settled');
    const otra = cuerpoDe('InvoiceSettled', 'OtraTienda4567');
    expect((await POST(peticion(otra, firmar(otra)))).status).toBe(200);
    const otroEvento = cuerpoDe('InvoicePaymentSettled');
    expect((await POST(peticion(otroEvento, firmar(otroEvento)))).status).toBe(200);
    expect(llamadas).toHaveLength(0);
    expect(confirmarPagoBtcpay).not.toHaveBeenCalled();
  });

  it('asks the sender to retry when BTCPay cannot be reached', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new Error('sin red');
    });
    const cuerpo = cuerpoDe('InvoiceSettled');
    const respuesta = await POST(peticion(cuerpo, firmar(cuerpo)));
    expect(respuesta.status).toBe(502);
    expect(confirmarPagoBtcpay).not.toHaveBeenCalled();
  });
});
