import { fechaHoraSalvador } from "../../src/tiempo.ts";

// Display helpers shared by the server pages and the client components. Pure: no server imports here.

export const ORDEN_PRODUCTOS = ["media", "travel", "market", "pay", "manual"] as const;

export function etiquetaProducto(producto: string | null | undefined): string {
  switch (producto) {
    case "media":
      return "Media";
    case "travel":
      return "Travel";
    case "market":
      return "Market";
    case "pay":
      return "Pay";
    default:
      return "Manual";
  }
}

// "2026-10-12 18:04" in El Salvador time.
export function fechaHoraSv(instante: string | Date): string {
  const f = fechaHoraSalvador(typeof instante === "string" ? new Date(instante) : instante);
  return `${f.fecEmi} ${f.horEmi.slice(0, 5)}`;
}

// "12/10/2026" from "2026-10-12".
export function fechaCorta(dia: string): string {
  const [a, m, d] = dia.split("-");
  return `${d}/${m}/${a}`;
}

// Shortens a long text: the first characters, an ellipsis, and optionally the last ones.
export function acortar(texto: string, inicio = 10, fin = 6): string {
  if (texto.length <= inicio + fin + 1) return texto;
  const cola = fin > 0 ? texto.slice(-fin) : "";
  return `${texto.slice(0, inicio)}…${cola}`;
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
