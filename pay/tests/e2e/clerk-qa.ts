import { existsSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { type Browser, type BrowserContext, type Page, expect } from '@playwright/test';

// Clerk test accounts on the development instance. Addresses with "+clerk_test" accept the code 424242
// and never send mail. Sign-up runs Clerk's bot check, which only passes in a headed browser, so the
// spec files set `headless: false`.
// Existing accounts only: sign-up runs Clerk's Turnstile bot check, which automation must not pass.
export const CORREOS = {
  remitente: 'remitente+clerk_test@example.com',
  remitenteQa: 'remitente-qa+clerk_test@example.com',
  destinatario: 'destinatario-qa+clerk_test@example.com',
  admin: 'admin-qa+clerk_test@example.com',
} as const;

export type Cuenta = keyof typeof CORREOS;

export const OPCIONES_CONTEXTO = {
  baseURL: process.env.PAY_URL ?? 'http://localhost:4324',
  viewport: { width: 375, height: 800 },
  locale: 'es-SV',
  timezoneId: 'America/El_Salvador',
} as const;

// Saved sessions for the test accounts, kept outside the repository.
const CARPETA = path.join(os.tmpdir(), 'cacaopay-e2e-clerk');

function sinSesion(pagina: Page): boolean {
  return /\/entrar|\/registrarse/.test(new URL(pagina.url()).pathname);
}

/** A browser context signed in as one of the test accounts, reusing the saved session when it still works. */
export async function contextoDe(browser: Browser, cuenta: Cuenta): Promise<BrowserContext> {
  const archivo = path.join(CARPETA, `${cuenta}.json`);
  if (existsSync(archivo)) {
    const guardado = await browser.newContext({ ...OPCIONES_CONTEXTO, storageState: archivo });
    const pagina = await guardado.newPage();
    await pagina.goto('/cuenta');
    if (!sinSesion(pagina)) return guardado;
    await guardado.close();
  }

  const contexto = await browser.newContext(OPCIONES_CONTEXTO);
  const pagina = await contexto.newPage();
  await entrar(pagina, CORREOS[cuenta]);
  mkdirSync(CARPETA, { recursive: true });
  await contexto.storageState({ path: archivo });
  return contexto;
}

// Signs in with an existing account by email code (424242). Never signs up.
async function entrar(pagina: Page, correo: string): Promise<void> {
  await pagina.goto('/entrar', { waitUntil: 'domcontentloaded' });
  await pagina.getByLabel('Correo electrónico').waitFor({ timeout: 60_000 });
  await pagina.getByLabel('Correo electrónico').fill(correo);
  await pagina.getByRole('button', { name: 'Continuar', exact: true }).click();

  const codigo = pagina.getByLabel(/código de verificación|verification code/i);
  const sinCuenta = pagina.getByText('No se encontró una cuenta').first();
  await expect(codigo.or(sinCuenta)).toBeVisible({ timeout: 60_000 });
  if (await sinCuenta.isVisible()) throw new Error(`La cuenta ${correo} no existe en Clerk todavía.`);

  await codigo.click();
  await codigo.pressSequentially('424242', { delay: 120 });
  // The code may submit by itself once six digits are in; otherwise the button sends it.
  await pagina.waitForURL((url) => !/factor-one|verify-email|verify-phone/.test(url.pathname), { timeout: 5_000 }).catch(() => {});
  const continuar = pagina.getByRole('button', { name: 'Continuar', exact: true });
  if (await continuar.isVisible().catch(() => false)) await continuar.click();

  await expect(pagina).not.toHaveURL(/\/entrar|\/registrarse/, { timeout: 60_000 });
}
