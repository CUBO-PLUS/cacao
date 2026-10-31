// Picks the payment adapter for a shop. Lib code: no environment access; the server passes the BTCPay config.

import { esDireccionLightning } from '../lightning/direccion';
import type { ConfigBtcpay } from './btcpay-api';
import { crearProveedorBtcpay } from './btcpay';
import { crearProveedorFalso } from './falso';
import { crearProveedorManual } from './manual';
import { crearProveedorPay } from './pay';
import { esReferenciaPay, type ConfigPay } from './pay-api';
import type { ProveedorDePago } from './proveedor';

export type { Cobro, ProveedorDePago } from './proveedor';

// Charges go through CacaoPay when it is configured. A referencia made by BTCPay directly (an order in flight from
// before the switch) is still read through the direct adapter, so both modes resolve it.
function conPay(pay: ProveedorDePago, directo: ProveedorDePago): ProveedorDePago {
  return {
    crearCobro: (entrada) => pay.crearCobro(entrada),
    consultarCobro: (cobro) => (esReferenciaPay(cobro.referencia) ? pay : directo).consultarCobro(cobro),
  };
}

export type NegocioPago = {
  tipoProveedorPago: 'manual' | 'falso' | 'nwc' | 'blink' | 'btcpay';
  lightningAddress: string | null;
  /** BTCPay store of the business. Null until the setup script assigns one. */
  btcpayTiendaId: string | null;
};

export type OpcionesProveedor = {
  /** BTCPay configuration from the environment. Null or missing when BTCPay is not set up. */
  btcpay?: ConfigBtcpay | null;
  /** CacaoPay configuration from the environment. Null or missing: charges stay on BTCPay directly. */
  pay?: ConfigPay | null;
};

export function proveedorPara(negocio: NegocioPago, opciones: OpcionesProveedor = {}): ProveedorDePago {
  switch (negocio.tipoProveedorPago) {
    case 'manual': {
      const direccion = negocio.lightningAddress;
      if (!direccion || !esDireccionLightning(direccion)) {
        throw new Error('SIN_DIRECCION: Cargá una Lightning Address válida para cobrar.');
      }
      return crearProveedorManual(direccion);
    }
    case 'falso':
      return crearProveedorFalso();
    case 'btcpay': {
      const config = opciones.btcpay ?? null;
      const tienda = negocio.btcpayTiendaId;
      if (!config || !tienda) {
        throw new Error('NO_DISPONIBLE: El cobro con BTCPay no está configurado.');
      }
      const directo = crearProveedorBtcpay(config, tienda);
      return opciones.pay ? conPay(crearProveedorPay(opciones.pay, tienda), directo) : directo;
    }
    case 'nwc':
    case 'blink':
      throw new Error(
        `NO_DISPONIBLE: El cobro con ${negocio.tipoProveedorPago} llega en el siguiente paso.`,
      );
  }
}
