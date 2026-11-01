import { createHmac } from 'node:crypto';

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { codigoDe, limpiar, negocio, ordenDe, pedir, producto, servicio, stockDe, usuarioNuevo } from './ayuda';

// A payment can arrive twice: two confirmations at the same time, or two BTCPay notices. The order must be
// paid once and its stock must move once (at the order, never again at payment).

vi.mock('@/servidor/url-btcpay', () => ({
  configBtcpay: async () => ({ url: 'http://btcpay.prueba.local', clave: 'clave-de-prueba' }),
}));

vi.mock('@/lib/pagos/btcpay-api', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/pagos/btcpay-api')>();
  return { ...real, leerFactura: vi.fn(async () => ({ estado: 'Settled' })) };
});

const SECRETO_WEBHOOK = 'secreto-de-prueba-webhook';

// Each run uses random ids for the store and the invoice, the shape BTCPay gives them.
function idAleatorio(): string {
  return Array.from({ length: 16 }, () => 'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(Math.random() * 36)]).join('');
}

async function ordenConCobroBtcpay(stock: number) {
  const vendedor = await usuarioNuevo();
  const comprador = await usuarioNuevo();
  const tienda = await negocio(vendedor);
  const prod = await producto(vendedor, { stock, precio: 350 });
  const orden = await pedir(comprador, tienda, [{ producto: prod.id, cantidad: 1 }]);
  const tiendaBtcpay = idAleatorio();
  const factura = idAleatorio();
  const { error } = await servicio().rpc('registrar_cobro', {
    p_orden: orden.id,
    p_proveedor: 'btcpay',
    p_referencia: `${tiendaBtcpay}:${factura}`,
    p_bolt11: 'lnbcrt1prueba',
    p_destino: null,
    p_verificar_url: null,
    p_expira_en: new Date(Date.now() + 600_000).toISOString(),
  });
  if (error) throw error;
  return { orden, prod, tiendaBtcpay, factura };
}

async function cobroDe(ordenId: string) {
  const { data, error } = await servicio().from('cobros').select('estado').eq('orden_id', ordenId).single();
  if (error) throw error;
  return data;
}

beforeAll(() => {
  process.env.BTCPAY_WEBHOOK_SECRET = SECRETO_WEBHOOK;
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(limpiar);

describe('confirmar_pago dos veces a la vez', () => {
  it('una sola confirmación gana; la otra recibe ESTADO_INVALIDO y el stock se mueve una vez', async () => {
    const { orden, prod } = await ordenConCobroBtcpay(5);
    expect(await stockDe(prod.id)).toBe(4);

    const [a, b] = await Promise.all([
      servicio().rpc('confirmar_pago', { p_orden: orden.id, p_actor: null }),
      servicio().rpc('confirmar_pago', { p_orden: orden.id, p_actor: null }),
    ]);

    const ganadores = [a, b].filter((r) => r.error === null);
    const perdedores = [a, b].filter((r) => r.error !== null);
    expect(ganadores).toHaveLength(1);
    expect(perdedores).toHaveLength(1);
    expect(codigoDe(perdedores[0].error)).toBe('ESTADO_INVALIDO');

    expect((await ordenDe(orden.id)).estado).toBe('pagada');
    expect((await cobroDe(orden.id)).estado).toBe('pagado');
    expect(await stockDe(prod.id)).toBe(4);
  });
});

describe('dos avisos de BTCPay a la vez', () => {
  it('ambos responden 200, la orden se paga una sola vez y el stock no vuelve a moverse', async () => {
    const { POST } = await import('@/app/api/pagos/btcpay/route');
    const { orden, prod, tiendaBtcpay, factura } = await ordenConCobroBtcpay(5);
    const aviso = JSON.stringify({ type: 'InvoiceSettled', storeId: tiendaBtcpay, invoiceId: factura });
    const firma = 'sha256=' + createHmac('sha256', SECRETO_WEBHOOK).update(aviso, 'utf8').digest('hex');
    const peticion = () =>
      new Request('http://localhost/api/pagos/btcpay', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'btcpay-sig': firma },
        body: aviso,
      });
    const avisos: string[] = [];
    vi.spyOn(console, 'warn').mockImplementation((...partes: unknown[]) => {
      avisos.push(partes.map(String).join(' '));
    });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const [a, b] = await Promise.all([POST(peticion()), POST(peticion())]);

    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    // Exactly one of the two notices did the payment; the other one was refused by the database and logged.
    expect(avisos.filter((texto) => texto.includes('ESTADO_INVALIDO'))).toHaveLength(1);
    expect((await ordenDe(orden.id)).estado).toBe('pagada');
    expect((await cobroDe(orden.id)).estado).toBe('pagado');
    expect(await stockDe(prod.id)).toBe(4);
  });

  it('un aviso con firma mala no paga nada', async () => {
    const { POST } = await import('@/app/api/pagos/btcpay/route');
    const { orden, tiendaBtcpay, factura } = await ordenConCobroBtcpay(5);
    const aviso = JSON.stringify({ type: 'InvoiceSettled', storeId: tiendaBtcpay, invoiceId: factura });
    const respuesta = await POST(
      new Request('http://localhost/api/pagos/btcpay', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'btcpay-sig': 'sha256=falsa' },
        body: aviso,
      }),
    );
    expect(respuesta.status).toBe(401);
    expect((await ordenDe(orden.id)).estado).toBe('esperando_pago');
  });
});
