import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { importarFacturaBtcpay, leerFacturasArchivo } from "./btcpay.ts";
import { AHORA, leerFixture } from "./ayudas-prueba.ts";
import { raizLedger } from "./datos.ts";
import { importarOrdenMarket } from "./market.ts";
import { almacenArchivos } from "./almacen/archivos.ts";
import { leerTicket, listarTickets, type Ticket } from "./ticket.ts";
import type { Factura } from "./pagos/btcpay-api.ts";

const CLI = join(raizLedger(), "src", "cli.ts");

function facturas(): Factura[] {
  return leerFacturasArchivo(leerFixture("btcpay-facturas.json"));
}

function factura(id: string): Factura {
  const f = facturas().find((x) => x.id === id);
  assert.ok(f, `fixture has ${id}`);
  return f;
}

async function conDatos(fn: (datos: string) => Promise<void>): Promise<void> {
  const datos = mkdtempSync(join(tmpdir(), "ledger-btcpay-"));
  try {
    await fn(datos);
  } finally {
    rmSync(datos, { recursive: true, force: true });
  }
}

// Runs the CLI with the BTCPay variables removed unless the test sets them.
function ledger(datos: string, args: string[], extra: Record<string, string> = {}) {
  const env: Record<string, string | undefined> = { ...process.env, LEDGER_AHORA: "2026-10-12T18:25:00Z", LEDGER_SEMILLA: "pruebas-btcpay", ...extra };
  for (const clave of ["LEDGER_BTCPAY_URL", "LEDGER_BTCPAY_API_KEY", "LEDGER_BTCPAY_TIENDAS"]) {
    if (!(clave in extra)) delete env[clave];
  }
  const r = spawnSync(process.execPath, [CLI, ...args, "--datos", datos], { encoding: "utf8", cwd: raizLedger(), env: env as NodeJS.ProcessEnv });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

function pagado(t: Ticket) {
  assert.equal(t.estado, "pagado");
  assert.equal(t.pago?.rail, "lightning");
  return t.pago?.rail === "lightning" ? t.pago : null;
}

test("a settled media invoice becomes a paid consumer ticket with its total, sats and payment hash", async () => {
  await conDatos(async (datos) => {
    const f = factura("BtcpayMedia0001Fx");
    const r = await importarFacturaBtcpay(almacenArchivos(datos), f, AHORA);
    assert.ok("ticket" in r);
    assert.equal(r.nueva, true);
    const t = r.ticket;
    assert.equal(t.cliente, "consumidor");
    assert.equal(t.lineas.length, 1);
    assert.deepEqual(t.lineas[0], { descripcion: "Historia: El cacao de Izalco", cantidad: 1, precioCentavos: 450 });
    assert.deepEqual(t.origen, { plataforma: "btcpay", producto: "media", numero: "BtcpayMedia0001Fx" });
    const p = pagado(t);
    assert.equal(p?.montoCentavos, 450);
    assert.equal(p?.sats, 12183);
    assert.equal(p?.tasaUsdPorBtc, "36940.18");
    assert.equal(p?.tasaFuente, "btcpay");
    assert.equal(p?.paymentHash, f.paymentHash);
    assert.equal(leerTicket(datos, t.id).origen?.numero, "BtcpayMedia0001Fx", "the invoice id is kept on the ticket");
  });
});

test("importing the same invoice twice is idempotent", async () => {
  await conDatos(async (datos) => {
    const primera = await importarFacturaBtcpay(almacenArchivos(datos), factura("BtcpayMedia0001Fx"), AHORA);
    const segunda = await importarFacturaBtcpay(almacenArchivos(datos), factura("BtcpayMedia0001Fx"), AHORA);
    assert.ok("ticket" in primera && "ticket" in segunda);
    assert.equal(primera.nueva, true);
    assert.equal(segunda.nueva, false);
    assert.equal(segunda.ticket.id, primera.ticket.id);
    assert.equal(listarTickets(datos).length, 1);
  });
});

test("a factura that is not Settled, or lacks Cacao metadata, is omitted with its reason", async () => {
  await conDatos(async (datos) => {
    const nueva = await importarFacturaBtcpay(almacenArchivos(datos), factura("BtcpayNuevo0005Fx"), AHORA);
    assert.deepEqual(nueva, { omitida: "la factura no está pagada (estado New)" });
    const sinMeta = await importarFacturaBtcpay(almacenArchivos(datos), factura("BtcpaySinMeta0006Fx"), AHORA);
    assert.ok("omitida" in sinMeta);
    assert.match(sinMeta.omitida, /metadata\.producto|producto de Cacao/);
    const sinDesc = { ...factura("BtcpayMedia0001Fx"), metadata: { ...factura("BtcpayMedia0001Fx").metadata, itemDesc: "   " } };
    assert.deepEqual(await importarFacturaBtcpay(almacenArchivos(datos), sinDesc, AHORA), { omitida: "la factura no trae metadata.itemDesc" });
    assert.equal(listarTickets(datos).length, 0);
  });
});

test("a market invoice whose order already came from CacaoMarket is a duplicate", async () => {
  await conDatos(async (datos) => {
    importarOrdenMarket(datos, leerFixture("market-orden-1042.json"), AHORA);
    const cobro = { ...factura("BtcpayMarket0003Fx"), metadata: { ...factura("BtcpayMarket0003Fx").metadata, orderId: "1042" } };
    const r = await importarFacturaBtcpay(almacenArchivos(datos), cobro, AHORA);
    assert.ok("omitida" in r);
    assert.match(r.omitida, /^ya importada desde CacaoMarket \(ticket TK-/);
    assert.equal(listarTickets(datos).length, 1);
  });
});

test("an invoice whose payment hash already settles another ticket is omitted", async () => {
  await conDatos(async (datos) => {
    importarOrdenMarket(datos, leerFixture("market-orden-1042.json"), AHORA);
    const otra = { ...factura("BtcpayPay0004Fx"), paymentHash: "6cceee99be38297f789659390dd3f6f042be99fffd2036287a77a99e980436e0" };
    const r = await importarFacturaBtcpay(almacenArchivos(datos), otra, AHORA);
    assert.ok("omitida" in r);
    assert.match(r.omitida, /ese pago ya cubre el ticket TK-/);
  });
});

test("the CLI reads the offline file, prints one line per invoice and a total, and is idempotent", async () => {
  await conDatos(async (datos) => {
    const archivo = join("fixtures", "btcpay-facturas.json");
    const primera = ledger(datos, ["importar", "btcpay", "--archivo", archivo]);
    assert.equal(primera.code, 0, primera.err);
    assert.match(primera.out, /TK-\d{8}-[0-9A-F]{4} factura BtcpayMedia0001Fx nueva/);
    assert.match(primera.out, /omitida: la factura no está pagada \(estado New\) \(factura BtcpayNuevo0005Fx\)/);
    assert.match(primera.out, /Nuevas: 4\. Repetidas: 0\. Omitidas: 2\./);
    assert.equal(listarTickets(datos).length, 4);

    const segunda = ledger(datos, ["importar", "btcpay", "--archivo", archivo]);
    assert.equal(segunda.code, 0, segunda.err);
    assert.match(segunda.out, /Nuevas: 0\. Repetidas: 4\. Omitidas: 2\./);
    assert.equal(listarTickets(datos).length, 4);

    const json = ledger(datos, ["importar", "btcpay", "--archivo", archivo, "--json"]);
    const resumen = JSON.parse(json.out) as { nuevas: number; repetidas: number; omitidas: number };
    assert.deepEqual([resumen.nuevas, resumen.repetidas, resumen.omitidas], [0, 4, 2]);
  });
});

test("without the BTCPay settings the CLI says which are missing and exits with code 2", async () => {
  await conDatos(async (datos) => {
    const r = ledger(datos, ["importar", "btcpay"]);
    assert.equal(r.code, 2);
    assert.match(r.err, /faltan variables de entorno para BTCPay: LEDGER_BTCPAY_URL, LEDGER_BTCPAY_API_KEY, LEDGER_BTCPAY_TIENDAS/);
  });
});

test("--desde cannot be combined with --archivo", async () => {
  await conDatos(async (datos) => {
    const r = ledger(datos, ["importar", "btcpay", "--archivo", join("fixtures", "btcpay-facturas.json"), "--desde", "2026-10-01"]);
    assert.equal(r.code, 1);
    assert.match(r.err, /--desde no se usa con --archivo/);
  });
});
