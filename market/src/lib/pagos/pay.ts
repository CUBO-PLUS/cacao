// CacaoPay adapter: the payment request of a market business, charged through CacaoPay. Same interface as the direct
// BTCPay adapter (./btcpay.ts). The store is the business's own (negocios.btcpay_tienda_id), and CacaoPay refuses a
// store that is not in the Market client's list.

import { crearCobroPay, ErrorPay, leerCobroPay, payIdDeReferencia, referenciaDePay, type ConfigPay } from './pay-api';
import type { Cobro, ProveedorDePago } from './proveedor';

// CacaoPay accepts up to 200 characters for the description, the same line the ticket shows.
const DESCRIPCION_MAX = 200;

export function crearProveedorPay(config: ConfigPay, tienda: string): ProveedorDePago {
  return {
    async crearCobro({ sats, memo, expiraEnSeg, metadatos, referencia, clave }): Promise<Cobro> {
      if (!clave) throw new Error('CacaoPay necesita la clave de idempotencia del intento.');
      const cobro = await crearCobroPay(config, {
        clave,
        sats,
        descripcion: (metadatos?.itemDesc ?? memo).slice(0, DESCRIPCION_MAX),
        referencia: referencia ?? metadatos?.orderId ?? memo,
        venceEnSegundos: expiraEnSeg,
        tienda,
      }).catch((error: unknown) => {
        if (error instanceof ErrorPay && error.estado === 403) {
          throw new ErrorPay(
            `La tienda ${tienda} no está en la lista de CacaoPay de Market: corré scripts/tiendas-btcpay.mjs para agregarla.`,
            403,
            'NO_PERMITIDO',
          );
        }
        throw error;
      });
      // The amount is the one this server asked for: CacaoPay makes the sats exact, and a different answer is refused.
      if (cobro.sats !== sats) {
        throw new ErrorPay(`CacaoPay devolvió ${cobro.sats} sats, y se pidieron ${sats}.`, 502, 'MONTO');
      }
      if (cobro.estado !== 'pendiente') {
        throw new ErrorPay(`CacaoPay devolvió un cobro en estado ${cobro.estado}.`, 502, 'ESTADO');
      }
      return {
        referencia: referenciaDePay(cobro.id),
        bolt11: cobro.factura,
        destino: null,
        verificarUrl: null,
        expiraEn: new Date(cobro.expira_en),
      };
    },

    async consultarCobro({ referencia }): Promise<'pendiente' | 'pagado' | 'expirado'> {
      const id = payIdDeReferencia(referencia);
      if (id === null) return 'pendiente';
      try {
        const cobro = await leerCobroPay(config, id);
        if (cobro.estado === 'pagado') return 'pagado';
        if (cobro.estado === 'vencido' || cobro.estado === 'cancelado') return 'expirado';
        return 'pendiente';
      } catch (error) {
        // CacaoPay unreachable or failing: not paid yet, the next check asks again.
        if (!(error instanceof ErrorPay)) console.error('cacaopay consultarCobro:', error);
        return 'pendiente';
      }
    },
  };
}
