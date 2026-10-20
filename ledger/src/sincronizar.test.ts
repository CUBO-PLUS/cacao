import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { almacenArchivos } from "./almacen/archivos.ts";
import { leerFixture } from "./ayudas-prueba.ts";
import { leerFacturasArchivo } from "./btcpay.ts";
import { ErrorLedger } from "./errores.ts";
import type { Factura } from "./pagos/btcpay-api.ts";
import { sincronizarBtcpay, LIMITE_FACTURAS_POR_TIENDA, type RegistroSincronizacion } from "./sincronizar.ts";

const AHORA = new Date("2026-10-15T18:00:00.000Z");
const TIENDA = "TiendaPruebaCacao01";

// The invoice as the BTCPay Greenfield API returns it (see pagos/btcpay-api.ts).
type FacturaApi = { id: string; storeId: string; status: string; amount: string; expirationTime: number; metadata?: Record<string, unknown> };

function comoApi(f: Factura): FacturaApi {
  return {
    id: f.id,
    storeId: f.storeId,
    status: f.estado,
    amount: String(f.sats),
    expirationTime: Math.floor(f.expiraEn.getTime() / 1000),
    metadata: f.metadata,
  };
}

function facturasDelArchivo(): Factura[] {
  return leerFacturasArchivo(leerFixture("btcpay-facturas.json"));
}

// A fake BTCPay: lists the invoices of each store (honouring status=Settled and startDate) and
// answers the payment-methods call of each invoice.
function fakeBtcpay(porTienda: Record<string, Factura[]>): { fetch: typeof fetch; peticiones: URL[] } {
  const peticiones: URL[] = [];
  const todas = Object.values(porTienda).flat();
  const f = (async (entrada: string | URL | Request) => {
    const url = new URL(String(entrada));
    peticiones.push(url);
    const partes = url.pathname.split("/");
    const tienda = partes[4] ?? "";
    if (url.pathname.endsWith("/payment-methods")) {
      const factura = todas.find((x) => x.id === partes[6]);
      if (!factura) return new Response("{}", { status: 404 });
      const pagos = factura.paymentHash ? [{ id: factura.paymentHash, status: "Settled" }] : [];
      return new Response(JSON.stringify([{ paymentMethodId: "BTC-LN", destination: factura.bolt11, payments: pagos }]), { status: 200 });
    }
    const lista = (porTienda[tienda] ?? []).filter((x) => url.searchParams.get("status") !== "Settled" || x.estado === "Settled");
    const desde = url.searchParams.get("startDate");
    const filtrada = desde ? lista.filter((x) => x.expiraEn.getTime() >= Number(desde) * 1000) : lista;
    return new Response(JSON.stringify(filtrada.map(comoApi)), { status: 200 });
  }) as typeof fetch;
  return { fetch: f, peticiones };
}

function conDatos(fn: (datos: string) => Promise<void>): Promise<void> {
  const datos = mkdtempSync(join(tmpdir(), "ledger-sync-"));
  return fn(datos).finally(() => rmSync(datos, { recursive: true, force: true }));
}

test("a first sync imports the settled invoices, counts them by product and omits the rest with a reason", () =>
  conDatos(async (datos) => {
    const almacen = almacenArchivos(datos);
    const { fetch } = fakeBtcpay({ [TIENDA]: facturasDelArchivo() });
    const r = await sincronizarBtcpay(almacen, { url: "https://btcpay.test", clave: "k", tiendas: [TIENDA], fetch }, { ahora: AHORA });
    assert.equal(r.nuevas, 4);
    assert.equal(r.repetidas, 0);
    assert.deepEqual(r.porProducto, { media: 1, travel: 1, market: 1, pay: 1 });
    assert.deepEqual(r.tiendasTruncadas, []);
    // BTCPay returns only the Settled invoices (status=Settled), so the New one never reaches the sync.
    assert.deepEqual(r.omitidas.map((o) => o.factura), ["BtcpaySinMeta0006Fx"]);
    assert.match(r.omitidas[0]?.motivo ?? "", /producto de Cacao válido/);
  }));

test("a second sync repeats nothing new: the imported invoices are counted as repetidas", () =>
  conDatos(async (datos) => {
    const almacen = almacenArchivos(datos);
    const { fetch } = fakeBtcpay({ [TIENDA]: facturasDelArchivo() });
    const cfg = { url: "https://btcpay.test", clave: "k", tiendas: [TIENDA], fetch };
    await sincronizarBtcpay(almacen, cfg, { ahora: AHORA });
    const segunda = await sincronizarBtcpay(almacen, cfg, { ahora: AHORA });
    assert.equal(segunda.nuevas, 0);
    assert.equal(segunda.repetidas, 4);
    assert.equal(segunda.omitidas.length, 1);
  }));

test("desde is sent to BTCPay as startDate, and the sync log gets one row with the counts", () =>
  conDatos(async (datos) => {
    const almacen = almacenArchivos(datos);
    const { fetch, peticiones } = fakeBtcpay({ [TIENDA]: facturasDelArchivo() });
    const registros: RegistroSincronizacion[] = [];
    const desde = new Date("2026-10-01T06:00:00.000Z");
    await sincronizarBtcpay(almacen, { url: "https://btcpay.test", clave: "k", tiendas: [TIENDA], fetch }, {
      ahora: AHORA,
      desde,
      registrar: async (r) => {
        registros.push(r);
      },
    });
    const listado = peticiones.find((u) => u.pathname.endsWith("/invoices"));
    assert.equal(listado?.searchParams.get("startDate"), String(Math.floor(desde.getTime() / 1000)));
    assert.equal(listado?.searchParams.get("status"), "Settled");
    assert.equal(registros.length, 1);
    assert.deepEqual(registros[0], {
      empezo: AHORA.toISOString(),
      termino: registros[0]?.termino,
      nuevas: 4,
      repetidas: 0,
      omitidas: 1,
      error: null,
      origen: "btcpay",
    });
  }));

test("a BTCPay failure stops the sync, is logged with its message, and the error reaches the caller", () =>
  conDatos(async (datos) => {
    const almacen = almacenArchivos(datos);
    const caido = (async () => new Response("{}", { status: 500 })) as unknown as typeof fetch;
    const registros: RegistroSincronizacion[] = [];
    await assert.rejects(
      sincronizarBtcpay(almacen, { url: "https://btcpay.test", clave: "k", tiendas: [TIENDA], fetch: caido }, {
        ahora: AHORA,
        registrar: async (r) => {
          registros.push(r);
        },
      }),
      (e: unknown) => e instanceof ErrorLedger && /No se pudieron leer las facturas de la tienda TiendaPruebaCacao01/.test(e.message),
    );
    assert.equal(registros.length, 1);
    assert.match(registros[0]?.error ?? "", /TiendaPruebaCacao01/);
    assert.equal(registros[0]?.nuevas, 0);
  }));

test("a store that returns the full page is reported as truncated, so the caller knows older invoices were not read", () =>
  conDatos(async (datos) => {
    const almacen = almacenArchivos(datos);
    const grande = "TiendaGrandeCacao01";
    // Settled invoices with no Cacao metadata: each is omitted without writing, so the test stays fast.
    const base = facturasDelArchivo()[5]!;
    const muchas: Factura[] = Array.from({ length: LIMITE_FACTURAS_POR_TIENDA }, (_, i) => ({
      ...base,
      id: `FacturaGrande${String(i).padStart(4, "0")}`,
      storeId: grande,
    }));
    const { fetch } = fakeBtcpay({ [grande]: muchas });
    const r = await sincronizarBtcpay(almacen, { url: "https://btcpay.test", clave: "k", tiendas: [grande], fetch }, { ahora: AHORA });
    assert.deepEqual(r.tiendasTruncadas, [grande]);
    assert.equal(r.omitidas.length, LIMITE_FACTURAS_POR_TIENDA);
  }));

test("an empty store list is refused with a readable message", () =>
  conDatos(async (datos) => {
    await assert.rejects(
      sincronizarBtcpay(almacenArchivos(datos), { url: "https://btcpay.test", clave: "k", tiendas: [] }, { ahora: AHORA }),
      (e: unknown) => e instanceof ErrorLedger && /No hay tiendas/.test(e.message),
    );
  }));
