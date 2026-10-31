// El Salvador has no daylight saving time and is UTC-6 all year. Documents carry
// local date and time, so they are formatted in that zone, not in the machine's zone.
const ZONA = "America/El_Salvador";

export interface FechaHoraSv {
  fecEmi: string; // YYYY-MM-DD
  horEmi: string; // HH:MM:SS
  ymd: string; // YYYYMMDD
}

export function fechaHoraSalvador(ahora: Date): FechaHoraSv {
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: ZONA,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(ahora);
  const get = (tipo: string): string => partes.find((p) => p.type === tipo)?.value ?? "00";
  const fecEmi = `${get("year")}-${get("month")}-${get("day")}`;
  return {
    fecEmi,
    horEmi: `${get("hour")}:${get("minute")}:${get("second")}`,
    ymd: fecEmi.replaceAll("-", ""),
  };
}

// "hace 4 min", "hace 2 h", "hace 3 días"; "hace menos de 1 min" under a minute.
export function haceCuanto(desde: Date, ahora: Date): string {
  const minutos = Math.floor((ahora.getTime() - desde.getTime()) / 60_000);
  if (minutos < 1) return "hace menos de 1 min";
  if (minutos < 60) return `hace ${minutos} min`;
  const horas = Math.floor(minutos / 60);
  if (horas < 48) return `hace ${horas} h`;
  return `hace ${Math.floor(horas / 24)} días`;
}
