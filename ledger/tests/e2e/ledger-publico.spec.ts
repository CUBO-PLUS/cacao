import { expect, test } from "@playwright/test";

import { sql } from "./base.ts";

// Without a session: the public tablero shows totals only, and every owner page sends the visitor to sign-in.

const RUTAS_DUENO = ["/tickets", "/mes", "/mes/2026-10", "/mes/2026-10/csv/consumidor"];

test.describe("tablero público", () => {
  test("muestra cifras, sin ids de ticket ni datos de clientes", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Tablero", level: 1 })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Este mes" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Ventas por producto" })).toBeVisible();

    const texto = await page.locator("main").innerText();
    expect(texto).not.toMatch(/TK-\d{8}-[0-9A-F]{4}/);
    expect(texto).not.toMatch(/DTE-|NIT|NRC|Factura de BTCPay|Hash del pago/);

    // The sync line is generic: no cause and no run details for a visitor.
    const estado = page.getByRole("status").first();
    await expect(estado).toContainText(/sincroniz/i);
    await expect(estado).not.toContainText("Motivo");
    await expect(page.getByRole("button", { name: "Sincronizar ahora" })).toHaveCount(0);

    // Only the sign-in link, no owner links.
    await expect(page.getByRole("link", { name: "Entrar" })).toHaveAttribute("href", "/entrar");
    await expect(page.getByRole("link", { name: "Tickets", exact: true })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Mes", exact: true })).toHaveCount(0);
  });
});

test.describe("páginas del dueño sin sesión", () => {
  for (const ruta of RUTAS_DUENO) {
    test(`${ruta} lleva a entrar y no muestra datos`, async ({ page }) => {
      await page.goto(ruta);
      await page.waitForURL(/\/entrar/, { timeout: 30_000 });
      const texto = await page.locator("body").innerText();
      expect(texto).not.toMatch(/TK-\d{8}-[0-9A-F]{4}/);
      expect(texto).not.toContain("Libro de ventas");
      expect(texto).not.toContain("Cifras para las declaraciones");
    });
  }

  test("el ticket lleva a entrar y no muestra su documento", async ({ page }) => {
    const id = sql("select id from ledger_tickets order by creado_en desc limit 1");
    await page.goto(`/tickets/${id}`);
    await page.waitForURL(/\/entrar/, { timeout: 30_000 });
    const texto = await page.locator("body").innerText();
    expect(texto).not.toContain(id);
    expect(texto).not.toContain("Documento tributario");
  });

  test("el JSON y el CSV responden 303 a entrar, sin el archivo", async ({ request }) => {
    const id = sql("select id from ledger_tickets order by creado_en desc limit 1");
    for (const ruta of [`/tickets/${id}/json`, "/mes/2026-10/csv/consumidor", "/mes/2026-10/csv/anexo1"]) {
      const r = await request.get(ruta, { maxRedirects: 0 });
      expect(r.status(), ruta).toBe(303);
      expect(r.headers()["location"], ruta).toContain("/entrar");
      expect(r.headers()["content-disposition"], ruta).toBeUndefined();
    }
  });
});

test.describe("entrar", () => {
  test("la pantalla de entrar está centrada y tiene un solo título", async ({ page }) => {
    await page.goto("/entrar");
    const titulo = page.getByRole("heading", { name: "Entrá a tu cuenta", level: 1 });
    await expect(titulo).toBeVisible();
    // Clerk's own title is hidden in the appearance settings: the page title is the only one.
    await expect(page.getByText("Entrá a tu cuenta")).toHaveCount(1);

    const caja = await titulo.boundingBox();
    const ancho = page.viewportSize()?.width ?? 375;
    expect(caja).not.toBeNull();
    const centro = (caja?.x ?? 0) + (caja?.width ?? 0) / 2;
    expect(Math.abs(centro - ancho / 2)).toBeLessThan(8);
  });

  test("entrar y registrarse no tienen desbordamiento horizontal a 375 px", async ({ page }) => {
    for (const ruta of ["/", "/entrar", "/registrarse"]) {
      await page.goto(ruta);
      const desborda = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
      expect(desborda, ruta).toBe(false);
    }
  });
});
