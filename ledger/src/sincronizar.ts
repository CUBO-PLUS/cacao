import type { AlmacenTickets } from "./almacen/tipos.ts";
import { importarFacturaBtcpay } from "./btcpay.ts";
import { ErrorLedger } from "./errores.ts";
import { ErrorBtcpay, facturasPagadas, type ConfigBtcpay, type Factura } from "./pagos/btcpay-api.ts";
import { productoDeTicket } from "./ticket.ts";

// Imports the settled BTCPay invoices of some stores into any AlmacenTickets. The rules per invoice
// are importarFacturaBtcpay's (btcpay.ts); this only reads the invoices and counts the results.
//
// Limit: facturasPagadas asks BTCPay for at most 200 invoices per store and call, newest first, and
// the client has no skip or end-date parameter. A store that returns 200 is listed in
// tiendasTruncadas: its older invoices were not read. Run again with a later `desde` to narrow it.

export const LIMITE_FACTURAS_POR_TIENDA = 200;

export type ConfigSincronizacion = {
  // Public base address of BTCPay, without a trailing slash.
  url: string;
  // Greenfield API key with permission to read invoices. Read-only.
  clave: string;
  tiendas: string[];
  // Replaced in tests.
  fetch?: typeof fetch;
  esperaMs?: number;
};

export type OpcionesSincronizacion = {
  // Only invoices created from this instant on. Omit to read the newest 200 per store.
  desde?: Date;
  // Clock for the imported tickets and the log.
  ahora: Date;
  // Writes one row of the sync log, for example into ledger_sincronizaciones.
  registrar?: (r: RegistroSincronizacion) => Promise<void>;
  // Runs after the import, on the same store, and returns how many documents it emitted and refused.
  // Only the web uses it (src/emitir.ts). Its counts go into the log row when it is given.
  emitir?: (almacen: AlmacenTickets) => Promise<{ emitidos: number; rechazados: number }>;
};

export type RegistroSincronizacion = {
  empezo: string; // ISO-8601
  termino: string; // ISO-8601
  nuevas: number;
  repetidas: number;
  omitidas: number;
  error: string | null;
  origen: "btcpay";
  // Present only when the run emitted documents (the web app).
  emitidos?: number;
  rechazados?: number;
};

export type OmitidaSincronizacion = { factura: string; motivo: string };

export type ResultadoSincronizacion = {
  nuevas: number;
  repetidas: number;
  omitidas: OmitidaSincronizacion[];
  // New tickets per product ("media", "travel", "market", "pay"), and "sin-producto" for others.
  porProducto: Record<string, number>;
  // Stores that returned the full page, so older invoices were not read.
  tiendasTruncadas: string[];
  // Set only when the run had an emitir hook.
  emitidos?: number;
  rechazados?: number;
};

async function leerFacturas(config: ConfigSincronizacion, desde: Date | undefined, truncadas: string[]): Promise<Factura[]> {
  const cfg: ConfigBtcpay = { url: config.url, clave: config.clave, fetch: config.fetch, esperaMs: config.esperaMs };
  const facturas: Factura[] = [];
  for (const tienda of config.tiendas) {
    let lista: Factura[];
    try {
      lista = await facturasPagadas(cfg, tienda, desde);
    } catch (e) {
      if (e instanceof ErrorBtcpay) throw new ErrorLedger(`No se pudieron leer las facturas de la tienda ${tienda}: ${e.message}`);
      throw e;
    }
    if (lista.length >= LIMITE_FACTURAS_POR_TIENDA) truncadas.push(tienda);
    facturas.push(...lista);
  }
  return facturas;
}

export async function sincronizarBtcpay(
  almacen: AlmacenTickets,
  config: ConfigSincronizacion,
  opciones: OpcionesSincronizacion,
): Promise<ResultadoSincronizacion> {
  const empezo = opciones.ahora.toISOString();
  const truncadas: string[] = [];
  const resultado: ResultadoSincronizacion = { nuevas: 0, repetidas: 0, omitidas: [], porProducto: {}, tiendasTruncadas: truncadas };
  try {
    if (config.tiendas.length === 0) throw new ErrorLedger("No hay tiendas de BTCPay indicadas para sincronizar.");
    const facturas = await leerFacturas(config, opciones.desde, truncadas);
    for (const factura of facturas) {
      let r: Awaited<ReturnType<typeof importarFacturaBtcpay>>;
      try {
        r = await importarFacturaBtcpay(almacen, factura, opciones.ahora);
      } catch (e) {
        // Two syncs at the same time both see the invoice as new; the database keeps the first ticket and
        // refuses the second with DUPLICADO. For this sync that invoice is simply already imported.
        if (e instanceof Error && e.message.includes("DUPLICADO")) {
          resultado.repetidas += 1;
          continue;
        }
        // Any other failure stays with this invoice: it is listed as omitida and the run goes on with the rest.
        resultado.omitidas.push({ factura: factura.id, motivo: e instanceof Error ? e.message : String(e) });
        continue;
      }
      if ("omitida" in r) {
        resultado.omitidas.push({ factura: factura.id, motivo: r.omitida });
      } else if (r.nueva) {
        resultado.nuevas += 1;
        const clave = productoDeTicket(r.ticket) ?? "sin-producto";
        resultado.porProducto[clave] = (resultado.porProducto[clave] ?? 0) + 1;
      } else {
        resultado.repetidas += 1;
      }
    }
    if (opciones.emitir) {
      const emitidos = await opciones.emitir(almacen);
      resultado.emitidos = emitidos.emitidos;
      resultado.rechazados = emitidos.rechazados;
    }
  } catch (e) {
    if (opciones.registrar) {
      // Keep the original error even if the log itself cannot be written.
      await opciones.registrar(registro(empezo, resultado, e instanceof Error ? e.message : String(e))).catch(() => undefined);
    }
    throw e;
  }
  if (opciones.registrar) await opciones.registrar(registro(empezo, resultado, null));
  return resultado;
}

function registro(empezo: string, r: ResultadoSincronizacion, error: string | null): RegistroSincronizacion {
  return {
    empezo,
    termino: new Date().toISOString(),
    nuevas: r.nuevas,
    repetidas: r.repetidas,
    omitidas: r.omitidas.length,
    error,
    origen: "btcpay",
    // Only keys that were counted: runs without emission keep the log row they always had.
    ...(r.emitidos === undefined ? {} : { emitidos: r.emitidos, rechazados: r.rechazados }),
  };
}
