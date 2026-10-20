// Gives every approved business its own BTCPay store, a Lightning and on-chain wallet, the market user as
// employee, and the webhook that tells CacaoMarket when an invoice settles. Then it records the store id
// with asignar_tienda_btcpay, which also switches the business to the 'btcpay' provider.
//
// Only businesses with btcpay_tienda_id null are touched, so running it twice is safe. A store created in
// BTCPay whose later step fails is not recorded: check BTCPay for it before running again.
// Prints business names and OK/error only. Keys and secrets are never printed.
//
// Run from the market folder, after the BTCPay stack is up (infra/btcpay):
//   node --env-file=<archivo> scripts/tiendas-btcpay.mjs [--dry-run] [--solo <negocio id>]

import { createClient } from '@supabase/supabase-js';

const argumentos = process.argv.slice(2);
const dryRun = argumentos.includes('--dry-run');
const indiceSolo = argumentos.indexOf('--solo');
const soloId = indiceSolo >= 0 ? argumentos[indiceSolo + 1] : null;
if (indiceSolo >= 0 && !soloId) {
  console.error('Falta el id del negocio después de --solo.');
  process.exit(1);
}

const adminUrl = (process.env.BTCPAY_ADMIN_URL ?? 'http://127.0.0.1:49392').replace(/\/+$/, '');
const adminKey = process.env.BTCPAY_ADMIN_KEY ?? '';
const usuarioMercado = process.env.BTCPAY_MARKET_USER ?? '';
const webhookUrl = process.env.BTCPAY_MARKET_WEBHOOK_URL ?? '';
const webhookSecret = process.env.BTCPAY_MARKET_WEBHOOK_SECRET ?? '';
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const supabaseClave = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

const faltan = [
  ['BTCPAY_ADMIN_KEY', adminKey],
  ['BTCPAY_MARKET_USER', usuarioMercado],
  ['BTCPAY_MARKET_WEBHOOK_URL', webhookUrl],
  ['BTCPAY_MARKET_WEBHOOK_SECRET', webhookSecret],
  ['NEXT_PUBLIC_SUPABASE_URL', supabaseUrl],
  ['SUPABASE_SERVICE_ROLE_KEY', supabaseClave],
]
  .filter(([, valor]) => !valor)
  .map(([nombre]) => nombre);
if (faltan.length > 0) {
  console.error(`Faltan variables: ${faltan.join(', ')}. Usá --env-file=<archivo>.`);
  process.exit(1);
}
if (!/^https:\/\//.test(webhookUrl) && !/^http:\/\/(127\.0\.0\.1|localhost)/.test(webhookUrl)) {
  console.error('BTCPAY_MARKET_WEBHOOK_URL tiene que ser https (o localhost para pruebas).');
  process.exit(1);
}
if (webhookSecret.length < 20) {
  console.error('BTCPAY_MARKET_WEBHOOK_SECRET tiene que tener al menos 20 caracteres.');
  process.exit(1);
}

const s = createClient(supabaseUrl, supabaseClave, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});

// One BTCPay call. Errors name the step and the status, never the response body or the key.
async function btcpay(metodo, ruta, cuerpo) {
  const r = await fetch(`${adminUrl}${ruta}`, {
    method: metodo,
    headers: { 'content-type': 'application/json', authorization: `token ${adminKey}` },
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
    signal: AbortSignal.timeout(15000),
  });
  const texto = await r.text();
  if (!r.ok) throw new Error(`${metodo} ${ruta.split('?')[0].replace(/\/[A-Za-z0-9]{10,64}/g, '/{id}')} respondió ${r.status}`);
  return texto ? JSON.parse(texto) : null;
}

// The market user may be given as a BTCPay user id or as an email. An email is looked up once.
let usuarioId = null;
async function resolverUsuario() {
  if (usuarioId) return usuarioId;
  if (!usuarioMercado.includes('@')) {
    usuarioId = usuarioMercado;
    return usuarioId;
  }
  const usuarios = await btcpay('GET', '/api/v1/users');
  const hallado = usuarios.find((u) => String(u.email ?? '').toLowerCase() === usuarioMercado.toLowerCase());
  if (!hallado) throw new Error('No encontramos el usuario de mercado en BTCPay.');
  usuarioId = hallado.id;
  return usuarioId;
}

// Every step for one business. Returns the new store id. The store id is only recorded at the end.
async function configurarNegocio(negocio) {
  const tienda = await btcpay('POST', '/api/v1/stores', {
    name: negocio.nombre,
    defaultCurrency: 'SATS',
    speedPolicy: 'HighSpeed',
    invoiceExpiration: 900,
  });
  const id = tienda.id;

  await btcpay('POST', `/api/v1/stores/${id}/payment-methods/BTC-CHAIN/wallet/generate`, {
    savePrivateKeys: false,
    scriptPubKeyType: 'Segwit',
  });
  await btcpay('PUT', `/api/v1/stores/${id}/payment-methods/BTC-LN`, {
    enabled: true,
    config: { connectionString: 'Internal Node' },
  });
  await btcpay('POST', `/api/v1/stores/${id}/users`, {
    userId: await resolverUsuario(),
    role: 'Employee',
    // BTCPay 2.4 sends an invitation by default; the market user is added directly instead.
    requireInvitation: false,
  });
  await btcpay('POST', `/api/v1/stores/${id}/webhooks`, {
    url: webhookUrl,
    secret: webhookSecret,
    enabled: true,
    automaticRedelivery: true,
    authorizedEvents: {
      everything: false,
      specificEvents: ['InvoiceSettled', 'InvoiceExpired', 'InvoiceInvalid'],
    },
  });
  return id;
}

async function main() {
  let consulta = s
    .from('negocios')
    .select('id, nombre')
    .eq('estado', 'aprobado')
    .is('btcpay_tienda_id', null)
    .order('creado_en', { ascending: true });
  if (soloId) consulta = consulta.eq('id', soloId);
  const { data, error } = await consulta;
  if (error) throw new Error(`No pudimos leer los negocios: ${error.message}`);

  if (data.length === 0) {
    console.log('No hay negocios aprobados sin tienda de BTCPay.');
    return;
  }
  console.log(`${dryRun ? 'Simulación: ' : ''}${data.length} negocio(s) sin tienda de BTCPay.`);

  let correctos = 0;
  let fallidos = 0;
  for (const negocio of data) {
    if (dryRun) {
      console.log(`- ${negocio.nombre}: se crearía la tienda`);
      continue;
    }
    try {
      const tiendaId = await configurarNegocio(negocio);
      const { error: errorAsignar } = await s.rpc('asignar_tienda_btcpay', {
        p_negocio: negocio.id,
        p_tienda: tiendaId,
      });
      if (errorAsignar) throw new Error(`asignar_tienda_btcpay: ${errorAsignar.message}`);
      console.log(`- ${negocio.nombre}: OK`);
      correctos++;
    } catch (e) {
      console.log(`- ${negocio.nombre}: error (${e instanceof Error ? e.message : 'desconocido'})`);
      fallidos++;
    }
  }

  if (!dryRun) console.log(`Listo: ${correctos} OK, ${fallidos} con error.`);
  if (fallidos > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
