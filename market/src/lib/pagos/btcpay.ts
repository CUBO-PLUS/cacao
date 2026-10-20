// BTCPay Server adapter. One BTCPay store per business: the store id comes from negocios.btcpay_tienda_id.
// Only "Settled" counts as paid. The webhook route calls consultarCobro too, so it never trusts its own body.

import { type ConfigBtcpay, ErrorBtcpay, leerFactura, crearFactura } from './btcpay-api';
import type { Cobro, ProveedorDePago } from './proveedor';

const ID = /^[A-Za-z0-9]{10,64}$/;

/** The referencia stored in cobros.referencia_externa: "<storeId>:<invoiceId>". */
export function referenciaBtcpay(storeId: string, facturaId: string): string {
  return `${storeId}:${facturaId}`;
}

function separarReferencia(referencia: string): { storeId: string; facturaId: string } | null {
  const corte = referencia.indexOf(':');
  if (corte < 0) return null;
  const storeId = referencia.slice(0, corte);
  const facturaId = referencia.slice(corte + 1);
  if (!ID.test(storeId) || !ID.test(facturaId)) return null;
  return { storeId, facturaId };
}

export function crearProveedorBtcpay(config: ConfigBtcpay, storeId: string): ProveedorDePago {
  return {
    async crearCobro({ sats, memo, expiraEnSeg, metadatos }): Promise<Cobro> {
      const factura = await crearFactura(config, {
        storeId,
        sats,
        minutos: Math.ceil(expiraEnSeg / 60),
        metadata: {
          producto: 'market',
          orderId: memo,
          itemDesc: memo,
          usdCentavos: 0,
          cotizacionUsdBtc: 0,
          ...metadatos,
        },
      });
      return {
        referencia: referenciaBtcpay(storeId, factura.id),
        bolt11: factura.bolt11,
        destino: null,
        verificarUrl: null,
        expiraEn: factura.expiraEn,
      };
    },

    async consultarCobro({ referencia }): Promise<'pendiente' | 'pagado' | 'expirado'> {
      if (referencia === null) return 'pendiente';
      const partes = separarReferencia(referencia);
      if (partes === null) return 'pendiente';
      try {
        const factura = await leerFactura(config, partes.storeId, partes.facturaId);
        if (factura.estado === 'Settled') return 'pagado';
        if (factura.estado === 'Expired' || factura.estado === 'Invalid') return 'expirado';
        return 'pendiente';
      } catch (error) {
        // Unreachable BTCPay or an unknown invoice: not paid yet, the next check asks again.
        if (!(error instanceof ErrorBtcpay)) console.error('btcpay consultarCobro:', error);
        return 'pendiente';
      }
    },
  };
}
