import { type Browser, type BrowserContext, type Page, expect, test } from '@playwright/test';

import { OPCIONES_CONTEXTO, seDesborda, servicio } from './ayuda';

// End-to-end purchase with a real BTCPay invoice on the local regtest stack (http://127.0.0.1:8088).
// Clerk test accounts sign in with code 424242 on localhost. Run with the local env file:
//   node --use-system-ca --env-file=.env.local node_modules/@playwright/test/cli.js test tests/e2e/btcpay-flujo.spec.ts
// Every step checks the visible UI and the database state, in that order.

const CAFETAL = '2d9eff07-35bb-4300-ad82-c1f981b66fd2';
const COMPRADOR = 'remitente-qa+clerk_test@example.com';
const VENDEDOR = 'admin-qa+clerk_test@example.com';
const BILLETERA = 'http://127.0.0.1:8088/billetera/api/pagar';
const NOMBRE_COMPRADOR = 'Comprador QA';
const NOMBRE_VENDEDOR = 'Vendedora QA';
const UUID = /\/ordenes\/([0-9a-f-]{36})/i;

type Estado = {
  contexto: BrowserContext;
  comprador: Page;
  vendedora: Page | null;
  productoId: string;
  compradorId: string;
  vendedoraId: string | null;
  duenoOriginal: string | null;
  stockInicial: number;
  precioCentavos: number;
  ordenId: string | null;
  ordenCancelarId: string | null;
  ordenVencerId: string | null;
};

const estado = {} as Estado;

/** Pays a BTCPay invoice with the regtest test wallet, as the API the payment page links to does. */
async function pagarEnBilletera(factura: string): Promise<void> {
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
 * Signs a Clerk test account in on /entrar with code 424242. The account must already exist in the Clerk
 * dev instance: sign-up is behind Cloudflare Turnstile, which automation cannot pass, so it is made once by hand.
 */
async function entrarComo(pagina: Page, correo: string): Promise<void> {
  await pagina.goto('/entrar');
  const campo = pagina.locator('input[name=identifier]');
  await expect(campo).toBeVisible({ timeout: 60_000 });
  await campo.fill(correo);
  await pagina.getByRole('button', { name: 'Continuar', exact: true }).click();

  const codigo = pagina.locator('input[autocomplete="one-time-code"], input[name=code]');
  const noExiste = pagina.getByText('No se encontró una cuenta').first();
  await expect(codigo.or(noExiste)).toBeVisible({ timeout: 30_000 });
  if (await noExiste.isVisible()) {
    throw new Error(`La cuenta de prueba ${correo} no existe en Clerk. Creala una vez a mano en /registrarse (código 424242).`);
  }
  // Clerk rejects a code typed before its own send finishes, so the field gets a moment first.
  await pagina.waitForTimeout(2000);
  await codigo.fill('424242');
  const continuar = pagina.getByRole('button', { name: 'Continuar', exact: true });
  if (await continuar.isVisible()) await continuar.click();
  await expect(pagina).not.toHaveURL(/\/(entrar|registrarse)/, { timeout: 60_000 });
}

/** A new account has no name yet: /cuenta asks for it before the rest of the flow. */
async function ponerNombre(pagina: Page, nombre: string): Promise<void> {
  await pagina.goto('/cuenta');
  await expect(pagina.getByRole('heading', { name: 'Tu cuenta' })).toBeVisible({ timeout: 60_000 });
  // The field is read after the page settles: a read taken during the navigation can see two copies.
  const campo = pagina.locator('#nombre').first();
  await expect(campo).toBeVisible({ timeout: 60_000 });
  if ((await campo.inputValue()).trim() !== '') return;
  await campo.fill(nombre);
  await pagina.getByRole('button', { name: 'Guardar nombre' }).click();
  await expect(pagina.getByRole('button', { name: 'Guardar nombre' })).toBeEnabled({ timeout: 30_000 });
}

async function idUsuario(correo: string): Promise<string> {
  const { data, error } = await servicio().from('usuarios').select('id').eq('telefono', correo).single();
  if (error || !data) throw new Error(`No encontré al usuario ${correo}: ${error?.message}`);
  return data.id as string;
}

async function stockDe(productoId: string): Promise<number> {
  const { data, error } = await servicio().from('productos').select('stock').eq('id', productoId).single();
  if (error) throw error;
  return data.stock as number;
}

async function ordenDb(ordenId: string) {
  const { data, error } = await servicio()
    .from('ordenes')
    .select('estado, codigo_entrega, total_sats, total_usd_centavos')
    .eq('id', ordenId)
    .single();
  if (error) throw error;
  return data;
}

async function cobroDb(ordenId: string) {
  const { data, error } = await servicio()
    .from('cobros')
    .select('estado, proveedor, referencia_externa, bolt11, expira_en')
    .eq('orden_id', ordenId)
    .single();
  if (error) throw error;
  return data;
}

/** Adds the product to the cart and orders it from the cart screen; returns the payment screen's order id. */
// The cart empties after each order, so a checkout adds its unit unless step 1 already left one in the cart.
async function hacerPedido(pagina: Page, agregar = true): Promise<string> {
  if (agregar) {
    await pagina.goto(`/productos/${estado.productoId}`);
    await pagina.getByRole('button', { name: 'Agregar al carrito' }).click();
    await expect(pagina.getByText('Listo: agregaste 1 unidad al carrito.')).toBeVisible();
  }
  await pagina.goto('/carrito');
  const pedir = pagina.getByRole('button', { name: 'Hacer pedido' });
  await expect(pedir).toBeEnabled({ timeout: 60_000 });
  await pedir.click();
  // The app's URLs end with a slash; a rejected order shows its reason in an alert.
  const alerta = pagina.getByRole('alert');
  await expect(pagina).toHaveURL(/\/ordenes\/[0-9a-f-]{36}\/pagar\/?$/, { timeout: 60_000 }).catch(async (error) => {
    const mensaje = (await alerta.allInnerTexts()).join(' | ');
    throw new Error(`El pedido no llegó a la pantalla de pago. Alerta: "${mensaje}". ${String(error)}`);
  });
  const id = UUID.exec(pagina.url())?.[1];
  if (!id) throw new Error(`Sin id de orden en ${pagina.url()}`);
  return id;
}

/** Reads the invoice the payment screen shows (lnbcrt... on regtest). */
async function facturaEnPantalla(pagina: Page): Promise<string> {
  const factura = pagina.locator('#campo-factura');
  await expect(factura).toBeVisible({ timeout: 60_000 });
  await expect.poll(async () => factura.inputValue(), { timeout: 60_000 }).toMatch(/^lnbcrt/);
  return factura.inputValue();
}

test.describe.configure({ mode: 'serial' });
// Each step waits on the dev server and the wallet; the default two minutes is too short for a whole purchase.
test.setTimeout(240_000);

// Each run owns a fresh product: orders left unpaid by earlier runs hold stock on the shared seed products
// and release it in the background, which would make absolute stock checks flaky.
async function productoDeEnsayo(): Promise<{ id: string; precio: number }> {
  const cliente = servicio();
  const { data: negocio, error: errorNegocio } = await cliente
    .from('negocios')
    .select('usuario_id')
    .eq('id', CAFETAL)
    .single();
  if (errorNegocio) throw errorNegocio;
  const { data: categoria, error: errorCategoria } = await cliente.from('categorias').select('id').order('id').limit(1).single();
  if (errorCategoria) throw errorCategoria;
  const precio = 1100;
  const { data, error } = await cliente.rpc('guardar_producto', {
    p_usuario: negocio.usuario_id,
    p_producto: null,
    p_categoria: categoria.id,
    p_nombre: `Café de prueba btcpay ${Date.now()}`,
    p_descripcion: 'Producto del test de flujo BTCPay.',
    p_unidad: 'libra',
    p_precio: precio,
    p_stock: 50,
    p_activo: true,
    p_fotos: [],
  });
  if (error) throw new Error(error.message);
  return { id: data.id as string, precio };
}

test.beforeAll(async ({ browser }: { browser: Browser }) => {
  const contexto = await browser.newContext(OPCIONES_CONTEXTO);
  const comprador = await contexto.newPage();
  const producto = await productoDeEnsayo();
  Object.assign(estado, {
    contexto,
    comprador,
    vendedora: null,
    productoId: producto.id,
    precioCentavos: producto.precio,
    stockInicial: 50,
    compradorId: '',
    vendedoraId: null,
    duenoOriginal: null,
    ordenId: null,
    ordenCancelarId: null,
    ordenVencerId: null,
  });
});

test.afterAll(async () => {
  // The seller check moves the Cafetal shop to a test account; put the owner back.
  if (estado.duenoOriginal) {
    await servicio().from('negocios').update({ usuario_id: estado.duenoOriginal }).eq('id', CAFETAL);
  }
  await estado.vendedora?.context().close();
  await estado.contexto?.close();
});

test('1. catálogo, producto y carrito en USD y sats', async () => {
  const pagina = estado.comprador;
  await pagina.goto('/');
  await expect(pagina.getByRole('main')).toBeVisible();

  await pagina.goto(`/productos/${estado.productoId}`);
  await expect(pagina.getByRole('heading', { level: 1 })).toBeVisible();
  await pagina.getByRole('button', { name: 'Agregar al carrito' }).click();
  await expect(pagina.getByText('Listo: agregaste 1 unidad al carrito.')).toBeVisible();

  await pagina.goto('/carrito');
  await expect(pagina.getByRole('heading', { name: 'Cafetal El Mirador' })).toBeVisible();
  // The line total is the price in dollars; the sats figure shows once the quote has loaded.
  const usd = `$${(estado.precioCentavos / 100).toFixed(2)}`;
  await expect(pagina.getByText(usd, { exact: true }).first()).toBeVisible();
  await expect(pagina.getByText('sats', { exact: true }).first()).toBeVisible({ timeout: 60_000 });
});

test('2. comprador paga con factura BTCPay real y la pantalla pasa a pagada sola', async () => {
  const pagina = estado.comprador;
  await entrarComo(pagina, COMPRADOR);
  await ponerNombre(pagina, NOMBRE_COMPRADOR);
  estado.compradorId = await idUsuario(COMPRADOR);

  estado.stockInicial = await stockDe(estado.productoId);
  estado.ordenId = await hacerPedido(pagina, false);
  const ordenId = estado.ordenId;

  // Payment screen: a real BTCPay bolt11, QR, countdown, wallet link. Narrow phone width, no sideways scroll.
  const factura = await facturaEnPantalla(pagina);
  await expect(pagina.getByText('sats', { exact: true }).first()).toBeVisible();
  await expect(pagina.getByText(/^\$\d+\.\d{2}$/).first()).toBeVisible();
  await expect(pagina.getByText(/Vence en \d+:\d{2}/)).toBeVisible();
  await expect(pagina.locator('[aria-label*="QR"]').first()).toBeVisible();
  await expect(pagina.getByRole('link', { name: 'Pagar con la billetera de prueba' })).toBeVisible();
  await expect(pagina.getByRole('button', { name: 'Copiar factura' })).toBeVisible();
  expect(await seDesborda(pagina), 'La pantalla de pago se sale del ancho del celular').toBe(false);
  // Both payment buttons sit fully inside the 375px-wide screen.
  for (const boton of [
    pagina.getByRole('button', { name: 'Copiar factura' }),
    pagina.getByRole('link', { name: 'Pagar con la billetera de prueba' }),
  ]) {
    const caja = await boton.boundingBox();
    expect(caja, 'El botón de pago no tiene caja visible').not.toBeNull();
    expect((caja?.x ?? 0) + (caja?.width ?? 0)).toBeLessThanOrEqual(375);
    expect(caja?.x ?? -1).toBeGreaterThanOrEqual(0);
  }

  const orden = await ordenDb(ordenId);
  expect(orden.estado).toBe('esperando_pago');
  expect((await cobroDb(ordenId)).bolt11).toBe(factura);
  // Stock is held while the order waits for payment.
  expect(await stockDe(estado.productoId)).toBe(estado.stockInicial - 1);

  await pagarEnBilletera(factura);

  await expect(pagina).toHaveURL(new RegExp(`/ordenes/${ordenId}/?$`), { timeout: 60_000 });
  const pagada = await ordenDb(ordenId);
  expect(pagada.estado).toBe('pagada');
  expect(await stockDe(estado.productoId)).toBe(estado.stockInicial - 1);
});

test('3. recibo muestra Bitcoin por Lightning (BTCPay) y la referencia', async () => {
  const pagina = estado.comprador;
  const cobro = await cobroDb(estado.ordenId as string);
  expect(cobro.proveedor).toBe('btcpay');
  expect(cobro.estado).toBe('pagado');

  await pagina.goto(`/ordenes/${estado.ordenId}/recibo`);
  await expect(pagina.getByText('Bitcoin por Lightning (BTCPay)', { exact: true }).first()).toBeVisible();
  await expect(pagina.getByText((cobro.referencia_externa as string).slice(0, 12), { exact: false }).first()).toBeVisible();
});

test('4. vendedor ve la orden, la marca lista y entrega con el código', async ({ browser }) => {
  // The buyer's order must be checked by the shop owner: a test account takes over the Cafetal shop.
  const contextoVendedor = await browser.newContext(OPCIONES_CONTEXTO);
  const vendedora = await contextoVendedor.newPage();
  estado.vendedora = vendedora;
  await entrarComo(vendedora, VENDEDOR);
  await ponerNombre(vendedora, NOMBRE_VENDEDOR);
  estado.vendedoraId = await idUsuario(VENDEDOR);

  const { data: negocio, error } = await servicio().from('negocios').select('usuario_id').eq('id', CAFETAL).single();
  if (error) throw error;
  estado.duenoOriginal = negocio.usuario_id as string;
  const { error: errorDueno } = await servicio()
    .from('negocios')
    .update({ usuario_id: estado.vendedoraId })
    .eq('id', CAFETAL);
  if (errorDueno) throw errorDueno;

  const ordenId = estado.ordenId as string;
  await vendedora.goto(`/ordenes/${ordenId}`);
  await vendedora.waitForLoadState('load');
  await expect(vendedora.getByRole('button', { name: 'Marcar como lista' })).toBeVisible({ timeout: 60_000 });

  await vendedora.getByRole('button', { name: 'Marcar como lista' }).click();
  const confirmar = vendedora.getByRole('button', { name: 'Confirmar entrega' });
  await expect(confirmar).toBeVisible({ timeout: 60_000 });
  expect((await ordenDb(ordenId)).estado).toBe('lista');

  const codigo = (await ordenDb(ordenId)).codigo_entrega as string;
  expect(codigo).toMatch(/^\d{6}$/);
  await vendedora.getByLabel('Código de entrega').fill(codigo);
  await confirmar.click();
  await expect(vendedora.getByText('El pedido fue entregado.', { exact: false })).toBeVisible({ timeout: 60_000 });
  expect((await ordenDb(ordenId)).estado).toBe('entregada');

  // The buyer sees the delivered state on the order.
  const comprador = estado.comprador;
  await comprador.goto(`/ordenes/${ordenId}`);
  await expect(comprador.getByText(/entregad/i).first()).toBeVisible({ timeout: 60_000 });
});

test('5. cancelar un pedido sin pagar devuelve el stock y la factura pagada después no lo marca pagado', async () => {
  const pagina = estado.comprador;
  const antes = await stockDe(estado.productoId);
  const ordenId = await hacerPedido(pagina);
  estado.ordenCancelarId = ordenId;
  const factura = await facturaEnPantalla(pagina);
  expect(await stockDe(estado.productoId)).toBe(antes - 1);

  await pagina.getByRole('button', { name: 'Cancelar pedido', exact: true }).click();
  await pagina.getByLabel('Motivo de la cancelación').fill('Cambié de idea, prueba de flujo.');
  await pagina.getByRole('button', { name: 'Cancelar el pedido', exact: true }).click();
  await pagina.getByRole('button', { name: 'Sí, cancelar el pedido', exact: true }).click();
  await expect(pagina.getByText('Cancelaste este pedido. No pagués esta factura.').first()).toBeVisible({ timeout: 60_000 });

  expect((await ordenDb(ordenId)).estado).toBe('cancelada');
  expect(await stockDe(estado.productoId)).toBe(antes);

  // Paying the old invoice afterwards must not revive the order.
  await pagarEnBilletera(factura);
  await pagina.reload();
  await expect(pagina.getByText('Cancelaste este pedido. No pagués esta factura.').first()).toBeVisible({ timeout: 60_000 });
  await pagina.waitForTimeout(4000);
  expect((await ordenDb(ordenId)).estado).toBe('cancelada');
  expect(await stockDe(estado.productoId)).toBe(antes);
});

test('6. factura vencida: la pantalla dice que se acabó el tiempo y devuelve el stock', async () => {
  const pagina = estado.comprador;
  const antes = await stockDe(estado.productoId);
  const ordenId = await hacerPedido(pagina);
  estado.ordenVencerId = ordenId;
  await facturaEnPantalla(pagina);

  // Moves the invoice's deadline into the past, as if the 600 seconds had run out.
  const { error } = await servicio()
    .from('cobros')
    .update({ expira_en: new Date(Date.now() - 60_000).toISOString() })
    .eq('orden_id', ordenId);
  if (error) throw error;

  await pagina.reload();
  await expect(pagina.getByText(/El tiempo para pagar se acabó/)).toBeVisible({ timeout: 60_000 });
  await expect(pagina.getByRole('link', { name: 'Volver al carrito' })).toBeVisible();
  expect(await seDesborda(pagina)).toBe(false);

  // An expired product order is 'expirada' (not 'cancelada'): the stock goes back to the shelf.
  await expect.poll(async () => (await ordenDb(ordenId)).estado, { timeout: 30_000 }).toBe('expirada');
  expect(await stockDe(estado.productoId)).toBe(antes);
});

test('7. trabajo: el comprador contrata un servicio, el vendedor lo marca hecho y el comprador paga la factura', async () => {
  const pagina = estado.comprador;
  const vendedora = estado.vendedora as Page;
  const { data: servicioFila, error } = await servicio()
    .from('servicios')
    .select('id')
    .eq('negocio_id', CAFETAL)
    .eq('titulo', 'Tour del cafetal')
    .single();
  if (error) throw error;

  // The buyer contracts the tour; the order starts 'acordada' and waits for the shop to finish the work.
  await pagina.goto(`/servicios/${servicioFila.id}`);
  await pagina.getByLabel('Contale cuándo y dónde').fill('Sábado a las 9, en la entrada del cafetal.');
  await pagina.getByRole('button', { name: 'Contratar', exact: true }).click();
  await expect(pagina).toHaveURL(/\/ordenes\/[0-9a-f-]{36}\/?$/, { timeout: 60_000 });
  const ordenId = UUID.exec(pagina.url())?.[1] as string;
  expect((await ordenDb(ordenId)).estado).toBe('acordada');
  expect((await ordenDb(ordenId)).codigo_entrega).toBeNull();

  // The shop marks the work done: the buyer's invoice is requested from that moment.
  await vendedora.goto(`/ordenes/${ordenId}`);
  await vendedora.getByRole('button', { name: 'Marcar trabajo hecho', exact: true }).click();
  await vendedora.getByRole('button', { name: 'Sí, está hecho', exact: true }).click();
  await expect.poll(async () => (await ordenDb(ordenId)).estado, { timeout: 60_000 }).toBe('hecha');

  // The buyer pays the job's invoice from the payment screen; the job then reads as delivered.
  await pagina.goto(`/ordenes/${ordenId}/pagar`);
  const factura = await facturaEnPantalla(pagina);
  expect((await cobroDb(ordenId)).proveedor).toBe('btcpay');
  await pagarEnBilletera(factura);
  await expect(pagina).toHaveURL(new RegExp(`/ordenes/${ordenId}/?$`), { timeout: 60_000 });
  expect((await ordenDb(ordenId)).estado).toBe('entregada');
  expect((await cobroDb(ordenId)).estado).toBe('pagado');
});
