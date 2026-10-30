// The server variables this product reads. Server only.
// process.env is set by the platform (Vercel). In local development Astro hands the .env.local values to
// import.meta.env instead, so both are read: process.env first, so an empty variable in the environment
// really turns a service off. Looked up by name, so the build never inlines a secret.

const VARIABLES = [
  'BTCPAY_URL',
  'BTCPAY_API_KEY',
  'BTCPAY_STORE_ID',
  'SUPABASE_URL',
  'SUPABASE_ANON_KEY',
  'PRECIO_FIJO_USD_BTC',
] as const;

export function entornoServidor(): Record<string, string | undefined> {
  const deAstro = import.meta.env as Record<string, string | undefined>;
  const salida: Record<string, string | undefined> = {};
  for (const nombre of VARIABLES) salida[nombre] = process.env[nombre] ?? deAstro[nombre];
  return salida;
}
