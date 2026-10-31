import { createHash, randomBytes } from 'node:crypto';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';

import { sufijo, usuarioNuevo } from './ayuda';

// The CacaoLedger side of the database (migration 20261102000001_ledger_api.sql), run against the local Supabase.
// The functions are called through PostgREST as the server does. These tests cover the dedupe under concurrency, the
// rule that a business sale is never a ticket, and the rate limit. Untyped client: the ledger tables are not in Pay's types.

const sinSesion = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
let cache: SupabaseClient | undefined;

function admin(): SupabaseClient {
  if (!cache) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
    const clave = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
    if (!url || !clave) {
      throw new Error('Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY. Corré las pruebas con --env-file=.env.local.');
    }
    cache = createClient(url, clave, sinSesion);
  }
  return cache;
}

const hex = () => createHash('sha256').update(randomBytes(16)).digest('hex');
const codigo = () => `${sufijo()}${sufijo()}`;

async function clienteLedger(grupo = false): Promise<string> {
  const clave = `cl_${randomBytes(24).toString('base64url')}`;
  const { data, error } = await admin()
    .from('ledger_clientes_api')
    .insert({
      nombre: `Prueba ${sufijo()}`,
      prefijo: clave.slice(0, 11),
      clave_hash: createHash('sha256').update(clave).digest('hex'),
      grupo,
    })
    .select('id')
    .single();
  if (error) throw new Error(error.message);
  return data.id as string;
}

type Reserva = {
  cliente: string;
  clave?: string;
  referencia?: string;
  huella?: string;
  producto?: string;
  negocio?: string | null;
  factura?: string | null;
};

// Calls ledger_reservar_venta_api the way the server does. A lightning sale unless no invoice is given.
function reservar(r: Reserva) {
  const lightning = r.factura !== null;
  return admin().rpc('ledger_reservar_venta_api', {
    p_cliente: r.cliente,
    p_clave: r.clave ?? `clave-${codigo()}`,
    p_huella: r.huella ?? hex(),
    p_referencia: r.referencia ?? `ref-${codigo()}`,
    p_producto: r.producto ?? 'market',
    p_negocio: r.negocio ?? null,
    p_descripcion: 'Café de altura',
    p_monto: 452,
    p_medio: lightning ? 'lightning' : 'efectivo',
    p_factura: lightning ? (r.factura ?? `INV-${codigo()}`) : null,
    p_hash: lightning ? hex() : null,
    p_sats: lightning ? 4000 : null,
    p_tasa: lightning ? 100000 : null,
  });
}

function ticketDeBtcpay(factura: string) {
  const id = `TK-20261030-${randomBytes(2).toString('hex').toUpperCase()}`;
  const ahora = new Date().toISOString();
  return {
    id,
    creado: ahora,
    actualizado: ahora,
    estado: 'pagado',
    cliente: 'consumidor',
    receptor: null,
    lineas: [{ descripcion: 'Café', cantidad: 1, precioCentavos: 452 }],
    pago: {
      rail: 'lightning',
      montoCentavos: 452,
      momento: ahora,
      sats: 4000,
      tasaUsdPorBtc: '100000.00',
      tasaFuente: 'btcpay',
      paymentHash: hex(),
      idTransaccion: `btcpay-${factura}`,
    },
    dte: null,
    firma: null,
    sello: null,
    rechazo: null,
    origen: { plataforma: 'btcpay', producto: 'market', numero: factura },
  };
}

describe('ledger_reservar_venta_api: one sale per invoice, under concurrency', () => {
  it('two different sales for the same invoice: one is registered, the other is refused as DUPLICADO', async () => {
    const cliente = await clienteLedger();
    const factura = `INV-${codigo()}`;
    const [a, b] = await Promise.all([
      reservar({ cliente, factura, referencia: `a-${codigo()}` }),
      reservar({ cliente, factura, referencia: `b-${codigo()}` }),
    ]);
    const exitos = [a, b].filter((r) => r.error === null);
    const fallos = [a, b].filter((r) => r.error !== null);
    expect(exitos).toHaveLength(1);
    expect(fallos).toHaveLength(1);
    expect(fallos[0]?.error?.message).toContain('DUPLICADO');
  });

  it('the same key sent twice at once: one sale, and both answers name it', async () => {
    const cliente = await clienteLedger();
    const clave = `clave-${codigo()}`;
    const huella = hex();
    const referencia = `ref-${codigo()}`;
    const factura = `INV-${codigo()}`;
    const [a, b] = await Promise.all([
      reservar({ cliente, clave, huella, referencia, factura }),
      reservar({ cliente, clave, huella, referencia, factura }),
    ]);
    expect(a.error).toBeNull();
    expect(b.error).toBeNull();
    expect(a.data.venta.id).toBe(b.data.venta.id);
    expect([a.data.situacion, b.data.situacion].sort()).toEqual(['existente', 'nueva']);
  });

  it('the same key with another body is a conflict', async () => {
    const cliente = await clienteLedger();
    const clave = `clave-${codigo()}`;
    const primera = await reservar({ cliente, clave });
    expect(primera.error).toBeNull();
    const otra = await reservar({ cliente, clave });
    expect(otra.error?.message).toContain('IDEMPOTENCIA_CONFLICTO');
  });
});

describe('ledger: a sale of a business is never a ticket', () => {
  it('registers a negocios sale at once, with no ticket, and the group ticket count does not move', async () => {
    const usuario = await usuarioNuevo('Negocio de prueba');
    const { data: negocio, error: errorNegocio } = await admin().rpc('pay_negocio_reclamar', {
      p_usuario: usuario.id,
      p_nombre: `Cafe ${codigo()}`,
      p_tipo: 'cafeteria',
      p_ubicacion: 'Santa Tecla',
    });
    expect(errorNegocio).toBeNull();
    const negocioId = (negocio as { negocio: { id: string } }).negocio.id;

    const cliente = await clienteLedger();
    const antes = await admin().from('ledger_tickets').select('id', { count: 'exact', head: true });
    const factura = `INV-NEG-${codigo()}`;
    const { data, error } = await reservar({ cliente, producto: 'negocios', negocio: negocioId, factura });
    expect(error).toBeNull();
    expect(data.venta.estado).toBe('registrada');
    expect(data.venta.ticket_id).toBeNull();
    expect(data.venta.negocio_id).toBe(negocioId);

    const despues = await admin().from('ledger_tickets').select('id', { count: 'exact', head: true });
    expect(despues.count).toBe(antes.count);
    const enTickets = await admin().from('ledger_tickets').select('id').eq('origen_numero', factura);
    expect(enTickets.data).toEqual([]);
  });

  it('a business sale needs its negocio_id', async () => {
    const cliente = await clienteLedger();
    const { error } = await reservar({ cliente, producto: 'negocios', negocio: null });
    expect(error?.message).toContain('DATOS_INVALIDOS');
  });
});

describe('ledger_guardar_ticket: the BTCPay invoice is one ticket', () => {
  it('two tickets for the same invoice at once: one is stored, the other is refused as DUPLICADO', async () => {
    const factura = `INV-${codigo()}`;
    const [a, b] = await Promise.all([
      admin().rpc('ledger_guardar_ticket', { p_ticket: ticketDeBtcpay(factura) }),
      admin().rpc('ledger_guardar_ticket', { p_ticket: ticketDeBtcpay(factura) }),
    ]);
    const exitos = [a, b].filter((r) => r.error === null);
    const fallos = [a, b].filter((r) => r.error !== null);
    expect(exitos).toHaveLength(1);
    expect(fallos).toHaveLength(1);
    expect(fallos[0]?.error?.message).toContain('DUPLICADO');
  });
});

describe('ledger_api_cuota', () => {
  it('lets a client make at most its limit in a minute', async () => {
    const cliente = await clienteLedger();
    const usos: unknown[] = [];
    for (let i = 0; i < 3; i++) {
      const { data } = await admin().rpc('ledger_api_cuota', { p_cliente: cliente, p_maximo: 2 });
      usos.push(data);
    }
    expect(usos).toEqual([true, true, false]);
  });
});

describe('ledger_completar_venta_api', () => {
  it('links a ticket once, and refuses a ticket that another sale already holds', async () => {
    const cliente = await clienteLedger();
    const primera = await reservar({ cliente });
    const segunda = await reservar({ cliente });
    const ticket = ticketDeBtcpay(`INV-${codigo()}`);
    const guardado = await admin().rpc('ledger_guardar_ticket', { p_ticket: ticket });
    expect(guardado.error).toBeNull();
    const ligada = await admin().rpc('ledger_completar_venta_api', { p_id: primera.data.venta.id, p_ticket: ticket.id });
    expect(ligada.error).toBeNull();
    const otra = await admin().rpc('ledger_completar_venta_api', { p_id: segunda.data.venta.id, p_ticket: ticket.id });
    expect(otra.error?.message).toContain('DUPLICADO');
  });
});
