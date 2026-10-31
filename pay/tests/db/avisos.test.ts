import { createHash, randomBytes } from 'node:crypto';
import { createServer, type Server } from 'node:http';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { GET } from '@/app/api/v1/avisos/procesar/route';
import { verificarFirmaAviso } from '@/lib/api-cobros';

import { servicio } from './ayuda';

// The notice queue in the database: a state change and its notice commit together, claims never overlap, a crashed
// claim is taken again, retries wait longer each time, a notice gives up after 10 attempts and stays visible, and the
// protected route sends what is due. The receiver is a local server, which the test process runs in development.

const NULO = null as unknown as string;
const SECRETO_RUTA = 'secreto-de-la-ruta-de-prueba';

function aleatorio(bytes = 9): string {
  return randomBytes(bytes).toString('base64url').replace(/[^A-Za-z0-9]/g, 'x');
}

type Cliente = { id: string; secreto: string; tienda: string };

async function clienteNuevo(): Promise<Cliente> {
  const clave = `cp_${randomBytes(24).toString('base64url')}`;
  const tienda = `T${aleatorio(12)}`;
  const secreto = randomBytes(32).toString('hex');
  const { data, error } = await servicio().rpc('pay_crear_cliente_api', {
    p_nombre: 'Cliente de avisos',
    p_prefijo: clave.slice(0, 11),
    p_clave_hash: createHash('sha256').update(clave).digest('hex'),
    p_tienda: tienda,
    p_puede_elegir: false,
    p_aviso_secreto: secreto,
    p_producto: 'market',
    p_tiendas: [],
  });
  if (error) throw error;
  return { id: data as unknown as string, secreto, tienda };
}

// A charge with a notice address, and its invoice. Returns the ids the state change needs.
async function cobroConAviso(cliente: Cliente, url: string): Promise<{ cobro: string; factura: string }> {
  const { data, error } = await servicio().rpc('pay_reservar_cobro', {
    p_cliente: cliente.id,
    p_clave: `clave-${aleatorio(8)}`,
    p_huella: createHash('sha256').update(aleatorio()).digest('hex'),
    p_tienda: cliente.tienda,
    p_moneda: 'USD',
    p_monto: 1500,
    p_sats: 15_000,
    p_usd_centavos: 1500,
    p_cotizacion: 100_000,
    p_descripcion: 'Pupusas',
    p_referencia: `pedido-${aleatorio(6)}`,
    p_aviso_url: url,
    p_vence_en_segundos: 3600,
  });
  if (error) throw error;
  const cobro = (data as unknown as { cobro: { id: string } }).cobro.id;
  const factura = `F${aleatorio(12)}`;
  const registro = await servicio().rpc('pay_registrar_factura_cobro', {
    p_id: cobro,
    p_factura_id: factura,
    p_factura: `lnbcrt${aleatorio(10).toLowerCase()}`,
    p_expira: new Date(Date.now() + 3600_000).toISOString(),
  });
  if (registro.error) throw registro.error;
  return { cobro, factura };
}

async function pagar(factura: string): Promise<{ cambio: boolean; aviso_id: string | null }> {
  const { data, error } = await servicio().rpc('pay_aplicar_btcpay', { p_factura_id: factura, p_estado: 'Settled', p_hash: NULO });
  if (error) throw error;
  return data as unknown as { cambio: boolean; aviso_id: string | null };
}

async function reclamar(avisoId: string, duracion = 120) {
  const { data, error } = await servicio().rpc('pay_reclamar_avisos', { p_limite: 1, p_duracion_segundos: duracion, p_aviso: avisoId });
  if (error) throw error;
  return data ?? [];
}

async function cerrar(avisoId: string, token: string, ok: boolean, error: string | null): Promise<string> {
  const { data, error: fallo } = await servicio().rpc('pay_cerrar_aviso', {
    p_aviso: avisoId,
    p_token: token,
    p_ok: ok,
    p_error: error ?? NULO,
  });
  if (fallo) throw fallo;
  return data as unknown as string;
}

async function leerAviso(avisoId: string) {
  const { data, error } = await servicio()
    .from('pay_avisos')
    .select('entrega, intentos, proximo_intento_en, enviado_en, muerto_en, ultimo_error, reclamo, reclamado_hasta')
    .eq('id', avisoId)
    .single();
  if (error) throw error;
  return data;
}

describe('el estado y su aviso se escriben juntos', () => {
  it('un pago pone el cobro en pagado y deja su aviso pendiente, en la misma operación', async () => {
    const cliente = await clienteNuevo();
    const { factura } = await cobroConAviso(cliente, 'https://market.ejemplo.com/avisos');
    const resultado = await pagar(factura);
    expect(resultado.cambio).toBe(true);
    expect(resultado.aviso_id).not.toBeNull();
    const aviso = await leerAviso(resultado.aviso_id as string);
    expect(aviso.entrega).toBe('pendiente');
    expect(aviso.intentos).toBe(0);
    expect(Date.parse(aviso.proximo_intento_en)).toBeLessThanOrEqual(Date.now() + 5000);
  });

  it('un cambio sin dirección de aviso no deja ningún aviso', async () => {
    const cliente = await clienteNuevo();
    const { factura } = await cobroConAviso(cliente, NULO);
    const resultado = await pagar(factura);
    expect(resultado.cambio).toBe(true);
    expect(resultado.aviso_id).toBeNull();
  });

  it('repetir el mismo estado no deja un segundo aviso', async () => {
    const cliente = await clienteNuevo();
    const { factura } = await cobroConAviso(cliente, 'https://market.ejemplo.com/avisos');
    await pagar(factura);
    const repetido = await pagar(factura);
    expect(repetido.cambio).toBe(false);
    expect(repetido.aviso_id).toBeNull();
  });
});

describe('reclamos', () => {
  it('dos remitentes a la vez no se llevan el mismo aviso', async () => {
    const cliente = await clienteNuevo();
    const { factura } = await cobroConAviso(cliente, 'https://market.ejemplo.com/avisos');
    const { aviso_id } = await pagar(factura);

    const [uno, dos] = await Promise.all([reclamar(aviso_id as string), reclamar(aviso_id as string)]);
    expect(uno.length + dos.length).toBe(1);
  });

  it('un reclamo que se cayó vence y otro remitente lo vuelve a tomar', async () => {
    const cliente = await clienteNuevo();
    const { factura } = await cobroConAviso(cliente, 'https://market.ejemplo.com/avisos');
    const avisoId = (await pagar(factura)).aviso_id as string;

    const primero = await reclamar(avisoId, 10);
    expect(primero).toHaveLength(1);
    // The lease is moved into the past, as if the sender had died ten minutes ago.
    await servicio().from('pay_avisos').update({ reclamado_hasta: new Date(Date.now() - 600_000).toISOString() }).eq('id', avisoId);

    const segundo = await reclamar(avisoId);
    expect(segundo).toHaveLength(1);
    expect(segundo[0].intentos).toBe(2);
    expect(segundo[0].token).not.toBe(primero[0].token);
  });

  it('el remitente que perdió su reclamo no puede marcar el aviso como fallido', async () => {
    const cliente = await clienteNuevo();
    const { factura } = await cobroConAviso(cliente, 'https://market.ejemplo.com/avisos');
    const avisoId = (await pagar(factura)).aviso_id as string;
    const [primero] = await reclamar(avisoId, 10);
    await servicio().from('pay_avisos').update({ reclamado_hasta: new Date(Date.now() - 600_000).toISOString() }).eq('id', avisoId);
    await reclamar(avisoId);
    expect(await cerrar(avisoId, primero.token, false, 'tarde')).toBe('reclamo_ajeno');
  });
});

describe('reintentos y estado muerto', () => {
  it('cada reintento espera el doble, con un techo de una hora, y a los 10 intentos el aviso queda muerto', async () => {
    const cliente = await clienteNuevo();
    const { factura } = await cobroConAviso(cliente, 'https://market.ejemplo.com/avisos');
    const avisoId = (await pagar(factura)).aviso_id as string;
    const esperas = [30, 60, 120, 240, 480, 960, 1920, 3600, 3600];

    for (let intento = 1; intento <= 9; intento++) {
      const [reclamo] = await reclamar(avisoId);
      expect(reclamo.intentos).toBe(intento);
      expect(await cerrar(avisoId, reclamo.token, false, 'El receptor respondió 500.')).toBe('pendiente');
      const fila = await leerAviso(avisoId);
      const espera = (Date.parse(fila.proximo_intento_en) - Date.now()) / 1000;
      expect(Math.abs(espera - esperas[intento - 1])).toBeLessThan(10);
      // Make the notice due again, instead of waiting for the schedule.
      await servicio().from('pay_avisos').update({ proximo_intento_en: new Date(Date.now() - 1000).toISOString() }).eq('id', avisoId);
    }

    const [ultimo] = await reclamar(avisoId);
    expect(ultimo.intentos).toBe(10);
    expect(await cerrar(avisoId, ultimo.token, false, 'El receptor respondió 500.')).toBe('muerto');

    const muerto = await leerAviso(avisoId);
    expect(muerto.entrega).toBe('muerto');
    expect(muerto.muerto_en).not.toBeNull();
    expect(muerto.ultimo_error).toBe('El receptor respondió 500.');
    expect(await reclamar(avisoId)).toHaveLength(0);
  });
});

describe('la ruta programada envía lo que quedó pendiente', () => {
  let servidor: Server;
  let base: string;
  const recibidos: { id: string; firma: string; cuerpo: string }[] = [];
  const anterior = process.env.PAY_AVISOS_SECRET;

  beforeAll(async () => {
    servidor = createServer((req, res) => {
      let cuerpo = '';
      req.on('data', (trozo) => (cuerpo += trozo));
      req.on('end', () => {
        recibidos.push({ id: String(req.headers['cacao-aviso-id'] ?? ''), firma: String(req.headers['cacao-firma'] ?? ''), cuerpo });
        res.writeHead(200).end('ok');
      });
    });
    await new Promise<void>((resolver) => servidor.listen(0, '127.0.0.1', resolver));
    base = `http://127.0.0.1:${(servidor.address() as { port: number }).port}`;
    process.env.PAY_AVISOS_SECRET = SECRETO_RUTA;
  });

  afterAll(() => {
    servidor.closeAllConnections();
    servidor.close();
    if (anterior === undefined) delete process.env.PAY_AVISOS_SECRET;
    else process.env.PAY_AVISOS_SECRET = anterior;
  });

  function peticion(autorizacion?: string): Request {
    const cabeceras: Record<string, string> = autorizacion ? { authorization: autorizacion } : {};
    return new Request('http://localhost/api/v1/avisos/procesar/', { headers: cabeceras });
  }

  it('un aviso que quedó en la tabla, sin envío en memoria, lo envía la ruta y no lo repite', async () => {
    const cliente = await clienteNuevo();
    const { factura } = await cobroConAviso(cliente, `${base}/aviso`);
    // The state change is written; nothing sends it in this process, as after a restart.
    const avisoId = (await pagar(factura)).aviso_id as string;
    expect(recibidos.some((r) => r.id === avisoId)).toBe(false);

    for (let i = 0; i < 15 && !recibidos.some((r) => r.id === avisoId); i++) {
      const respuesta = await GET(peticion(`Bearer ${SECRETO_RUTA}`));
      expect(respuesta.status).toBe(200);
    }
    const envio = recibidos.find((r) => r.id === avisoId);
    expect(envio).toBeDefined();
    expect(JSON.parse(envio?.cuerpo ?? '{}')).toMatchObject({ aviso: avisoId, tipo: 'cobro.estado', estado: 'pagado' });
    expect(verificarFirmaAviso(envio?.firma ?? '', envio?.cuerpo ?? '', cliente.secreto, Date.now() / 1000)).toBe(true);
    expect((await leerAviso(avisoId)).entrega).toBe('entregado');

    const veces = recibidos.filter((r) => r.id === avisoId).length;
    await GET(peticion(`Bearer ${SECRETO_RUTA}`));
    expect(recibidos.filter((r) => r.id === avisoId)).toHaveLength(veces);
  });

  it('dos llamadas a la vez a la ruta envían cada aviso una sola vez', async () => {
    const cliente = await clienteNuevo();
    const { factura } = await cobroConAviso(cliente, `${base}/aviso`);
    const avisoId = (await pagar(factura)).aviso_id as string;
    await Promise.all([GET(peticion(`Bearer ${SECRETO_RUTA}`)), GET(peticion(`Bearer ${SECRETO_RUTA}`)), GET(peticion(`Bearer ${SECRETO_RUTA}`))]);
    for (let i = 0; i < 15 && (await leerAviso(avisoId)).entrega === 'pendiente'; i++) {
      await GET(peticion(`Bearer ${SECRETO_RUTA}`));
    }
    expect(recibidos.filter((r) => r.id === avisoId)).toHaveLength(1);
  });

  it('sin el secreto, o con otro, la ruta responde 401 y no envía nada', async () => {
    const cliente = await clienteNuevo();
    const { factura } = await cobroConAviso(cliente, `${base}/aviso`);
    const avisoId = (await pagar(factura)).aviso_id as string;
    expect((await GET(peticion())).status).toBe(401);
    expect((await GET(peticion('Bearer otro-secreto'))).status).toBe(401);
    expect(recibidos.some((r) => r.id === avisoId)).toBe(false);
    expect((await leerAviso(avisoId)).entrega).toBe('pendiente');
  });
});
