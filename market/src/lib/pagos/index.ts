// Picks the payment adapter for a shop. Lib code: no environment access; the server passes the BTCPay config.

import { esDireccionLightning } from '../lightning/direccion';
import type { ConfigBtcpay } from './btcpay-api';
import { crearProveedorBtcpay } from './btcpay';
import { crearProveedorFalso } from './falso';
import { crearProveedorManual } from './manual';
import type { ProveedorDePago } from './proveedor';

export type { Cobro, ProveedorDePago } from './proveedor';

export type NegocioPago = {
  tipoProveedorPago: 'manual' | 'falso' | 'nwc' | 'blink' | 'btcpay';
  lightningAddress: string | null;
  /** BTCPay store of the business. Null until the setup script assigns one. */
  btcpayTiendaId: string | null;
};

export type OpcionesProveedor = {
  /** BTCPay configuration from the environment. Null or missing when BTCPay is not set up. */
  btcpay?: ConfigBtcpay | null;
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
      return crearProveedorBtcpay(config, tienda);
    }
    case 'nwc':
    case 'blink':
      throw new Error(
        `NO_DISPONIBLE: El cobro con ${negocio.tipoProveedorPago} llega en el siguiente paso.`,
      );
  }
}
