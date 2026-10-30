import { expect, test, type Page } from '@playwright/test';

import { filaEnvioDb, seDesborda, servicio } from './ayuda';
import { CORREOS, OPCIONES_CONTEXTO, contextoDe } from './clerk-qa';

// Clerk's bot check runs only in a headed browser; sign-in of existing accounts also works there.
test.use({ headless: false, trace: 'off' });
test.describe.configure({ mode: 'serial' });
test.setTimeout(300_000);

const BTCPAY = 'http://127.0.0.1:8088/billetera/api';
const NOMBRE_DESTINO = 'Rosa Mejía';

type Pedido = { factura: string; hash: string };

let envioId = '';
let codigo = '';
let sats = 0;
let token = '';
let envioConFactura = '';
let envioStale = '';

async function pagarEnWallet(factura: string): Promise<void> {
  const respuesta = await fetch(`${BTCPAY}/pagar`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ factura }),
  });
  expect(respuesta.ok).toBeTruthy();
}

async function facturaWallet(montoSats: number): Promise<Pedido> {
  return fetch(`${BTCPAY}/recibir`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sats: montoSats }),
  }).then((r) => r.json() as Promise<Pedido>);
}

// Creates a Lightning transfer through the three steps and returns its id and code.
async function nuevoEnvioLightning(pagina: Page, monto: string): Promise<{ id: string; codigo: string }> {
  await pagina.goto('/enviar');
  await pagina.getByLabel('Monto a enviar').fill(monto);
  await pagina.getByRole('radio', { name: /Lightning/ }).check();
  await expect(pagina.getByText('Recibe', { exact: true }).first()).toBeVisible();
  await pagina.getByRole('button', { name: 'Seguir' }).click();
  await expect(pagina.getByLabel('Cómo se llama quien recibe')).toBeVisible();
  await pagina.getByLabel('Cómo se llama quien recibe').fill(NOMBRE_DESTINO);
  await pagina.getByLabel('Su celular o su correo').fill(CORREOS.destinatario);
  await pagina.getByRole('button', { name: 'Seguir' }).click();
  await expect(pagina.getByRole('heading', { name: 'Revisá y confirmá' })).toBeVisible();
  await pagina.getByRole('button', { name: 'Confirmar envío' }).click();
  await pagina.waitForURL(/\/envios\/[0-9a-f-]{36}\/?$/);
  const id = new URL(pagina.url()).pathname.split('/').filter(Boolean).pop() as string;
  const cod = (await pagina.locator('article header h1 .dato').innerText()).trim();
  return { id, codigo: cod };
}

test('1. cotizador, tres pasos con Lightning, chips y Repetir envío', async ({ browser }) => {
  const contexto = await contextoDe(browser, 'remitente');
  const pagina = await contexto.newPage();

  await pagina.goto('/');
  await pagina.getByLabel('Monto a enviar').fill('100');
  await expect(pagina.getByText('Recibe', { exact: true }).first()).toBeVisible();

  const creado = await nuevoEnvioLightning(pagina, '50');
  envioId = creado.id;
  codigo = creado.codigo;
  expect(codigo).toMatch(/^CP-/);
  const fila = await filaEnvioDb(envioId);
  expect(fila.estado).toBe('creada');
  expect(fila.entrega).toBe('lightning');

  // After a first send, the recipient shows as a recent chip.
  // The chips live on step 2, the recipient.
  await pagina.goto('/enviar');
  await pagina.getByLabel('Monto a enviar').fill('50');
  await expect(pagina.getByText('Recibe', { exact: true }).first()).toBeVisible();
  await pagina.getByRole('button', { name: 'Seguir' }).click();
  await expect(pagina.getByRole('button', { name: new RegExp(`Usar a ${NOMBRE_DESTINO}`) }).first()).toBeVisible();

  // Repetir envío prefills the amount, the way and the recipient.
  await pagina.goto(`/envios/${envioId}`);
  await pagina.getByRole('link', { name: 'Repetir envío' }).click();
  await expect(pagina).toHaveURL(/\/enviar\/?\?repetir=/);
  await expect(pagina.getByLabel('Monto a enviar')).toHaveValue('50');
  await expect(pagina.getByRole('radio', { name: /Lightning/ })).toBeChecked();
  await expect(pagina.getByText('Recibe', { exact: true }).first()).toBeVisible();
  await pagina.getByRole('button', { name: 'Seguir' }).click();
  await expect(pagina.getByLabel('Cómo se llama quien recibe')).toHaveValue(NOMBRE_DESTINO);
  await contexto.close();
});

test('2. pago con Lightning: Esperando que cobre, DB procesando', async ({ browser }) => {
  const contexto = await contextoDe(browser, 'remitente');
  const pagina = await contexto.newPage();
  await pagina.goto(`/envios/${envioId}`);
  await pagina.getByRole('button', { name: 'Pagar con Lightning' }).click();
  const factura = await pagina.getByLabel('Factura Lightning').inputValue();
  expect(factura).toMatch(/^ln/);
  await pagarEnWallet(factura);
  await expect(pagina.getByText('Esperando que cobre', { exact: true }).first()).toBeVisible({ timeout: 60_000 });
  await contexto.close();

  const fila = await filaEnvioDb(envioId);
  expect(fila.pagada_en).not.toBeNull();
  expect(fila.estado).toBe('procesando');
  sats = Number(fila.monto_destino);
});

test('3. cobro: enlace solo tras pagar, factura exacta, cobro único', async ({ browser }) => {
  const contexto = await contextoDe(browser, 'remitente');
  const pagina = await contexto.newPage();
  await pagina.goto(`/envios/${envioId}`);
  const enlace = pagina.locator('p.dato', { hasText: '/cobrar/' });
  await expect(enlace).toBeVisible();
  token = (await enlace.innerText()).trim().split('/cobrar/')[1];
  await contexto.close();

  const visitante = await browser.newContext(OPCIONES_CONTEXTO);
  const cobro = await visitante.newPage();
  await cobro.goto(`/cobrar/${token}`);
  await expect(cobro.getByRole('heading', { name: /Te mandaron/ })).toBeVisible();

  const otra = await facturaWallet(sats + 7);
  await cobro.getByLabel('Pegá tu factura').fill(otra.factura);
  await cobro.getByRole('button', { name: 'Cobrar', exact: true }).click();
  await expect(cobro.locator('p[role="alert"]')).toContainText('exactamente por');

  const exacta = await facturaWallet(sats);
  await cobro.getByLabel('Pegá tu factura').fill(exacta.factura);
  await cobro.getByRole('button', { name: 'Cobrar', exact: true }).click();
  await expect(cobro.getByRole('status')).toContainText('Listo. Recibiste', { timeout: 90_000 });

  const recibida = await fetch(`${BTCPAY}/recibida?hash=${exacta.hash}`).then((r) => r.json() as Promise<{ pagada: boolean; sats: number }>);
  expect(recibida).toEqual({ pagada: true, sats });

  const cerrada = await filaEnvioDb(envioId);
  expect(cerrada.estado).toBe('completada');
  expect(cerrada.cobro_estado).toBe('pagado');

  await cobro.reload();
  await expect(cobro.getByRole('button', { name: 'Cobrar', exact: true })).toHaveCount(0);
  await cobro.close();
  await visitante.close();
});

test('4. comprobante en /envios/[id] y seguimiento público con cobro', async ({ browser }) => {
  const contexto = await contextoDe(browser, 'remitente');
  const pagina = await contexto.newPage();
  await pagina.goto(`/envios/${envioId}`);
  const comprobante = pagina.locator('section').filter({ has: pagina.getByRole('heading', { name: 'Comprobante del envío' }) });
  await expect(comprobante).toBeVisible();
  await expect(comprobante).toContainText('Hash del pago');
  await expect(pagina.getByRole('img', { name: /Código QR para seguir el envío/ })).toBeVisible();
  await contexto.close();

  const publico = await browser.newContext(OPCIONES_CONTEXTO);
  const pv = await publico.newPage();
  await pv.goto(`/t/${codigo}`);
  await expect(pv.getByText('Cobrado por Lightning', { exact: true })).toBeVisible();
  await expect(pv.getByRole('img', { name: /Código QR para seguir el envío/ })).toBeVisible();
  expect(await pv.content()).not.toContain('/cobrar/');
  await publico.close();
});

test('5. cancelar: permitido antes de la factura, oculto con factura viva, rechazado tras pagar', async ({ browser }) => {
  const contexto = await contextoDe(browser, 'remitente');
  const pagina = await contexto.newPage();

  const sinFactura = await nuevoEnvioLightning(pagina, '20');
  await pagina.goto(`/envios/${sinFactura.id}`);
  await pagina.getByRole('button', { name: 'Cancelar envío' }).click();
  await pagina.getByRole('button', { name: 'Sí, cancelar el envío' }).click();
  await expect.poll(async () => (await filaEnvioDb(sinFactura.id)).estado, { timeout: 30_000 }).toBe('cancelada');
  await pagina.reload();
  await expect(pagina.getByText('Cancelado', { exact: true }).first()).toBeVisible();

  const conFactura = await nuevoEnvioLightning(pagina, '20');
  envioConFactura = conFactura.id;
  await pagina.goto(`/envios/${envioConFactura}`);
  await pagina.getByRole('button', { name: 'Pagar con Lightning' }).click();
  await expect(pagina.getByLabel('Factura Lightning')).toBeVisible();
  await expect(pagina.getByRole('button', { name: 'Cancelar envío' })).toHaveCount(0);

  const factura = await pagina.getByLabel('Factura Lightning').inputValue();
  await pagarEnWallet(factura);
  await expect(pagina.getByText('Esperando que cobre', { exact: true }).first()).toBeVisible({ timeout: 60_000 });

  // After payment the database refuses the cancellation too.
  const remitente = await servicio().from('usuarios').select('id').eq('telefono', CORREOS.remitente).single();
  const { error } = await servicio().rpc('pay_cancelar', {
    p_transferencia: envioConFactura,
    p_actor: remitente.data?.id,
  });
  expect(error).not.toBeNull();
  await contexto.close();
});

test('6. filtros, búsqueda y Recibidos del destinatario', async ({ browser }) => {
  const contexto = await contextoDe(browser, 'remitente');
  const pagina = await contexto.newPage();
  await pagina.goto('/envios');
  await pagina.getByRole('navigation', { name: 'Filtrar envíos por estado' }).getByRole('link', { name: 'Entregados' }).click();
  await expect(pagina).toHaveURL(/estado=entregados/);
  await expect(pagina.getByRole('article', { name: `Envío ${codigo}` })).toHaveCount(0);

  await pagina.goto('/envios');
  await pagina.getByLabel('Buscar por código o por nombre').fill(codigo);
  await pagina.getByRole('search').getByRole('button', { name: 'Buscar' }).click();
  await expect(pagina.getByRole('article', { name: `Envío ${codigo}` })).toBeVisible();
  await contexto.close();

  const destino = await contextoDe(browser, 'destinatario');
  const dp = await destino.newPage();
  await dp.goto('/recibidos');
  // The recipient's cards do not print the code: they link to the transfer, which the recipient can open.
  await expect(dp.locator(`a[href^="/recibidos/${envioId}"]`)).toBeVisible();
  await dp.goto(`/recibidos/${envioId}`);
  await expect(dp.getByRole('heading', { level: 1 })).toBeVisible();
  expect(await dp.content()).not.toContain('Comisión');
  await destino.close();
});

test('7. monitor como administradora: lista, detalle con cobro, sin procesar', async ({ browser }) => {
  const contexto = await contextoDe(browser, 'admin');
  const pagina = await contexto.newPage();
  await pagina.goto('/monitor/envios');
  await expect(pagina.getByRole('heading', { name: 'Envíos', exact: true }).first()).toBeVisible();
  await pagina.goto(`/monitor/envios/${envioId}`);
  await expect(pagina.getByText('Cobrado por Lightning', { exact: true }).first()).toBeVisible();
  await expect(pagina.getByRole('button', { name: 'Poner en camino' })).toHaveCount(0);
  await contexto.close();
});

test('8. cotización vencida: se actualiza y la factura usa la nueva', async ({ browser }) => {
  const contexto = await contextoDe(browser, 'remitente');
  const pagina = await contexto.newPage();
  const creado = await nuevoEnvioLightning(pagina, '30');
  envioStale = creado.id;

  // Ten minutes old: the stored rate and amount are half of what the server quotes now.
  const antes = await filaEnvioDb(envioStale);
  const { error } = await servicio()
    .from('pay_transferencias')
    .update({
      cotizada_en: new Date(Date.now() - 10 * 60_000).toISOString(),
      tasa: Number(antes.tasa) * 0.5,
      monto_destino: Math.floor(Number(antes.monto_destino) * 0.5),
    })
    .eq('id', envioStale);
  expect(error).toBeNull();

  await pagina.goto(`/envios/${envioStale}`);
  await pagina.getByRole('button', { name: 'Pagar con Lightning' }).click();
  await expect(pagina.getByRole('status').filter({ hasText: 'La cotización se actualizó' })).toBeVisible();
  const despues = await filaEnvioDb(envioStale);
  expect(Date.now() - Date.parse(despues.cotizada_en)).toBeLessThan(5 * 60_000);
  // The server's quote is written back: the amount and rate are the current ones, not the stale ones.
  expect(Number(despues.monto_destino)).toBe(Number(antes.monto_destino));
  expect(Number(despues.tasa)).toBeCloseTo(Number(antes.tasa), 4);
  expect(despues.estado).toBe('creada');
  expect(despues.factura_expira).not.toBeNull();
  await contexto.close();
});

test('9. 375 px sin desborde horizontal en /enviar, /envios/[id] y /cobrar/[token]', async ({ browser }) => {
  const contexto = await contextoDe(browser, 'remitente');
  const pagina = await contexto.newPage();
  await pagina.goto('/enviar');
  await expect(pagina.getByLabel('Monto a enviar')).toBeVisible();
  expect(await seDesborda(pagina)).toBeFalsy();
  await pagina.goto(`/envios/${envioId}`);
  await expect(pagina.getByRole('heading', { name: /Envío/ }).first()).toBeVisible();
  expect(await seDesborda(pagina)).toBeFalsy();
  await contexto.close();

  const visitante = await browser.newContext(OPCIONES_CONTEXTO);
  const cobro = await visitante.newPage();
  await cobro.goto(`/cobrar/${token}`);
  await expect(cobro.getByRole('heading', { name: /Te mandaron/ })).toBeVisible();
  expect(await seDesborda(cobro)).toBeFalsy();
  await visitante.close();
});

test('10. sin cobrar en 7 días: el enlace vence y quien envió recupera el dinero', async ({ browser }) => {
  const contexto = await contextoDe(browser, 'remitente');
  const pagina = await contexto.newPage();
  const creado = await nuevoEnvioLightning(pagina, '20');
  await pagina.goto(`/envios/${creado.id}`);
  await pagina.getByRole('button', { name: 'Pagar con Lightning' }).click();
  await pagarEnWallet(await pagina.getByLabel('Factura Lightning').inputValue());
  await expect(pagina.getByText('Esperando que cobre', { exact: true }).first()).toBeVisible({ timeout: 60_000 });
  const pagado = await filaEnvioDb(creado.id);
  const satsPagados = Number(pagado.factura_sats);

  // Seven days pass without a claim: the window closes, the claim link expires, the sender can take the money back.
  const { error } = await servicio()
    .from('pay_transferencias')
    .update({ cobro_vence_en: new Date(Date.now() - 60_000).toISOString() })
    .eq('id', creado.id);
  expect(error).toBeNull();

  const visitante = await browser.newContext(OPCIONES_CONTEXTO);
  const cobro = await visitante.newPage();
  await cobro.goto(`/cobrar/${pagado.cobro_token}`);
  await expect(cobro.locator('p[role="alert"]')).toContainText('venció');
  await expect(cobro.getByLabel('Pegá tu factura')).toHaveCount(0);
  await visitante.close();

  await pagina.reload();
  await expect(pagina.getByRole('heading', { name: 'Recuperar mi dinero' })).toBeVisible();
  const devolucion = await facturaWallet(satsPagados);
  await pagina.getByLabel('Pegá tu factura').fill(devolucion.factura);
  await pagina.getByRole('button', { name: 'Recuperar mi dinero' }).click();
  await expect(pagina.getByText('Devuelto', { exact: true }).first()).toBeVisible({ timeout: 90_000 });

  const devuelta = await filaEnvioDb(creado.id);
  expect(devuelta.estado).toBe('devuelta');
  expect(devuelta.devolucion_estado).toBe('pagado');
  await contexto.close();
});
