// BTCPay Server settings for Cacao Media. Server only. The client itself is in ./btcpay.ts (a copy of infra/btcpay/btcpay.ts).
// Same environment lookup as cobros.ts: Astro's import.meta.env first, then process.env.
import { configDesdeEntorno, type ConfigBtcpay } from './btcpay';

function variable(nombre: string): string | undefined {
  const deAstro = (import.meta.env as Record<string, string | undefined>)[nombre];
  return deAstro ?? process.env[nombre];
}

/** The BTCPay connection, or null when the URL or the API key is missing. Null means: do not charge through BTCPay. */
export function configBtcpay(): ConfigBtcpay | null {
  return configDesdeEntorno({
    BTCPAY_URL: variable('BTCPAY_URL'),
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
