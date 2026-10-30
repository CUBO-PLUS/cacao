import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";

import { expect, test as setup } from "@playwright/test";

import { ARCHIVO_SESION_DUENA, ARCHIVO_SESION_VISITANTE, CODIGO_CLERK, CUENTA_DUENA, CUENTA_VISITANTE, sql } from "./base.ts";

// Signs in the two test accounts with Clerk's test code and keeps their sessions for the "dueno" project.
// The owner gets es_admin in the local database after her first sign-in (the row is linked by its verified
// email). The visitor is kept without it. Both accounts must exist in the Clerk development instance first:
// creating them needs a person at the sign-up bot check.

async function entrar(page: import("@playwright/test").Page, correo: string): Promise<void> {
  await page.goto("/entrar?volver=%2Ftickets");
  await page.getByLabel("Correo electrónico").fill(correo);
  await page.getByRole("button", { name: "Continuar", exact: true }).click();
  const codigo = page.locator('input[autocomplete="one-time-code"]');
  const noExiste = page.getByTestId("form-feedback-error");
  await expect(codigo.or(noExiste)).toBeVisible({ timeout: 30_000 });
  if (await noExiste.isVisible()) {
    throw new Error(
      `No existe la cuenta ${correo} en el Clerk de desarrollo. Crearla a mano en el panel de Clerk (Users) y volver a correr.`,
    );
  }
  await codigo.fill(CODIGO_CLERK);
  await expect(page).not.toHaveURL(/\/entrar/, { timeout: 60_000 });
}

setup("sesión de la dueña y del visitante", async ({ browser }) => {
  mkdirSync(path.dirname(ARCHIVO_SESION_DUENA), { recursive: true });

  const contextoDueno = await browser.newContext({ baseURL: process.env.LEDGER_URL ?? "http://localhost:4325", locale: "es-SV" });
  const pagDueno = await contextoDueno.newPage();
  await entrar(pagDueno, CUENTA_DUENA);
  // The first sign-in creates (or links) the row. Only then can the owner flag be set.
  sql(`update usuarios set es_admin = true where telefono = '${CUENTA_DUENA}'`);
  await contextoDueno.storageState({ path: ARCHIVO_SESION_DUENA });
  await contextoDueno.close();

  // The visitor account is optional for the owner tests: without it, only the visitor tests fail, with a clear message.
  const contextoVisitante = await browser.newContext({ baseURL: process.env.LEDGER_URL ?? "http://localhost:4325", locale: "es-SV" });
  try {
    const pagVisitante = await contextoVisitante.newPage();
    await entrar(pagVisitante, CUENTA_VISITANTE);
    sql(`update usuarios set es_admin = false where telefono = '${CUENTA_VISITANTE}'`);
    await contextoVisitante.storageState({ path: ARCHIVO_SESION_VISITANTE });
  } catch (e) {
    rmSync(ARCHIVO_SESION_VISITANTE, { force: true });
    console.warn(`Sin sesión de visitante: ${(e as Error).message}`);
  } finally {
    await contextoVisitante.close();
  }
});
