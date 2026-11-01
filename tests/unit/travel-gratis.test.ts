// The free-story rule: a story linked to a Cacao Travel experience is free (gratis: true), and every other story is paid.
// The list of linked stories is a snapshot of the public catalog at /api/tours.json (field `historias`). If Travel
// links a new story, update the list here and the story's frontmatter together.
// Run with `npm run test:unit`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';

const CARPETA = new URL('../../src/content/historias/', import.meta.url);

const VINCULADAS_A_TRAVEL = [
  '5-fincas-de-cafe-que-tenes-que-visitar',
  'cerro-verde-entre-la-neblina',
  'cocteles-de-conchas',
  'como-pedir-un-cafe-de-altura',
  'el-anil-azul-que-tino-un-pais',
  'el-boqueron-crater-a-media-hora',
  'el-centro-historico-caminado',
  'el-imposible-bosque-que-casi-se-pierde',
  'el-lago-de-coatepeque-de-tarde',
  'el-sonido-de-la-cumbia-en-el-centro',
  'el-teatro-nacional-por-dentro',
  'iglesia-el-rosario-luz-de-colores',
  'izalco-el-faro-del-pacifico',
  'la-ola-que-cambio-un-pueblo',
  'la-temporada-de-corta',
  'las-flores-playa-del-oriente',
  'las-tortugas-que-vuelven-a-jiquilisco',
  'lavado-honey-natural-que-cambia-taza',
  'lo-que-nadie-te-cuenta-del-tunco',
  'manglares-de-jiquilisco',
  'muelle-la-libertad-amanecer',
  'primera-clase-de-surf',
  'punta-roca-la-derecha',
  'pupusa-de-arroz-contra-la-de-maiz',
  'pupusas-de-madrugada',
  'remar-en-un-crater',
  'subir-volcan-de-santa-ana-sin-sufrir',
  'suchitoto-el-pueblo-que-se-quedo-quieto',
  'tenir-con-anil',
  'tres-volcanes-en-un-solo-mirador',
  'un-fin-de-semana-en-el-cuco',
  'una-cata-de-cafe-paso-a-paso',
];

function historiasDelSitio(): Map<string, string> {
  const historias = new Map<string, string>();
  for (const archivo of readdirSync(CARPETA)) {
    if (!archivo.endsWith('.md')) continue;
    const texto = readFileSync(new URL(archivo, CARPETA), 'utf8');
    const frontmatter = texto.split('---')[1] ?? '';
    historias.set(archivo.replace(/\.md$/, ''), frontmatter);
  }
  return historias;
}

test('every story linked to a Travel experience is gratis, and no other story is', () => {
  const historias = historiasDelSitio();
  const gratis = [...historias].filter(([, fm]) => /^gratis:\s*true\s*$/m.test(fm)).map(([slug]) => slug);
  const vinculadas = new Set(VINCULADAS_A_TRAVEL);

  const gratisPeroSinLink = gratis.filter((slug) => !vinculadas.has(slug));
  const linkPeroPaga = VINCULADAS_A_TRAVEL.filter((slug) => historias.has(slug) && !gratis.includes(slug));
  const sinHistoria = VINCULADAS_A_TRAVEL.filter((slug) => !historias.has(slug));

  assert.deepEqual(sinHistoria, [], 'Travel enlaza historias que no existen en src/content/historias');
  assert.deepEqual(linkPeroPaga, [], 'Estas historias están enlazadas a Travel y deben ser gratis');
  assert.deepEqual(gratisPeroSinLink, [], 'Estas historias son gratis pero Travel no las enlaza');
});

test('every paid story costs 120 sats, the default price', () => {
  const pagas = [...historiasDelSitio()].filter(([, fm]) => !/^gratis:\s*true\s*$/m.test(fm));
  assert.ok(pagas.length > 0);
  for (const [slug, fm] of pagas) {
    const precio = /^precio:\s*(\d+)\s*$/m.exec(fm)?.[1];
    assert.equal(precio, '120', `${slug} debe costar 120 sats`);
  }
});
