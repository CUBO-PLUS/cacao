import { expect, type Page, test } from '@playwright/test';

import { OPCIONES_CONTEXTO, cotizarDb, crearEnvioDb, filaEnvioDb, idDe, servicio, sesionDe } from './ayuda';

const ID_ENVIO = /\/envios\/[0-9a-f-]{36}$/;
const HTML_MALICIOSO = '<img src=x onerror=alert(1)>';

// A unique recipient name, so a count in the database only sees this test's transfers.
function nombreUnico(): string {
  return `Prueba ${Math.random().toString(36).slice(2, 8)}`;
}

// Walks the sender's three steps and stops on the confirmation, where the button creates the transfer.
async function llegarAConfirmar(pagina: Page, nombre: string) {
  await pagina.goto('/enviar');
  await pagina.getByLabel('Monto a enviar').fill('100');
  await expect(pagina.locator('section[aria-labelledby="envio-cotizacion-titulo"] dl')).toBeVisible();
  await pagina.getByRole('button', { name: 'Seguir' }).click();
  await pagina.getByLabel('Cómo se llama quien recibe').fill(nombre);
  await pagina.getByLabel('Su celular o su correo').fill('7612 3456');
  await pagina.getByRole('button', { name: 'Seguir' }).click();
  await expect(pagina.getByRole('heading', { name: 'Revisá y confirmá' })).toBeVisible();
}

async function cuantosCreados(nombre: string): Promise<number> {
  const { count, error } = await servicio()
    .from('pay_transferencias')
    .select('id', { count: 'exact', head: true })
    .eq('remitente_id', await idDe('lucia'))
    .eq('destinatario_nombre', nombre);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

test('un doble toque en "Confirmar envío" (dblclick) crea un solo envío', async ({ browser }) => {
  const lucia = await sesionDe(browser, 'lucia');
  try {
    const nombre = nombreUnico();
    await llegarAConfirmar(lucia, nombre);
    await lucia.getByRole('button', { name: 'Confirmar envío' }).dblclick();
    await lucia.waitForURL(ID_ENVIO);
    expect(await cuantosCreados(nombre)).toBe(1);
  } finally {
    await lucia.context().close();
  }
});

test('dos toques seguidos en "Confirmar envío" crean un solo envío', async ({ browser }) => {
  const lucia = await sesionDe(browser, 'lucia');
  try {
    const nombre = nombreUnico();
    await llegarAConfirmar(lucia, nombre);
    // Two clicks in the same task: the second arrives before the page disables the button, so both
    // submissions leave the browser with the same key.
    await lucia.evaluate(() => {
      const boton = [...document.querySelectorAll<HTMLButtonElement>('button')].find((b) =>
        b.textContent?.includes('Confirmar envío'),
      );
      if (!boton) throw new Error('No encontré el botón Confirmar envío.');
      boton.click();
      boton.click();
    });
    await lucia.waitForURL(ID_ENVIO);
    expect(await cuantosCreados(nombre)).toBe(1);
  } finally {
    await lucia.context().close();
  }
});

test('una cotización alterada en el navegador no cambia lo que se guarda', async ({ browser }) => {
  const lucia = await sesionDe(browser, 'lucia');
  try {
    const nombre = nombreUnico();
    await llegarAConfirmar(lucia, nombre);

    // The browser sends a different amount and invented fee, received and rate values.
    await lucia.evaluate(() => {
      const formulario = document.querySelector<HTMLInputElement>('input[name="clave"]')?.closest('form');
      if (!formulario) throw new Error('No encontré el formulario de confirmación.');
      const monto = formulario.querySelector<HTMLInputElement>('input[name="montoCentavos"]');
      if (!monto) throw new Error('No encontré el monto.');
      monto.value = '20000';
      for (const [campo, valor] of [
        ['comisionCentavos', '1'],
        ['netoCentavos', '999998'],
        ['montoDestino', '999999'],
        ['tasa', '5'],
      ]) {
        const extra = document.createElement('input');
        extra.type = 'hidden';
        extra.name = campo;
        extra.value = valor;
        formulario.appendChild(extra);
      }
    });
    await lucia.getByRole('button', { name: 'Confirmar envío' }).click();
    await lucia.waitForURL(ID_ENVIO);
    const envioId = new URL(lucia.url()).pathname.split('/').pop() as string;

    // The stored amounts are the server's own quote for the amount it stored.
    const fila = await filaEnvioDb(envioId);
    const cotizado = await cotizarDb('USD', 20_000, 'efectivo');
    expect(fila.monto_origen_centavos).toBe(20_000);
    expect(fila.comision_centavos).toBe(cotizado.comision);
    expect(fila.neto_centavos).toBe(cotizado.neto);
    expect(Number(fila.monto_destino)).toBe(cotizado.montoDestino);
    expect(Number(fila.tasa)).toBe(cotizado.tasa);
    expect(fila.comision_centavos).not.toBe(1);
    expect(Number(fila.monto_destino)).not.toBe(999_999);
  } finally {
    await lucia.context().close();
  }
});

test('un envío de otra persona no se abre: sale la página de no existe', async ({ browser }) => {
  const { id } = await crearEnvioDb({ remitente: 'lucia' });
  const diego = await sesionDe(browser, 'diego');
  try {
    const respuesta = await diego.goto(`/envios/${id}`);
    expect(respuesta?.status()).toBe(404);
    await expect(diego.getByRole('heading', { name: 'Esta página no existe.' })).toBeVisible();
    await expect(diego.locator('main')).not.toContainText('Lucía');
  } finally {
    await diego.context().close();
  }
});

test('quien no es administrador no ve el monitor, y sin sesión se va a entrar', async ({ browser }) => {
  const lucia = await sesionDe(browser, 'lucia');
  const visitante = await browser.newContext(OPCIONES_CONTEXTO);
  try {
    for (const ruta of ['/admin', '/admin/envios', '/admin/embudo', '/admin/tarifas']) {
      const respuesta = await lucia.goto(ruta);
      expect(respuesta?.status(), ruta).toBe(404);
      await expect(lucia.getByRole('heading', { name: 'Esta página no existe.' })).toBeVisible();
      const texto = await lucia.locator('body').innerText();
      expect(texto, ruta).not.toContain('Monitor de envíos');
      expect(texto, ruta).not.toContain('Resumen del período');
      expect(texto, ruta).not.toContain('Tarifas');
    }

    const anonimo = await visitante.newPage();
    for (const ruta of ['/admin', '/admin/envios']) {
      await anonimo.goto(ruta);
      await expect(anonimo).toHaveURL(/\/entrar/);
    }
  } finally {
    await visitante.close();
    await lucia.context().close();
  }
});

test('un código desconocido o mal escrito en /t muestra "No encontramos un envío con ese código"', async ({ browser }) => {
  const visitante = await browser.newContext(OPCIONES_CONTEXTO);
  try {
    const pagina = await visitante.newPage();
    for (const ruta of ['/t/CP-ABCD-EFGH', '/t/no-es-un-codigo', '/t/CP-12']) {
      const respuesta = await pagina.goto(ruta);
      expect(respuesta?.status(), ruta).toBe(404);
      await expect(pagina.getByRole('heading', { name: 'No encontramos un envío con ese código' })).toBeVisible();
    }
  } finally {
    await visitante.close();
  }
});

test('un nombre y una nota con HTML se muestran como texto, sin ejecutar nada', async ({ browser }) => {
  const nombre = `Marta ${HTML_MALICIOSO}`;
  // Rosa's phone, so the transfer also reaches her page with the note.
  const { id, codigo } = await crearEnvioDb({
    remitente: 'lucia',
    nombre,
    contacto: '+503 7000 0002',
    nota: HTML_MALICIOSO,
  });
  const lucia = await sesionDe(browser, 'lucia');
  const rosa = await sesionDe(browser, 'rosa');
  const ana = await sesionDe(browser, 'ana');
  const visitante = await browser.newContext(OPCIONES_CONTEXTO);
  // Any alert, confirm or prompt the page opens is recorded and dismissed, and the test then fails.
  const dialogos: string[] = [];
  const registrarDialogo = (d: { message(): string; dismiss(): Promise<void> }) => {
    dialogos.push(d.message());
    void d.dismiss();
  };
  for (const pagina of [lucia, rosa, ana]) pagina.on('dialog', registrarDialogo);
  try {
    const paginas: { pagina: Page; ruta: string }[] = [
      { pagina: lucia, ruta: '/envios' },
      { pagina: lucia, ruta: `/envios/${id}` },
      { pagina: rosa, ruta: `/recibidos/${id}` },
      { pagina: ana, ruta: `/admin/envios/${id}` },
    ];
    for (const { pagina, ruta } of paginas) {
      await pagina.goto(ruta);
      const principal = pagina.locator('main');
      await expect(principal, ruta).toContainText(HTML_MALICIOSO);
      expect(await pagina.locator('main img[src="x"]').count(), ruta).toBe(0);
    }

    // The public page shows only the first word of the name, so the tag is not on it.
    const pv = await visitante.newPage();
    pv.on('dialog', registrarDialogo);
    await pv.goto(`/t/${codigo}`);
    await expect(pv.locator('main')).toContainText('Marta, te mandaron dinero');
    expect(await pv.locator('main img[src="x"]').count()).toBe(0);

    expect(dialogos).toEqual([]);
  } finally {
    await visitante.close();
    await lucia.context().close();
    await rosa.context().close();
    await ana.context().close();
  }
});
