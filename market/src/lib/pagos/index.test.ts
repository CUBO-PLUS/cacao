import { beforeEach, describe, expect, it } from 'vitest';
import type { ConfigBtcpay } from './btcpay-api';
import { olvidarFalsos } from './falso';
import { proveedorPara } from './index';

beforeEach(() => {
  olvidarFalsos();
});

const SIN_TIENDA = { btcpayTiendaId: null };
const CONFIG: ConfigBtcpay = { url: 'https://btcpay.ejemplo.com', clave: 'clave-de-prueba' };

describe('proveedorPara', () => {
  it('manual needs a Lightning Address', () => {
    expect(() => proveedorPara({ tipoProveedorPago: 'manual', lightningAddress: null, ...SIN_TIENDA })).toThrow(
      /^SIN_DIRECCION:/,
    );
    expect(() => proveedorPara({ tipoProveedorPago: 'manual', lightningAddress: '', ...SIN_TIENDA })).toThrow(
      /^SIN_DIRECCION:/,
    );
  });

  it('manual refuses an address that is not a Lightning Address', () => {
    expect(() =>
      proveedorPara({ tipoProveedorPago: 'manual', lightningAddress: 'no-es-direccion', ...SIN_TIENDA }),
    ).toThrow(/^SIN_DIRECCION:/);
  });

  it('manual with an address returns an adapter with both operations', () => {
    const proveedor = proveedorPara({
      tipoProveedorPago: 'manual',
      lightningAddress: 'ana@tienda.ejemplo.com',
      ...SIN_TIENDA,
    });
    expect(typeof proveedor.crearCobro).toBe('function');
    expect(typeof proveedor.consultarCobro).toBe('function');
  });

  it('falso returns the fake adapter, which makes invoices without any network', async () => {
    const proveedor = proveedorPara({ tipoProveedorPago: 'falso', lightningAddress: null, ...SIN_TIENDA });
    const cobro = await proveedor.crearCobro({ sats: 100, memo: 'prueba', expiraEnSeg: 600 });
    expect(cobro.bolt11?.startsWith('lnbcfalso')).toBe(true);
  });

  it('btcpay needs both the configuration and the store of the business', () => {
    expect(() =>
      proveedorPara({ tipoProveedorPago: 'btcpay', lightningAddress: null, btcpayTiendaId: 'Tienda1234567' }),
    ).toThrow(/^NO_DISPONIBLE: El cobro con BTCPay no está configurado\./);
    expect(() =>
      proveedorPara({ tipoProveedorPago: 'btcpay', lightningAddress: null, ...SIN_TIENDA }, { btcpay: CONFIG }),
    ).toThrow(/^NO_DISPONIBLE: El cobro con BTCPay no está configurado\./);
    expect(() =>
      proveedorPara({ tipoProveedorPago: 'btcpay', lightningAddress: null, btcpayTiendaId: 'Tienda1234567' }, { btcpay: null }),
    ).toThrow(/^NO_DISPONIBLE:/);
  });

  it('btcpay with configuration and a store returns the BTCPay adapter', () => {
    const proveedor = proveedorPara(
      { tipoProveedorPago: 'btcpay', lightningAddress: null, btcpayTiendaId: 'Tienda1234567' },
      { btcpay: CONFIG },
    );
    expect(typeof proveedor.crearCobro).toBe('function');
    expect(typeof proveedor.consultarCobro).toBe('function');
  });

  it.each(['nwc', 'blink'] as const)('%s is not available yet', (tipo) => {
    expect(() => proveedorPara({ tipoProveedorPago: tipo, lightningAddress: null, ...SIN_TIENDA })).toThrow(
      /^NO_DISPONIBLE:/,
    );
  });
});
