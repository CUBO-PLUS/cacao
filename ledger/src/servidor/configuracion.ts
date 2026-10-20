import { createAlmacenDtesSupabase, type AlmacenDtes } from "../almacen/dtes.ts";
import { createAlmacenSupabase } from "../almacen/supabase.ts";
import type { AlmacenTickets } from "../almacen/tipos.ts";
import { ErrorLedger } from "../errores.ts";
import type { ConfigSincronizacion } from "../sincronizar.ts";

// Server-side configuration of the web app, read from the environment. Nothing here reaches the browser.

export type ConfigSupabaseWeb = { url: string; clave: string };

type Entorno = Record<string, string | undefined>;

export function supabaseDeEntorno(entorno: Entorno = process.env): ConfigSupabaseWeb | null {
  const url = (entorno.SUPABASE_URL ?? "").trim().replace(/\/+$/, "");
  const clave = (entorno.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();
  if (url === "" || clave === "") return null;
  return { url, clave };
}

// The ticket store. Throws a Spanish message when the database is not configured.
export function almacenDeEntorno(entorno: Entorno = process.env): AlmacenTickets {
  const config = supabaseDeEntorno(entorno);
  if (config === null) throw new ErrorLedger("Falta la configuración de la base de datos en el servidor.");
  return createAlmacenSupabase(config);
}

// The documents the web emitted (ledger_dtes). Same configuration and the same message as almacenDeEntorno.
export function almacenDtesDeEntorno(entorno: Entorno = process.env): AlmacenDtes {
  const config = supabaseDeEntorno(entorno);
  if (config === null) throw new ErrorLedger("Falta la configuración de la base de datos en el servidor.");
  return createAlmacenDtesSupabase(config);
}

// BTCPay for the sync. Null when the address or the key is missing; an empty store list is reported by the sync itself.
export function btcpayDeEntorno(entorno: Entorno = process.env): ConfigSincronizacion | null {
  const url = (entorno.LEDGER_BTCPAY_URL ?? "").trim().replace(/\/+$/, "");
  const clave = (entorno.LEDGER_BTCPAY_API_KEY ?? "").trim();
  if (url === "" || clave === "") return null;
  const tiendas = (entorno.LEDGER_BTCPAY_TIENDAS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return { url, clave, tiendas };
}
