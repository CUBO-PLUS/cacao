// Lightning payment of a transfer, the pure part: the amount in sats and what the screen shows.
// No 'server-only' here: Client Components import the type.

/** What the sender sees to pay a transfer in Lightning. */
export type PagoLightning = {
  envioId: string;
  /** Exact amount to pay, in sats. */
  sats: number;
  /** The same amount in US cents, at the BTC price used. */
  usdCentavos: number;
  /** BOLT11 invoice, to paste into a wallet. */
  bolt11: string;
  /** ISO time after which the invoice no longer works. */
  expiraEn: string;
  /** Link to the regtest test wallet, or null when the invoice is not a regtest one. */
  enlaceBilleteraDePrueba: string | null;
};

/**
 * Sats for a US amount: sats = ceil(usdCentavos * 1e6 / cotizacion), where cotizacion is USD per BTC.
 * Rounded up, so the invoice never asks for less than the amount. The product is rounded to 12
 * significant digits first, so binary float error cannot add a sat at an exact boundary.
 */
export function satsParaFactura(usdCentavos: number, usdBtc: number): number {
  if (!Number.isInteger(usdCentavos) || usdCentavos <= 0) {
    throw new Error('El monto en centavos tiene que ser un entero mayor que cero.');
  }
  if (!Number.isFinite(usdBtc) || usdBtc <= 0) {
    throw new Error('El precio del bitcoin tiene que ser un número mayor que cero.');
  }
  const sats = Math.ceil(Number(((usdCentavos * 1_000_000) / usdBtc).toPrecision(12)));
  if (!Number.isSafeInteger(sats) || sats < 1) {
    throw new Error('El monto en sats no es válido.');
  }
  return sats;
}
