import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { almacenArchivos } from "./almacen/archivos.ts";
import type { AlmacenTickets } from "./almacen/tipos.ts";
import { leerFixture } from "./ayudas-prueba.ts";
import { leerFacturasArchivo } from "./btcpay.ts";
import type { Factura } from "./pagos/btcpay-api.ts";
import { sincronizarBtcpay } from "./sincronizar.ts";

// One invoice that fails to save must not stop the run: the others are imported and the bad one is listed as omitida.

const AHORA = new Date("2026-10-15T18:00:00.000Z");
const TIENDA = "TiendaPruebaCacao01";

function comoApi(f: Factura) {
  return {
    id: f.id,
    storeId: f.storeId,
    status: f.estado,
    amount: String(f.sats),
    expirationTime: Math.floor(f.expiraEn.getTime() / 1000),
    metadata: f.metadata,
  };
}

function fakeBtcpay(facturas: Factura[]): typeof fetch {
  return (async (entrada: string | URL | Request) => {
    const url = new URL(String(entrada));
    if (url.pathname.endsWith("/payment-methods")) {
      const partes = url.pathname.split("/");
      const factura = facturas.find((x) => x.id === partes[6]);
      if (!factura) return new Response("{}", { status: 404 });
      const pagos = factura.paymentHash ? [{ id: factura.paymentHash, status: "Settled" }] : [];
      return new Response(JSON.stringify([{ paymentMethodId: "BTC-LN", destination: factura.bolt11, payments: pagos }]), { status: 200 });
    }
    return new Response(JSON.stringify(facturas.map(comoApi)), { status: 200 });
  }) as typeof fetch;
}

test("a sale that fails to save is listed as omitida, and the rest of the run is imported", async () => {
  const datos = mkdtempSync(join(tmpdir(), "ledger-aislado-"));
  try {
    const facturas = leerFacturasArchivo(leerFixture("btcpay-facturas.json"));
    const malo = facturas.find((f) => f.estado === "Settled" && f.metadata?.producto === "media");
    assert.ok(malo, "the fixture has a settled media invoice");

    const real = almacenArchivos(datos);
    const almacen: AlmacenTickets = {
      ...real,
      async guardar(t) {
        if (t.origen?.numero === malo.id) throw new Error("Fallo simulado de la base al guardar esta venta.");
        return real.guardar(t);
      },
    };

    const r = await sincronizarBtcpay(almacen, { url: "https://btcpay.test", clave: "k", tiendas: [TIENDA], fetch: fakeBtcpay(facturas) }, { ahora: AHORA });
    assert.equal(r.nuevas, 3, "the other three settled invoices were imported");
    const omitida = r.omitidas.find((o) => o.factura === malo.id);
    assert.ok(omitida, "the failing invoice is listed");
    assert.match(omitida?.motivo ?? "", /Fallo simulado/);
  } finally {
    rmSync(datos, { recursive: true, force: true });
  }
});
