// Every query of the Cacao Media admin panel. Pages render what these functions return.
//
// Dates: the panel works in El Salvador time, which keeps no daylight saving, so the day
// boundaries use a fixed -06:00 offset.
import { bd } from './bd';
import { todasLasHistorias } from '../historias';
import { precio } from '../formato';

export const ZONA = 'America/El_Salvador';
const DESPLAZAMIENTO = '-06:00';
const DIA_MS = 86_400_000;
const DIAS_DEFECTO = 30;
const DIAS_MAXIMO = 366;
export const FILAS_POR_PAGINA = 50;

export const ESTADOS = ['pendiente', 'pagada', 'vencida', 'fallida'] as const;
export type EstadoCobro = (typeof ESTADOS)[number];

export const ETIQUETA_ESTADO: Record<EstadoCobro, string> = {
  pendiente: 'Pendiente',
  pagada: 'Pagada',
  vencida: 'Vencida',
  fallida: 'Fallida',
};

/** Funnel labels of the media site. Must match eventos_permitidos in the database. */
const ETIQUETA_EVENTO: Record<string, string> = {
  vista_historia: 'Abrieron',
  vio_muro: 'Llegaron al muro',
  creo_cobro: 'Pidieron la factura',
  pago: 'Pagaron',
  leyo_completa: 'Leyeron hasta el final',
};
const ORDEN_EVENTOS = Object.keys(ETIQUETA_EVENTO);
const PAGINA_EVENTOS = 1000;

export interface Rango {
  /** First and last day, both inclusive, YYYY-MM-DD in El Salvador time. */
  desde: string;
  hasta: string;
  /** Database bounds: start of `desde`, and start of the day after `hasta` (exclusive). */
  inicio: string;
  fin: string;
  /** Set when the date parameters were not usable and the default range is shown instead. */
  aviso?: string;
}

const FORMATO_FECHA = /^\d{4}-\d{2}-\d{2}$/;

function hoyEnElSalvador(ahora: Date): string {
  // en-CA formats a date as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: ZONA,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(ahora);
}

function fechaReal(texto: string): boolean {
  if (!FORMATO_FECHA.test(texto)) return false;
  const [a, m, d] = texto.split('-').map(Number);
  const t = new Date(Date.UTC(a, m - 1, d));
  return t.getUTCFullYear() === a && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

function sumarDias(fecha: string, dias: number): string {
  const [a, m, d] = fecha.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, d + dias)).toISOString().slice(0, 10);
}

/** Reads desde and hasta from the URL. Anything unusable falls back to the last 30 days. */
export function leerRango(
  params: { desde: string | null; hasta: string | null },
  ahora: Date = new Date(),
): Rango {
  const hoy = hoyEnElSalvador(ahora);
  const porDefecto = { desde: sumarDias(hoy, -(DIAS_DEFECTO - 1)), hasta: hoy };
  const { desde, hasta } = params;

  let elegido = porDefecto;
  let aviso: string | undefined;
  if (desde || hasta) {
    const valido =
      !!desde &&
      !!hasta &&
      fechaReal(desde) &&
      fechaReal(hasta) &&
      desde <= hasta &&
      (Date.parse(hasta) - Date.parse(desde)) / DIA_MS < DIAS_MAXIMO;
    if (valido) elegido = { desde, hasta };
    else aviso = `Las fechas no son válidas. Mostramos los últimos ${DIAS_DEFECTO} días.`;
  }

  return {
    ...elegido,
    inicio: `${elegido.desde}T00:00:00${DESPLAZAMIENTO}`,
    fin: `${sumarDias(elegido.hasta, 1)}T00:00:00${DESPLAZAMIENTO}`,
    aviso,
  };
}

/** Page number from the URL: a whole number from 1 up. Anything else is page 1. */
export function leerPagina(valor: string | null): number {
  if (!valor || !/^\d{1,6}$/.test(valor)) return 1;
  return Math.max(1, Number(valor));
}

export function leerEstado(valor: string | null): EstadoCobro | null {
  return ESTADOS.find((e) => e === valor) ?? null;
}

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

const formatoPartes = new Intl.DateTimeFormat('en-US', {
  timeZone: ZONA,
  day: 'numeric',
  month: 'numeric',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  hour12: false,
});

const formatoDia = new Intl.DateTimeFormat('en-CA', {
  timeZone: ZONA,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Full date and time in El Salvador, as "12 oct, 3:40 p. m.". */
export function fechaHora(iso: string | null): string {
  if (!iso) return '';
  const partes = formatoPartes.formatToParts(new Date(iso));
  const v = (tipo: string) => partes.find((p) => p.type === tipo)?.value ?? '';
  const mes = MESES[Number(v('month')) - 1];
  // Midnight can come out as hour 24 from some engines; fold it into 12 a. m.
  const hora24 = Number(v('hour')) % 24;
  const hora = hora24 % 12 || 12;
  const periodo = hora24 >= 12 ? 'p. m.' : 'a. m.';
  return `${Number(v('day'))} ${mes}, ${hora}:${v('minute')} ${periodo}`;
}

/** Day only, as "12 oct 2026", for the per-day table. `dia` is YYYY-MM-DD. */
export function fechaDia(dia: string): string {
  const [a, m, d] = dia.split('-').map(Number);
  return `${d} ${MESES[m - 1]} ${a}`;
}

/** Dollars from cents: "$3.50". */
export function usd(centavos: number): string {
  return `$${(centavos / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Sats with the site's separator: "1,250 sats". */
export const sats = (n: number): string => precio(n);

/** Share as one decimal, or "Sin datos" when there is nothing to divide by. */
export function porcentaje(parte: number, todo: number): string {
  if (todo <= 0) return 'Sin datos';
  return `${((parte / todo) * 100).toFixed(1)}%`;
}

// ---------------------------------------------------------------------------------------------
// Invoices closed by time

/** Marks overdue pending invoices as expired. Run before every read so the counts are current. */
export async function vencerCobros(): Promise<number> {
  const { data, error } = await bd().rpc('media_vencer_cobros');
  if (error) throw error;
  return Number(data ?? 0);
}

// ---------------------------------------------------------------------------------------------
// Summary

export interface Cifras {
  cobros: number;
  pagadas: number;
  sats: number;
  usd: number;
}

export interface FilaHistoria {
  slug: string;
  titulo: string;
  cobros: number;
  pagadas: number;
  vencidas: number;
  fallidas: number;
  sats: number;
  usd: number;
}

export interface PasoEmbudo {
  nombre: string;
  etiqueta: string;
  /** Distinct browser sessions that reached this step. */
  lectores: number;
  /** Share of the previous step, or null for the first step and when the previous step is empty. */
  porcentajeAnterior: number | null;
  /** Width of the bar relative to the first step, 0 to 100. */
  anchoBarra: number;
}

export interface ResumenPanel {
  cifras: Cifras;
  embudo: PasoEmbudo[];
  /** Share of funnel readers who paid after opening a story, 0 to 100. Null without openings. */
  pagan: number | null;
  historias: FilaHistoria[];
}

async function embudoMedia(rango: Rango): Promise<PasoEmbudo[]> {
  const { data, error } = await bd().rpc('embudo', {
    p_sitio: 'media',
    p_desde: rango.inicio,
    p_hasta: rango.fin,
  });
  if (error) throw error;
  const filas = (data ?? []) as Array<{ nombre: string; etiqueta: string; sesiones: number | string }>;
  const primero = Number(filas[0]?.sesiones ?? 0);
  return filas.map((f, i) => {
    const lectores = Number(f.sesiones);
    const anterior = i === 0 ? null : Number(filas[i - 1].sesiones);
    return {
      nombre: f.nombre,
      etiqueta: f.etiqueta,
      lectores,
      porcentajeAnterior:
        anterior === null || anterior === 0 ? null : Math.min(100, Math.round((lectores / anterior) * 100)),
      anchoBarra: primero > 0 ? Math.min(100, Math.round((lectores / primero) * 100)) : 0,
    };
  });
}

async function historiasDelPeriodo(rango: Rango): Promise<FilaHistoria[]> {
  const { data, error } = await bd().rpc('media_resumen', {
    p_desde: rango.inicio,
    p_hasta: rango.fin,
  });
  if (error) throw error;
  const filas = (data ?? []) as Array<Record<string, string | number>>;
  return filas
    .map((f) => ({
      slug: String(f.slug),
      titulo: String(f.titulo),
      cobros: Number(f.cobros),
      pagadas: Number(f.pagadas),
      vencidas: Number(f.vencidas),
      fallidas: Number(f.fallidas),
      sats: Number(f.sats),
      usd: Number(f.usd_centavos),
    }))
    .sort((a, b) => b.sats - a.sats || a.titulo.localeCompare(b.titulo, 'es'));
}

/** Everything the summary page shows, from one closing pass over the invoices. */
export async function resumenPanel(rango: Rango): Promise<ResumenPanel> {
  await vencerCobros();
  const [embudo, historias] = await Promise.all([embudoMedia(rango), historiasDelPeriodo(rango)]);

  const cifras = historias.reduce<Cifras>(
    (t, h) => ({
      cobros: t.cobros + h.cobros,
      pagadas: t.pagadas + h.pagadas,
      sats: t.sats + h.sats,
      usd: t.usd + h.usd,
    }),
    { cobros: 0, pagadas: 0, sats: 0, usd: 0 },
  );

  const abrieron = embudo.find((p) => p.nombre === 'vista_historia')?.lectores ?? 0;
  const pagaron = embudo.find((p) => p.nombre === 'pago')?.lectores ?? 0;
  const pagan = abrieron > 0 ? Math.min(100, Math.round((pagaron / abrieron) * 100)) : null;

  return { cifras, embudo, pagan, historias };
}

// ---------------------------------------------------------------------------------------------
// Transactions

export interface FilaCobro {
  id: string;
  slug: string;
  titulo: string;
  /** Short anonymous label: the first 6 characters of the reader id. */
  lector: string;
  sats: number;
  usd: number;
  estado: EstadoCobro;
  creado: string;
  pagada: string | null;
  motivo: string | null;
}

export interface PaginaCobros {
  filas: FilaCobro[];
  total: number;
  pagina: number;
  paginas: number;
}

const COLUMNAS_COBRO =
  'id, slug, titulo, lector_id, precio_sats, precio_usd_centavos, estado, creado_en, pagada_en, motivo';

/** Invoices created in the range, newest first. A page past the end shows the last page. */
export async function cobrosPagina(
  rango: Rango,
  opciones: { pagina: number; estado: EstadoCobro | null },
): Promise<PaginaCobros> {
  await vencerCobros();

  const pedir = (pagina: number) => {
    const desde = (pagina - 1) * FILAS_POR_PAGINA;
    let consulta = bd()
      .from('media_cobros')
      .select(COLUMNAS_COBRO, { count: 'exact' })
      .gte('creado_en', rango.inicio)
      .lt('creado_en', rango.fin)
      .order('creado_en', { ascending: false })
      .order('id', { ascending: true })
      .range(desde, desde + FILAS_POR_PAGINA - 1);
    if (opciones.estado) consulta = consulta.eq('estado', opciones.estado);
    return consulta;
  };

  let pagina = opciones.pagina;
  let { data, count, error } = await pedir(pagina);
  if (error) throw error;
  const total = count ?? 0;
  const paginas = Math.max(1, Math.ceil(total / FILAS_POR_PAGINA));
  if (pagina > paginas) {
    pagina = paginas;
    ({ data, error } = await pedir(pagina));
    if (error) throw error;
  }

  const filas = ((data ?? []) as Array<Record<string, string | number | null>>).map((f) => ({
    id: String(f.id),
    slug: String(f.slug),
    titulo: String(f.titulo),
    lector: `Lector ${String(f.lector_id).slice(0, 6)}`,
    sats: Number(f.precio_sats),
    usd: Number(f.precio_usd_centavos),
    estado: f.estado as EstadoCobro,
    creado: String(f.creado_en),
    pagada: f.pagada_en ? String(f.pagada_en) : null,
    motivo: f.motivo ? String(f.motivo) : null,
  }));

  return { filas, total, pagina, paginas };
}

// ---------------------------------------------------------------------------------------------
// Activity

export interface FilaActividadHistoria {
  slug: string;
  titulo: string;
  abrieron: number;
  muro: number;
  leyeron: number;
}

export interface FilaActividadDia {
  dia: string;
  /** Count of stored events per funnel step, in ETIQUETA_EVENTO order. */
  eventos: Record<string, number>;
}

export interface ActividadPanel {
  historias: FilaActividadHistoria[];
  dias: FilaActividadDia[];
  etiquetas: Record<string, string>;
  total: number;
}

/** Reads every media event of the range in pages, because the API returns at most 1000 rows a call. */
async function eventosDelPeriodo(rango: Rango): Promise<Array<Record<string, string | null>>> {
  const filas: Array<Record<string, string | null>> = [];
  for (let desde = 0; ; desde += PAGINA_EVENTOS) {
    const { data, error } = await bd()
      .from('eventos')
      .select('id, sesion, nombre, objeto, creado_en')
      .eq('sitio', 'media')
      .gte('creado_en', rango.inicio)
      .lt('creado_en', rango.fin)
      .order('id', { ascending: true })
      .range(desde, desde + PAGINA_EVENTOS - 1);
    if (error) throw error;
    filas.push(...((data ?? []) as Array<Record<string, string | null>>));
    if (!data || data.length < PAGINA_EVENTOS) break;
  }
  return filas;
}

/** Per story: distinct sessions that opened, reached the gate and read to the end. Per day: event counts. */
export async function actividadPanel(rango: Rango): Promise<ActividadPanel> {
  const [eventos, historias] = await Promise.all([eventosDelPeriodo(rango), todasLasHistorias()]);
  const titulos = new Map(historias.map((h) => [h.id, h.data.titulo]));

  const porHistoria = new Map<string, { abrieron: Set<string>; muro: Set<string>; leyeron: Set<string> }>();
  const porDia = new Map<string, Record<string, number>>();

  for (const e of eventos) {
    const nombre = String(e.nombre);
    const sesion = String(e.sesion);
    const objeto = e.objeto;
    const dia = formatoDia.format(new Date(String(e.creado_en)));

    const conteo = porDia.get(dia) ?? Object.fromEntries(ORDEN_EVENTOS.map((n) => [n, 0]));
    if (nombre in conteo) conteo[nombre] += 1;
    porDia.set(dia, conteo);

    if (!objeto) continue;
    const grupo = porHistoria.get(objeto) ?? { abrieron: new Set(), muro: new Set(), leyeron: new Set() };
    if (nombre === 'vista_historia') grupo.abrieron.add(sesion);
    if (nombre === 'vio_muro') grupo.muro.add(sesion);
    if (nombre === 'leyo_completa') grupo.leyeron.add(sesion);
    porHistoria.set(objeto, grupo);
  }

  const filasHistoria = [...porHistoria.entries()]
    .map(([slug, g]) => ({
      slug,
      titulo: titulos.get(slug) ?? slug,
      abrieron: g.abrieron.size,
      muro: g.muro.size,
      leyeron: g.leyeron.size,
    }))
    .filter((f) => f.abrieron + f.muro + f.leyeron > 0)
    .sort((a, b) => b.abrieron - a.abrieron || a.titulo.localeCompare(b.titulo, 'es'));

  const dias = [...porDia.entries()]
    .sort(([a], [b]) => (a < b ? 1 : -1))
    .map(([dia, eventosDia]) => ({ dia, eventos: eventosDia }));

  return {
    historias: filasHistoria,
    dias,
    etiquetas: ETIQUETA_EVENTO,
    total: eventos.length,
  };
}

// ---------------------------------------------------------------------------------------------
// Authors

export interface FilaAutorHistoria {
  slug: string;
  titulo: string;
  /** Story opened by a reader (vista_historia events in the period). */
  vistas: number;
  /** Wall reached: vio_muro events in the period. */
  muro: number;
  /** Invoices asked for in the period. */
  facturas: number;
  pagadas: number;
  sats: number;
}

export interface GrupoAutor extends Omit<FilaAutorHistoria, 'slug' | 'titulo'> {
  autor: string;
  historias: FilaAutorHistoria[];
}

export interface PanelAutores {
  autores: GrupoAutor[];
  /** Stories in the period with any reader or invoice activity, most sats first. */
  historias: FilaAutorHistoria[];
  total: number;
}

/**
 * Views, wall views, invoices, paid invoices and sats earned per story and per author, for the period.
 * Every number comes from the events table and the invoice table. Stories with no activity show zeros.
 */
export async function autoresPanel(rango: Rango): Promise<PanelAutores> {
  await vencerCobros();
  const [eventos, resumen, catalogo] = await Promise.all([
    eventosDelPeriodo(rango),
    historiasDelPeriodo(rango),
    todasLasHistorias(),
  ]);

  const vistas = new Map<string, number>();
  const muro = new Map<string, number>();
  for (const e of eventos) {
    const slug = e.objeto;
    if (!slug) continue;
    if (e.nombre === 'vista_historia') vistas.set(slug, (vistas.get(slug) ?? 0) + 1);
    if (e.nombre === 'vio_muro') muro.set(slug, (muro.get(slug) ?? 0) + 1);
  }
  const cobrosDe = new Map(resumen.map((f) => [f.slug, f]));

  const porHistoria = catalogo
    .map((h): FilaAutorHistoria & { autor: string } => {
      const c = cobrosDe.get(h.id);
      return {
        slug: h.id,
        titulo: h.data.titulo,
        autor: h.data.autor,
        vistas: vistas.get(h.id) ?? 0,
        muro: muro.get(h.id) ?? 0,
        facturas: c?.cobros ?? 0,
        pagadas: c?.pagadas ?? 0,
        sats: c?.sats ?? 0,
      };
    })
    .filter((f) => f.vistas + f.muro + f.facturas > 0)
    .sort((a, b) => b.sats - a.sats || b.vistas - a.vistas || a.titulo.localeCompare(b.titulo, 'es'));

  const grupos = new Map<string, GrupoAutor>();
  for (const f of porHistoria) {
    const g = grupos.get(f.autor) ?? { autor: f.autor, vistas: 0, muro: 0, facturas: 0, pagadas: 0, sats: 0, historias: [] };
    g.vistas += f.vistas;
    g.muro += f.muro;
    g.facturas += f.facturas;
    g.pagadas += f.pagadas;
    g.sats += f.sats;
    g.historias.push({ slug: f.slug, titulo: f.titulo, vistas: f.vistas, muro: f.muro, facturas: f.facturas, pagadas: f.pagadas, sats: f.sats });
    grupos.set(f.autor, g);
  }
  const autores = [...grupos.values()].sort((a, b) => b.sats - a.sats || b.vistas - a.vistas || a.autor.localeCompare(b.autor, 'es'));

  return {
    autores,
    historias: porHistoria.map(({ autor: _autor, ...f }) => f),
    total: eventos.length,
  };
}
