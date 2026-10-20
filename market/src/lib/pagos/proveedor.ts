// Contract every payment adapter implements. Shared by the app and the tests.

export interface ProveedorDePago {
  crearCobro(input: {
    sats: number;
    memo: string;
    expiraEnSeg: number;
    /** Optional. Only the BTCPay adapter writes it into the invoice; the others ignore it. */
    metadatos?: { orderId: string; itemDesc: string; usdCentavos: number; cotizacionUsdBtc: number };
  }): Promise<Cobro>;
  consultarCobro(cobro: {
    referencia: string | null;
    verificarUrl: string | null;
    expiraEn: Date;
  }): Promise<'pendiente' | 'pagado' | 'expirado'>;
}

export type Cobro = {
  referencia: string | null;
  bolt11: string | null;
  destino: string | null;
  verificarUrl: string | null;
  expiraEn: Date;
};
