import { ErrorLedger } from "./errores.ts";

// Control-number correlatives in Supabase, through ledger_siguiente_correlativo (migration 20261021000002).
// The function takes the number in the same atomic call that returns it, so the number is spent at once:
// there is no "record it after validating" step as in correlativos.ts. The web emission therefore takes the
// number right before it builds the document, and a document that is refused keeps its number (recorded as
// estado "rechazado"). Hacienda numbering tolerates gaps only through invalidation: a demo limitation.

export type ConfigCorrelativosSupabase = {
  // Base address of the project, without a trailing slash needed.
  url: string;
  // Service role key. Never sent to the browser.
  clave: string;
  // Replaced in tests.
  fetch?: typeof fetch;
};

export type FuenteCorrelativosSupabase = {
  // Takes the next number of the serie. The number is consumed even if the document is refused later.
  tomarCorrelativo(serie: string): Promise<number>;
};

export function correlativosSupabase(config: ConfigCorrelativosSupabase): FuenteCorrelativosSupabase {
  const base = `${config.url.replace(/\/+$/, "")}/rest/v1`;
  const f = config.fetch ?? fetch;
  const cabeceras = {
    apikey: config.clave,
    authorization: `Bearer ${config.clave}`,
    accept: "application/json",
    "content-type": "application/json",
  };

  return {
    async tomarCorrelativo(serie: string): Promise<number> {
      let r: Response;
      try {
        r = await f(`${base}/rpc/ledger_siguiente_correlativo`, {
          method: "POST",
          headers: cabeceras,
          body: JSON.stringify({ p_serie: serie }),
        });
      } catch {
        throw new ErrorLedger("No se pudo conectar con la base de correlativos.");
      }
      if (!r.ok) throw new ErrorLedger(`No se pudo tomar el correlativo de la serie ${serie} (HTTP ${r.status}).`);
      const numero = (await r.json()) as unknown;
      if (typeof numero !== "number" || !Number.isSafeInteger(numero) || numero < 1) {
        throw new ErrorLedger(`La base devolvió un correlativo inválido para la serie ${serie}.`);
      }
      return numero;
    },
  };
}
