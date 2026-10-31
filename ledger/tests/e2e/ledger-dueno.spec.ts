import { existsSync } from "node:fs";

import { expect, test } from "@playwright/test";

import { formatoUsd } from "../../src/dinero.ts";
import { ARCHIVO_SESION_DUENA, ARCHIVO_SESION_VISITANTE, CUENTA_VISITANTE, mesActual, sql } from "./base.ts";

// Signed in as the owner (es_admin) and as a second, non-admin account. The sessions come from sesion.setup.ts.
// The pagination test inserts CANTIDAD_PRUEBA tickets with the same creation instant and removes them afterwards.
const CANTIDAD_PRUEBA = 55;
const MARCA_PRUEBA = "prueba de paginación";

// ---------------------------------------------------------------- visitante sin acceso
test.describe("visitante que no es dueño", () => {
  test.use({ storageState: ARCHIVO_SESION_VISITANTE });

  test.beforeAll(() => {
    if (!existsSync(ARCHIVO_SESION_VISITANTE)) {
      throw new Error(`Falta la sesión de ${CUENTA_VISITANTE}. Crear la cuenta en el Clerk de desarrollo y volver a correr.`);
    }
  });

  test("ve la negativa, sin datos, y sin enlaces del dueño", async ({ page }) => {
    await page.goto("/tickets");
    await expect(page.getByText("Esta cuenta no tiene acceso al libro de Grupo Cacao.")).toBeVisible();
    const texto = await page.locator("main").innerText();
    expect(texto).not.toMatch(/TK-\d{8}-[0-9A-F]{4}/);
    await expect(page.getByRole("link", { name: "Tickets", exact: true })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Mes", exact: true })).toHaveCount(0);
    // Signed in, so the account button replaces "Entrar".
    await expect(page.locator(".nav-usuario button").first()).toBeVisible();
    await expect(page.getByRole("link", { name: "Entrar" })).toHaveCount(0);
  });

  test("el CSV y el JSON responden 403 sin archivo", async ({ page }) => {
    // A page visit first: Clerk refreshes the stored session on navigation, not on a bare API call.
    await page.goto("/");
    const id = sql("select ticket_id from ledger_dtes where estado = 'aceptado' limit 1");
    for (const ruta of [`/tickets/${id}/json`, `/mes/${mesActual()}/csv/consumidor`]) {
      const r = await page.request.get(ruta, { maxRedirects: 0 });
      expect(r.status(), ruta).toBe(403);
      expect(r.headers()["content-disposition"], ruta).toBeUndefined();
    }
  });
});

// ---------------------------------------------------------------- dueño
test.describe("dueño", () => {
  test.use({ storageState: ARCHIVO_SESION_DUENA });

  test.beforeAll(() => {
    sql(
      "insert into ledger_tickets (id, creado_en, estado, cliente, total_centavos, buscar, datos) " +
        "select 'TK-20990101-' || upper(lpad(to_hex(n), 4, '0')), '2099-01-01T12:00:00Z', 'abierto', 'consumidor', 100, " +
        `'${MARCA_PRUEBA} ' || lpad(to_hex(n), 4, '0'), ` +
        "jsonb_build_object('id', 'TK-20990101-' || upper(lpad(to_hex(n), 4, '0')), 'creado', '2099-01-01T12:00:00.000Z', " +
        "'actualizado', '2099-01-01T12:00:00.000Z', 'estado', 'abierto', 'cliente', 'consumidor', 'receptor', null, " +
        `'lineas', jsonb_build_array(jsonb_build_object('descripcion', '${MARCA_PRUEBA}', 'cantidad', 1, 'precioCentavos', 100)), ` +
        "'pago', null, 'dte', null, 'firma', null, 'sello', null, 'rechazo', null) " +
        `from generate_series(1, ${CANTIDAD_PRUEBA}) n on conflict (id) do nothing`,
    );
  });

  test.afterAll(() => {
    sql("delete from ledger_tickets where id like 'TK-20990101-%'");
  });

  test("tablero con enlaces y cuenta", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("link", { name: "Tickets", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Mes", exact: true })).toBeVisible();
    await expect(page.locator(".nav-usuario button").first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Sincronizar ahora" })).toBeVisible();
  });

  test("sincronizar ahora actualiza la línea y no duplica corridas", async ({ page }) => {
    await page.goto("/");
    // The page itself may start a run on load, so the check is on overlaps: two runs that overlap in time are a duplicate.
    const desde = sql("select now()::text");
    const boton = page.getByRole("button", { name: "Sincronizar ahora" });
    // Two clicks in a row: the throttle and the lease allow one run, so the second gets "Ya estaba" or "en curso".
    await boton.click();
    await boton.click({ force: true });
    await expect(boton).toBeEnabled({ timeout: 60_000 });
    const linea = page.locator("form.sincronizar p[role=status]");
    await expect(linea).toHaveText(/Listo|Ya estaba|Ya hay una sincronización|No se pudo/, { timeout: 60_000 });
    const solapadas = Number(
      sql(
        "select count(*) from ledger_sincronizaciones a join ledger_sincronizaciones b on a.id < b.id " +
          `where a.empezo >= '${desde}' and b.empezo >= '${desde}' ` +
          "and a.empezo < coalesce(b.termino, now()) and b.empezo < coalesce(a.termino, now())",
      ),
    );
    expect(solapadas).toBe(0);
  });

  test("filtros de producto, estado, fechas y búsqueda", async ({ page }) => {
    await page.goto("/tickets?producto=media");
    await expect(page.locator("table tbody tr").first()).toBeVisible();
    for (const celda of await page.locator("table tbody tr td:nth-child(3)").allInnerTexts()) {
      expect(celda.trim()).toBe("Media");
    }

    await expect(page.getByPlaceholder("Ticket, factura o descripción")).toBeVisible();

    await page.goto("/tickets?estado=emitido");
    for (const chip of await page.locator("table tbody .chip").allInnerTexts()) {
      expect(chip.trim()).toBe("emitido");
    }

    const dia = sql(
      "select to_char(creado_en at time zone 'America/El_Salvador', 'YYYY-MM-DD') from ledger_tickets where estado = 'emitido' order by creado_en desc limit 1",
    );
    await page.goto(`/tickets?desde=${dia}&hasta=${dia}`);
    const fechas = await page.locator("table tbody tr td:nth-child(2)").allInnerTexts();
    expect(fechas.length).toBeGreaterThan(0);
    for (const f of fechas) expect(f.startsWith(dia)).toBe(true);

    const id = sql("select id from ledger_tickets where estado = 'emitido' order by creado_en desc limit 1");
    await page.goto(`/tickets?q=${id}`);
    await expect(page.locator("table tbody tr")).toHaveCount(1);
    await expect(page.getByRole("link", { name: id.slice(0, 10) })).toBeVisible();
  });

  test("ver más pagina sin repetir ni saltar tickets", async ({ page }) => {
    await page.goto(`/tickets?q=${encodeURIComponent(MARCA_PRUEBA)}`);
    const primera = await page.locator("table tbody tr td:first-child a").allInnerTexts();
    expect(primera).toHaveLength(50);
    await page.getByRole("link", { name: "Ver más" }).click();
    await expect(page).toHaveURL(/despuesId=/, { timeout: 30_000 });
    const segunda = await page.locator("table tbody tr td:first-child a").allInnerTexts();
    expect(segunda).toHaveLength(CANTIDAD_PRUEBA - 50);
    expect(new Set([...primera, ...segunda]).size).toBe(CANTIDAD_PRUEBA);
  });

  test("detalle del documento emitido: número, sello, QR, imprimir y JSON", async ({ page }) => {
    const fila = sql(
      "select ticket_id, numero_control, sello, documento::text from ledger_dtes where estado = 'aceptado' order by creado_en desc limit 1",
    ).split("\t");
    const [ticketId, numeroControl, sello, documentoTexto] = fila as [string, string, string, string];

    await page.goto(`/tickets/${ticketId}`);
    await expect(page.getByText(numeroControl).first()).toBeVisible();
    await expect(page.getByText(sello).first()).toBeVisible();
    await expect(page.getByText("El sello es simulado").first()).toBeVisible();
    await expect(page.locator(".qr svg")).toHaveCount(1);
    await expect(page.getByRole("button", { name: "Imprimir" })).toBeVisible();

    await expect(page.getByRole("link", { name: "Descargar JSON" })).toHaveAttribute("href", `/tickets/${ticketId}/json`);
    const r = await page.request.get(`/tickets/${ticketId}/json`);
    expect(r.status()).toBe(200);
    expect(r.headers()["content-disposition"]).toContain(`${numeroControl}.json`);
    const recibido = await r.json();
    const guardado = JSON.parse(documentoTexto);
    // Same document as the row: compare the canonical text, so a key order difference cannot hide a real one.
    expect(JSON.stringify(recibido, Object.keys(guardado).sort())).toEqual(JSON.stringify(guardado, Object.keys(guardado).sort()));
    expect(recibido).toEqual(guardado);
  });

  test("/mes cifras, descargas y selector de mes", async ({ page }) => {
    const mes = mesActual();
    await page.goto("/mes");
    await expect(page).toHaveURL(new RegExp(`/mes/${mes}$`), { timeout: 30_000 });

    // Consumer book: the count and the IVA-included sum of this month's accepted 01 documents.
    const total = sql(
      "select count(*), coalesce(sum(t.total_centavos), 0) from ledger_tickets t join ledger_dtes d on d.ticket_id = t.id " +
        `where d.tipo_dte = '01' and d.estado = 'aceptado' and to_char(t.pagado_en at time zone 'America/El_Salvador', 'YYYY-MM') = '${mes}'`,
    ).split("\t");
    if (Number(total[0]) > 0) {
      const libroConsumidor = page.locator("section[aria-labelledby=titulo-consumidor]");
      await expect(libroConsumidor.getByText(`Total del mes: ${total[0]} documento`)).toBeVisible();
      await expect(libroConsumidor.getByText(formatoUsd(Number(total[1])), { exact: true }).first()).toBeVisible();
    }

    for (const libro of ["consumidor", "contribuyentes", "anexo1", "anexo2"]) {
      const r = await page.request.get(`/mes/${mes}/csv/${libro}`);
      expect(r.status(), libro).toBe(200);
      expect(r.headers()["content-type"], libro).toContain("text/csv");
      expect(r.headers()["content-disposition"], libro).toContain(".csv");
      // The two libros carry a UTF-8 BOM for spreadsheets; the F-07 anexos are headerless DGII files without it.
      if (libro === "consumidor" || libro === "contribuyentes") {
        expect((await r.body()).subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]));
      }
    }

    await page.getByRole("link", { name: /←/ }).click();
    await expect(page).not.toHaveURL(new RegExp(`/mes/${mes}$`), { timeout: 30_000 });
  });

  test("375 px sin desbordamiento horizontal", async ({ page }) => {
    const id = sql("select ticket_id from ledger_dtes where estado = 'aceptado' limit 1");
    for (const ruta of ["/", "/tickets", `/tickets/${id}`]) {
      await page.goto(ruta);
      const desborda = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
      expect(desborda, ruta).toBe(false);
    }
  });
});
