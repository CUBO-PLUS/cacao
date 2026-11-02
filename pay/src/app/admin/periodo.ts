// The period the monitor reports on: whole days in El Salvador time. The country keeps UTC-6 all
// year, so the day boundaries are written with that offset.

const DESLASE = '-06:00';
const DIAS_MAXIMOS = 366;
const FORMATO_DIA = /^\d{4}-\d{2}-\d{2}$/;
const DIA_MS = 86_400_000;

// en-CA prints a date as YYYY-MM-DD, which is what the date inputs use.
const DIA_SV = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/El_Salvador',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

// A real calendar day, not just a shape: "2026-02-30" is refused.
function diaValido(texto: string): boolean {
  if (!FORMATO_DIA.test(texto)) return false;
  const fecha = new Date(`${texto}T00:00:00Z`);
  return !Number.isNaN(fecha.getTime()) && fecha.toISOString().slice(0, 10) === texto;
}

function sumarDias(dia: string, cantidad: number): string {
  const fecha = new Date(`${dia}T00:00:00Z`);
  fecha.setUTCDate(fecha.getUTCDate() + cantidad);
  return fecha.toISOString().slice(0, 10);
}

function inicioDelDia(dia: string): Date {
  return new Date(`${dia}T00:00:00${DESLASE}`);
}

export type Periodo = {
  /** The days as the date inputs show them, both included. */
  desde: string;
  hasta: string;
  /** The half-open range the database takes: from the start of desde to the start of the day after hasta. */
  inicio: Date;
  fin: Date;
  /** One sentence when the URL had a period that cannot be used; the default is shown then. */
  aviso: string | null;
};

function valorDe(valor: string | string[] | undefined): string {
  const texto = Array.isArray(valor) ? valor[0] : valor;
  return texto ?? '';
}

/** The period from the URL, or the last 30 days (today included) when there is none. */
export function periodoDe(params: Record<string, string | string[] | undefined>, ahora: Date): Periodo {
  const hoy = DIA_SV.format(ahora);
  const porDefecto = { desde: sumarDias(hoy, -29), hasta: hoy };
  const pedido = {
    desde: valorDe(params.desde) || porDefecto.desde,
    hasta: valorDe(params.hasta) || porDefecto.hasta,
  };

  let aviso: string | null = null;
  let usado = pedido;
  if (!diaValido(pedido.desde) || !diaValido(pedido.hasta)) {
    aviso = 'Revisá las fechas: tienen que ser días que existan.';
    usado = porDefecto;
  } else if (pedido.desde > pedido.hasta) {
    aviso = 'La fecha de inicio tiene que ser igual o anterior a la de fin.';
    usado = porDefecto;
  } else if (Math.round((Date.parse(pedido.hasta) - Date.parse(pedido.desde)) / DIA_MS) >= DIAS_MAXIMOS) {
    aviso = 'El período no puede pasar de un año.';
    usado = porDefecto;
  }

  return {
    desde: usado.desde,
    hasta: usado.hasta,
    inicio: inicioDelDia(usado.desde),
    fin: inicioDelDia(sumarDias(usado.hasta, 1)),
    aviso,
  };
}

const FORMATO_DIA_LARGO = new Intl.DateTimeFormat('es-SV', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

/** A day written for a person: "3 de octubre de 2026". The day is read at noon UTC, so no time zone moves it. */
export function diaLargo(dia: string): string {
  return FORMATO_DIA_LARGO.format(new Date(`${dia}T12:00:00Z`));
}
