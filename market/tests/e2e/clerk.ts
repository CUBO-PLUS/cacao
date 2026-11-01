import { type Browser, type BrowserContext, type Page, expect } from '@playwright/test';

import { OPCIONES_CONTEXTO, servicio } from './ayuda';

// Shared by the specs that sign in with Clerk test accounts. The local dev instance accepts code 424242
// for these addresses; sign-up is behind Turnstile, so the accounts are made once by hand.
export const CUENTAS = {
  comprador: 'remitente-qa+clerk_test@example.com',
  admin: 'admin-qa+clerk_test@example.com',
} as const;
export type Cuenta = keyof typeof CUENTAS;

// The shop the flows buy from. CAFETAL_ID picks another shop of the local database.
export const CAFETAL = process.env.CAFETAL_ID ?? '30ef3fdd-07ec-4afc-a165-2376f49c504f';
export const BILLETERA = 'http://127.0.0.1:8088/billetera/api/pagar';
const UUID = /\/ordenes\/([0-9a-f-]{36})/i;

/** Signs a Clerk test account in on /entrar. Returns on the page the sign-in leaves. */
export async function entrarComo(pagina: Page, cuenta: Cuenta): Promise<void> {
  await pagina.goto('/entrar');
  const campo = pagina.locator('input[name=identifier]');
  // The Clerk widget sometimes finishes loading late; one reload covers that before the test gives up.
  if (!(await campo.isVisible({ timeout: 45_000 }).catch(() => false))) {
    await pagina.reload();
  }
  await expect(campo).toBeVisible({ timeout: 60_000 });
  await campo.fill(CUENTAS[cuenta]);
  await pagina.getByRole('button', { name: 'Continuar', exact: true }).click();

  const codigo = pagina.locator('input[autocomplete="one-time-code"], input[name=code]');
  const noExiste = pagina.getByText('No se encontró una cuenta').first();
  await expect(codigo.or(noExiste)).toBeVisible({ timeout: 30_000 });
  if (await noExiste.isVisible()) {
    throw new Error(`La cuenta de prueba ${CUENTAS[cuenta]} no existe en Clerk. Creala una vez a mano en /registrarse (código 424242).`);
  }
  // Clerk rejects a code typed before its own send finishes, so the field gets a moment first.
  await pagina.waitForTimeout(2000);
  await codigo.fill('424242');
  const continuar = pagina.getByRole('button', { name: 'Continuar', exact: true });
  if (await continuar.isVisible()) await continuar.click();
  await expect(pagina).not.toHaveURL(/\/(entrar|registrarse)/, { timeout: 60_000 });
}

/** A fresh browser context signed in as the account. The caller closes the context. */
export async function contextoComo(browser: Browser, cuenta: Cuenta): Promise<{ contexto: BrowserContext; pagina: Page }> {
  const contexto = await browser.newContext(OPCIONES_CONTEXTO);
  const pagina = await contexto.newPage();
  await entrarComo(pagina, cuenta);
  await ponerNombre(pagina, cuenta === 'comprador' ? 'Comprador QA' : 'Admin QA');
  return { contexto, pagina };
}

/** A new account has no name yet: /cuenta asks for it before the rest of the flow. */
export async function ponerNombre(pagina: Page, nombre: string): Promise<void> {
  await pagina.goto('/cuenta');
  await expect(pagina.getByRole('heading', { name: 'Tu cuenta' })).toBeVisible({ timeout: 60_000 });
  const campo = pagina.locator('#nombre').first();
  await expect(campo).toBeVisible({ timeout: 60_000 });
  if ((await campo.inputValue()).trim() !== '') return;
  await campo.fill(nombre);
  await pagina.getByRole('button', { name: 'Guardar nombre' }).click();
  await expect(pagina.getByRole('button', { name: 'Guardar nombre' })).toBeEnabled({ timeout: 30_000 });
}

/** The usuarios id of a Clerk test account: its row is keyed by the sign-in address. */
export async function idDeCuenta(cuenta: Cuenta): Promise<string> {
  const { data, error } = await servicio().from('usuarios').select('id').eq('telefono', CUENTAS[cuenta]).single();
  if (error || !data) throw new Error(`No encontré al usuario ${CUENTAS[cuenta]}: ${error?.message}`);
  return data.id as string;
}

/** A product of the Cafetal shop, made for one run so earlier runs cannot change its stock. */
export async function productoDePrueba(nombre: string, stock: number, precio = 1100): Promise<string> {
  const cliente = servicio();
  const { data: negocio, error: errorNegocio } = await cliente.from('negocios').select('usuario_id').eq('id', CAFETAL).single();
  if (errorNegocio) throw errorNegocio;
  const { data: categoria, error: errorCategoria } = await cliente.from('categorias').select('id').order('id').limit(1).single();
  if (errorCategoria) throw errorCategoria;
  const { data, error } = await cliente.rpc('guardar_producto', {
    p_usuario: negocio.usuario_id,
    p_producto: null,
    p_categoria: categoria.id,
    p_nombre: `${nombre} ${Date.now()}`,
    p_descripcion: 'Producto de prueba de los flujos E2E.',
    p_unidad: 'libra',
    p_precio: precio,
    p_stock: stock,
    p_activo: true,
    p_fotos: [],
  });
  if (error) throw new Error(error.message);
  return data.id as string;
}

/** Adds the product to the cart and places the order from the cart. Leaves the page on the payment screen. */
export async function hacerPedido(pagina: Page, productoId: string, cantidad = 1): Promise<string> {
  await pagina.goto(`/productos/${productoId}`);
  for (let i = 1; i < cantidad; i += 1) {
    await pagina.getByRole('button', { name: 'Sumar una unidad' }).click();
  }
  await pagina.getByRole('button', { name: 'Agregar al carrito' }).click();
  await expect(pagina.getByText(/^Listo: agregaste/)).toBeVisible();
  await pagina.goto('/carrito');
  const pedir = pagina.getByRole('button', { name: 'Hacer pedido' });
  await expect(pedir).toBeEnabled({ timeout: 60_000 });
  await pedir.click();
  await expect(pagina).toHaveURL(/\/ordenes\/[0-9a-f-]{36}\/pagar\/?$/, { timeout: 60_000 });
  const id = UUID.exec(pagina.url())?.[1];
  if (!id) throw new Error(`Sin id de orden en ${pagina.url()}`);
  return id;
}

/** Reads the BTCPay invoice the payment screen shows (lnbcrt... on regtest). */
export async function facturaEnPantalla(pagina: Page): Promise<string> {
  const factura = pagina.locator('#campo-factura');
  await expect(factura).toBeVisible({ timeout: 60_000 });
  await expect.poll(async () => factura.inputValue(), { timeout: 60_000 }).toMatch(/^lnbcrt/);
  return factura.inputValue();
}

/** Pays a BTCPay invoice with the regtest test wallet, as the link on the payment screen does. */
export async function pagarEnBilletera(factura: string): Promise<void> {
  const respuesta = await fetch(BILLETERA, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ factura }),
  });
  expect(respuesta.ok, `La billetera de prueba respondió ${respuesta.status}`).toBe(true);
  const cuerpo = (await respuesta.json()) as { pagada?: boolean };
  expect(cuerpo.pagada).toBe(true);
}

/**
 * Arranges a paid product order without the browser: the order is placed for the buyer and paid by the
 * system with the fake provider. Used by specs that check screens after the payment, not the payment itself.
 */
export async function pedidoPagadoDirecto(cuentaComprador: Cuenta, productoId: string, cantidad = 1): Promise<string> {
  const cliente = servicio();
  const comprador = await idDeCuenta(cuentaComprador);
  const { data, error } = await cliente.rpc('crear_orden', {
    p_comprador: comprador,
    p_negocio: CAFETAL,
    p_lineas: [{ producto_id: productoId, cantidad }],
    p_modo: 'recogida',
    p_clave: `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    p_cotizacion: 100000,
  });
  if (error) throw new Error(error.message);
  const ordenId = data.id as string;
  const { error: errorCobro } = await cliente.rpc('registrar_cobro', {
    p_orden: ordenId,
    p_proveedor: 'falso',
    p_referencia: `e2e-${ordenId}`,
    p_bolt11: null,
    p_destino: null,
    p_verificar_url: null,
    p_expira_en: new Date(Date.now() + 600_000).toISOString(),
  });
  if (errorCobro) throw new Error(errorCobro.message);
  const { error: errorPago } = await cliente.rpc('confirmar_pago', { p_orden: ordenId, p_actor: null });
  if (errorPago) throw new Error(errorPago.message);
  return ordenId;
}

/** The funnel cookie the browser keeps for one visit (HttpOnly, so only the browser context can read it). */
export async function sesionDeContexto(contexto: BrowserContext): Promise<string | null> {
  const cookie = (await contexto.cookies()).find((c) => c.name === 'cm_sesion');
  return cookie?.value ?? null;
}
