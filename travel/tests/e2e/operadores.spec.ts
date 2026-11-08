import { expect, test, type Page } from '@playwright/test';

// The operator panel sits behind Clerk. The test account is an existing one on the Clerk development
// instance: its sign-in code is always 424242 there. Sign-up is not automated (it needs a human check).
const CUENTA = process.env.TRAVEL_CUENTA_QA ?? 'remitente+clerk_test@example.com';
const CODIGO = '424242';

/** Signs in through /entrar/ with the email code and waits for the operator panel. */
async function entrar(page: Page): Promise<void> {
  await page.goto('/entrar/');
  await page.locator('input[name="identifier"]').fill(CUENTA);
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  await page.locator('input[autocomplete="one-time-code"]').fill(CODIGO);
  // Clerk sends the operator to /operadores (no slash). The local dev server answers that with a 404 because
  // trailingSlash is "always" (vercel.json redirects it in production), so the test goes to the slash form.
  await page.waitForURL((url) => url.pathname.startsWith('/operadores'), { timeout: 60_000, waitUntil: 'commit' });
  if (!page.url().endsWith('/operadores/')) await page.goto('/operadores/');
}

test('/operadores sin sesión muestra la explicación pública y el panel no aparece', async ({ page }) => {
  await page.goto('/operadores/');
  await expect(page.getByRole('heading', { name: 'Llevá tu experiencia a Cacao Travel', level: 1 })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Entrar a tu panel' }).first()).toHaveAttribute('href', '/entrar/');
  await expect(page.locator('[data-form]')).toHaveCount(0);
});

test('/entrar/ muestra un solo título visible, centrado', async ({ page }) => {
  await page.goto('/entrar/');
  await expect(page.locator('input[name="identifier"]')).toBeVisible({ timeout: 30_000 });
  const visibles = page.locator('h1:visible');
  await expect(visibles).toHaveCount(1);
  await expect(visibles).toHaveText('Entrá a tu panel');
  const caja = await page.locator('.cl-rootBox').boundingBox();
  const pagina = page.viewportSize()!;
  expect(caja).not.toBeNull();
  // The Clerk card is centered in the viewport, within a pixel.
  expect(Math.abs(caja!.x + caja!.width / 2 - pagina.width / 2)).toBeLessThan(2);
});

test('con sesión el panel de operadores se muestra', async ({ page }) => {
  test.setTimeout(120_000);
  await entrar(page);
  await expect(page.getByRole('heading', { name: 'Publicá tu experiencia', level: 1 })).toBeVisible();
  await expect(page.locator('[data-form]')).toBeVisible();
  // A signed-in visitor on /entrar/ goes straight to the panel.
  await page.goto('/entrar/');
  await expect(page).toHaveURL(/\/operadores\/?$/);
});
