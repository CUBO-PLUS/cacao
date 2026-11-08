// BTCPay Server settings for Cacao Media. Server only. The client itself is in ./btcpay.ts (a copy of infra/btcpay/btcpay.ts).
// Same environment lookup as cobros.ts: Astro's import.meta.env first, then process.env.
import { configDesdeEntorno, ErrorBtcpay, type ConfigBtcpay } from './btcpay';
import { urlBtcpay } from './url-btcpay';

/** What the reader sees when BTCPay cannot be reached. Never a stack trace. */
export const PAUSA_BTCPAY = 'Los pagos no están disponibles en este momento. Probá de nuevo más tarde.';

function variable(nombre: string): string | undefined {
  const deAstro = (import.meta.env as Record<string, string | undefined>)[nombre];
  return deAstro ?? process.env[nombre];
}

/** True when BTCPay did not answer (status 0) or failed on its side (5xx). The reader is then asked to wait. */
export function btcpayEnPausa(error: unknown): boolean {
  return error instanceof ErrorBtcpay && (error.estado === 0 || error.estado >= 500);
}

/**
 * The BTCPay connection, or null when the URL or the API key is missing. Null means: do not charge through BTCPay.
 * The URL comes from Supabase (see ./url-btcpay.ts), so a tunnel change does not need a redeploy.
 */
export async function configBtcpay(): Promise<ConfigBtcpay | null> {
  return configDesdeEntorno({
    BTCPAY_URL: (await urlBtcpay()) ?? undefined,
    BTCPAY_API_KEY: variable('BTCPAY_API_KEY'),
  });
}

/** The store of Cacao Media. Invoices are made here and webhooks from other stores are ignored. */
export function tiendaBtcpay(): string | null {
  const tienda = (variable('BTCPAY_STORE_ID') ?? '').trim();
  return tienda || null;
}

/** The secret BTCPay signs its webhooks with. Empty when not set: every webhook is then refused. */
export function secretoWebhook(): string {
  return (variable('BTCPAY_WEBHOOK_SECRET') ?? '').trim();
}
