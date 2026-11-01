// Access codes for Cacao Media: a saved code opens its own story, on the server, and nothing else.
// Covers a valid code, a forged code, a code for another story, expiry, a booking token, and the attempt limit.
// No network and no database. Run with `npm run test:unit`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { firmar, DIA } from '../../src/lib/firma.ts';
import { LimiteIntentos, limpiarCodigo, pasePorCodigo } from '../../src/lib/codigo.ts';

const AHORA = 1_800_000_000_000;
const SLUG = 'el-cafe-de-la-cuesta';
const OTRO = 'el-puente-de-los-sueños';

/** Splits a token into its base64url payload and its signature, so a test can change one of them. */
function partes(token: string): { datos: string; firma: string } {
  const [datos, firma] = token.split('.');
  return { datos, firma };
}

function enDatos(token: string, cambiar: (pase: Record<string, unknown>) => void): string {
  const { datos, firma } = partes(token);
  const pase = JSON.parse(Buffer.from(datos, 'base64url').toString('utf8')) as Record<string, unknown>;
  cambiar(pase);
  return `${Buffer.from(JSON.stringify(pase)).toString('base64url')}.${firma}`;
}

test('a code saved for a story opens that story', () => {
  const codigo = firmar({ tipo: 'pago', slugs: [SLUG], exp: AHORA + 7 * DIA });
  const pase = pasePorCodigo(codigo, SLUG, AHORA);
  assert.ok(pase, 'the genuine code is accepted');
  assert.deepEqual(pase.slugs, [SLUG]);
  assert.equal(pase.exp, AHORA + 7 * DIA);
});

test('a forged code is refused: changed story, changed expiry, or a made-up signature', () => {
  const codigo = firmar({ tipo: 'pago', slugs: [OTRO], exp: AHORA + 7 * DIA });

  // The reader rewrites the payload to name the story they want and keeps the old signature.
  const cambiadoDeHistoria = enDatos(codigo, (p) => {
    p.slugs = [SLUG];
  });
  assert.equal(pasePorCodigo(cambiadoDeHistoria, SLUG, AHORA), null);

  // The reader extends the expiry.
  const expiraMasTarde = enDatos(codigo, (p) => {
    p.exp = AHORA + 365 * DIA;
  });
  assert.equal(pasePorCodigo(expiraMasTarde, OTRO, AHORA), null);

  // A signature of their own making.
  const { datos } = partes(codigo);
  const falsa = `${datos}.${Buffer.alloc(32, 7).toString('base64url')}`;
  assert.equal(pasePorCodigo(falsa, OTRO, AHORA), null);

  // Not a token at all.
  assert.equal(pasePorCodigo('no-es-un-codigo', OTRO, AHORA), null);
  assert.equal(pasePorCodigo(`${datos}.`, OTRO, AHORA), null);
});

test('a code for one story does not open another story', () => {
  const codigo = firmar({ tipo: 'pago', slugs: [SLUG], exp: AHORA + DIA });
  assert.equal(pasePorCodigo(codigo, OTRO, AHORA), null);
  assert.ok(pasePorCodigo(codigo, SLUG, AHORA));
});

test('a code that bundles two stories is refused, even for one of them', () => {
  const codigo = firmar({ tipo: 'pago', slugs: [SLUG, OTRO], exp: AHORA + DIA });
  assert.equal(pasePorCodigo(codigo, SLUG, AHORA), null);
  assert.equal(pasePorCodigo(codigo, OTRO, AHORA), null);
});

test('an expired code is refused, and so is a booking pass', () => {
  const vencido = firmar({ tipo: 'pago', slugs: [SLUG], exp: AHORA - 1 });
  assert.equal(pasePorCodigo(vencido, SLUG, AHORA), null);

  const reserva = firmar({ tipo: 'reserva', slugs: [SLUG], exp: AHORA + DIA, codigo: 'TRV-1' });
  assert.equal(pasePorCodigo(reserva, SLUG, AHORA), null);
});

test('spaces and line breaks from a paste are removed; empty input is refused', () => {
  const codigo = firmar({ tipo: 'pago', slugs: [SLUG], exp: AHORA + DIA });
  const partido = `${codigo.slice(0, 40)}\n  ${codigo.slice(40)} `;
  assert.equal(limpiarCodigo(partido), codigo);
  assert.equal(limpiarCodigo('   \n '), null);
  assert.equal(limpiarCodigo(42), null);
  assert.equal(limpiarCodigo(undefined), null);
  assert.equal(limpiarCodigo('x'.repeat(5000)), null);
});

test('the attempt limit counts wrong codes only: after the limit a client is blocked until the window passes', () => {
  const limite = new LimiteIntentos(3, 1000);
  assert.equal(limite.bloqueado('10.0.0.1', 0), false);
  limite.registrarFallo('10.0.0.1', 0);
  limite.registrarFallo('10.0.0.1', 1);
  limite.registrarFallo('10.0.0.1', 2);
  assert.equal(limite.bloqueado('10.0.0.1', 3), true, 'blocked once the wrong codes reach the limit');
  assert.equal(limite.bloqueado('10.0.0.2', 3), false, 'another client is not affected');
  assert.equal(limite.bloqueado('10.0.0.1', 999), true, 'still blocked inside the window');
  assert.equal(limite.bloqueado('10.0.0.1', 1000), false, 'free again once the first wrong codes age out');
});
