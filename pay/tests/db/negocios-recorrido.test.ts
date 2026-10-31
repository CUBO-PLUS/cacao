import { randomBytes } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { configTiendas } from '@/servidor/api-cobros-btcpay';
import { leerFactura } from '@/servidor/btcpay';
import { activarNegocio, cobrarEnCaja, estadoEnCaja, resumenNegocio } from '@/servidor/negocios';

import { servicio, sufijo, usuarioNuevo } from './ayuda';

// The walk of a business, end to end, on the demo BTCPay and its test wallet: activate, charge $3.50 (twice, as a double
// tap), check the invoice carries the metadata Ledger reads, pay it from the test wallet, see it paid, see the sale in
// the panel, and see that another business cannot read it. Needs the local BTCPay stack and PAY_BTCPAY_TIENDAS_KEY
// (pay/.env.local, from infra/btcpay/local/clave-tiendas.mjs). Without them the test is skipped, not passed.

// The demo BTCPay, through its door on 8088. The database tests blank BTCPAY_URL (vitest.config.ts); this walk needs it.
if (!process.env.BTCPAY_URL) process.env.BTCPAY_URL = 'http://127.0.0.1:8088';
const BILLETERA = 'http://127.0.0.1:8088/billetera/api/pagar';
const disponible = Boolean(process.env.PAY_BTCPAY_TIENDAS_KEY);

const esperar = (ms: number) => new Promise((resolver) => setTimeout(resolver, ms));

describe.skipIf(!disponible)('recorrido de un negocio con la demo de BTCPay', () => {
  it('activa, cobra $3.50, paga con la billetera de prueba, ve Pagado y la venta en el panel', async () => {
    const dueno = await usuarioNuevo(`Recorrido ${sufijo()}`);
    const activo = await activarNegocio(dueno.id, {
      nombre: `Café recorrido ${sufijo()}`,
      tipo: 'cafeteria',
      ubicacion: 'Colonia Escalón, San Salvador',
    });
    expect(activo.ok).toBe(true);
    if (!activo.ok) return;

    // Activating again changes nothing: the same business, no second store.
    const otra = await activarNegocio(dueno.id, { nombre: '', tipo: '', ubicacion: '' });
    expect(otra).toEqual({ ok: true, dato: { negocioId: activo.dato.negocioId } });

    const clave = randomBytes(16).toString('hex');
    const cobro = await cobrarEnCaja(dueno.id, 350, clave);
    expect(cobro.ok).toBe(true);
    if (!cobro.ok) return;
    expect(cobro.dato.estado).toBe('pendiente');
    expect(cobro.dato.factura).toMatch(/^lnbcrt[0-9a-z]+$/);
    expect(cobro.dato.usd_centavos).toBe(350);

    // A double tap sends the same key: the same charge, no second invoice.
    const doble = await cobrarEnCaja(dueno.id, 350, clave);
    expect(doble.ok && doble.dato.id === cobro.dato.id && doble.dato.factura === cobro.dato.factura).toBe(true);

    // The invoice carries the metadata Ledger reads (ledger/src/btcpay.ts): the product, the order, the line, the US cents
    // and the price used. Ledger's own import accepts only media, travel, market and pay for now, so "negocios" is
    // reported there as an unknown product until Ledger adds it.
    const config = await configTiendas();
    expect(config).not.toBeNull();
    const { data: fila } = await servicio()
      .from('pay_cobros')
      .select('tienda_btcpay, btcpay_factura_id')
      .eq('id', cobro.dato.id)
      .single();
    expect(fila?.btcpay_factura_id).toBeTruthy();
    const factura = await leerFactura(config!, fila!.tienda_btcpay, fila!.btcpay_factura_id!);
    expect(factura.metadata).toMatchObject({ producto: 'negocios', usdCentavos: 350, orderId: `caja-${clave}` });
    expect(typeof factura.metadata.itemDesc).toBe('string');
    expect(factura.metadata.itemDesc).toContain('Venta en');
    expect(typeof factura.metadata.cotizacionUsdBtc).toBe('number');
    expect(factura.metadata.cotizacionUsdBtc as number).toBeGreaterThan(0);

    // The customer pays from the test wallet.
    const pago = await fetch(BILLETERA, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ factura: cobro.dato.factura }),
    });
    expect(pago.ok).toBe(true);

    // The counter screen asks for the state; it turns to Pagado within a few seconds.
    let estado = '';
    for (let i = 0; i < 30 && estado !== 'pagado'; i++) {
      const leido = await estadoEnCaja(dueno.id, cobro.dato.id);
      if (leido.ok) estado = leido.dato.estado;
      if (estado !== 'pagado') await esperar(1000);
    }
    expect(estado).toBe('pagado');

    // The panel shows the sale: today, this month and the latest charge.
    const panel = await resumenNegocio(dueno.id);
    expect(panel.ok).toBe(true);
    if (!panel.ok) return;
    expect(panel.dato.hoy).toEqual({ centavos: 350, cuenta: 1 });
    expect(panel.dato.mes).toEqual({ centavos: 350, cuenta: 1 });
    expect(panel.dato.recientes[0]?.id).toBe(cobro.dato.id);
    expect(panel.dato.recientes[0]?.estado).toBe('pagado');

    // Another business cannot read this charge.
    const ajeno = await usuarioNuevo(`Ajena ${sufijo()}`);
    const ajenoActivo = await activarNegocio(ajeno.id, { nombre: `Otra tienda ${sufijo()}`, tipo: 'tienda', ubicacion: 'Santa Tecla' });
    expect(ajenoActivo.ok).toBe(true);
    const visto = await estadoEnCaja(ajeno.id, cobro.dato.id);
    expect(visto.ok).toBe(false);
  }, 180_000);
});
