// Manual tool, not part of build or dev. Downloads the places that accept bitcoin in El Salvador from BTC Map
// and writes one small file for each site. Run it again to refresh the figures: node scripts/btcmap.mjs
// Data: BTC Map, from OpenStreetMap contributors (ODbL). The sites must keep that attribution.
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const API = 'https://api.btcmap.org/v4/places/search?lat=13.7&lon=-89.2&radius_km=200&fields=id,name,lat,lon,icon,website,verified_at';
const VECINOS = ['GTM', 'HND'].map((c) => `https://raw.githubusercontent.com/johan/world.geo.json/master/countries/${c}.geo.json`);
const CAJA = { sur: 13.1, norte: 14.46, oeste: -90.13, este: -87.68 };
// Older checks may describe a place that has closed.
const VERIFICADO_DESDE = '2025-01-01';
const DESTINOS = ['cacao/datos/negocios.json', 'src/data/negocios.json', 'travel/src/data/negocios.json', 'market/src/data/negocios.json', 'pay/src/data/negocios.json'];

const CATEGORIAS = {
  comida: ['restaurant', 'lunch_dining', 'local_pizza', 'icecream', 'bakery_dining', 'fastfood', 'restaurant_menu', 'ramen_dining', 'dinner_dining', 'liquor', 'local_bar', 'sports_bar', 'nightlife'],
  cafe: ['local_cafe', 'coffee'],
  tiendas: ['storefront', 'local_grocery_store', 'local_mall', 'shopping_cart', 'shopping_bag', 'card_giftcard', 'hardware', 'local_florist', 'local_pharmacy', 'checkroom', 'computer', 'phone_android', 'pets', 'menu_book', 'store'],
  hospedaje: ['hotel', 'bed', 'apartment', 'cottage', 'cabin', 'night_shelter', 'house'],
  servicios: ['business', 'content_cut', 'spa', 'medical_services', 'fitness_center', 'directions_car', 'car_repair', 'local_gas_station', 'local_laundry_service', 'dentistry', 'tour', 'luggage', 'surfing', 'school', 'construction'],
};
const FUERA = new Set(['local_atm', 'account_balance', 'currency_exchange', 'group']);
const categoriaDe = (icono) => Object.keys(CATEGORIAS).find((c) => CATEGORIAS[c].includes(icono)) ?? 'otros';

function dentroDeAnillo([x, y], anillo) {
  let dentro = false;
  for (let i = 0, j = anillo.length - 1; i < anillo.length; j = i++) {
    const [xi, yi] = anillo[i];
    const [xj, yj] = anillo[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) dentro = !dentro;
  }
  return dentro;
}
function dentroDePais(punto, geometria) {
  const poligonos = geometria.type === 'Polygon' ? [geometria.coordinates] : geometria.coordinates;
  return poligonos.some((p) => dentroDeAnillo(punto, p[0]));
}
async function json(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url} respondió ${r.status}`);
  return r.json();
}

const vecinos = (await Promise.all(VECINOS.map(json))).map((g) => g.features[0].geometry);
const lugares = await json(API);
const enElPais = lugares.filter(
  (l) =>
    l.lat >= CAJA.sur && l.lat <= CAJA.norte && l.lon >= CAJA.oeste && l.lon <= CAJA.este &&
    !vecinos.some((g) => dentroDePais([l.lon, l.lat], g)),
);
const utiles = enElPais
  .filter((l) => l.name && !FUERA.has(l.icon) && (l.verified_at ?? '') >= VERIFICADO_DESDE)
  .map((l) => ({
    id: l.id,
    nombre: l.name,
    lat: Number(l.lat.toFixed(5)),
    lon: Number(l.lon.toFixed(5)),
    categoria: categoriaDe(l.icon),
    ...(l.website ? { web: l.website } : {}),
    verificado: l.verified_at.slice(0, 10),
  }))
  .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));

const porCategoria = {};
for (const l of utiles) porCategoria[l.categoria] = (porCategoria[l.categoria] ?? 0) + 1;
const salida = {
  fuente: 'BTC Map y colaboradores de OpenStreetMap (ODbL)',
  enlace: 'https://btcmap.org/',
  // Date in El Salvador, UTC-6.
  generado: new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString().slice(0, 10),
  verificadosDesde: VERIFICADO_DESDE,
  totalEnElMapa: enElPais.length,
  total: utiles.length,
  porCategoria,
  lugares: utiles,
};
const texto = JSON.stringify(salida);
for (const destino of DESTINOS) {
  await mkdir(dirname(destino), { recursive: true });
  await writeFile(destino, `${texto}\n`);
}
console.log(`${enElPais.length} en el mapa, ${utiles.length} verificados desde ${VERIFICADO_DESDE}.`, porCategoria);
