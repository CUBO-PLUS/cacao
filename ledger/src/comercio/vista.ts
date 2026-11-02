// Pure helpers for the owner's merchant list (/comercios). They never receive a secret: the page passes the
// record's shape and the env flag, and gets back yes/no answers and masked text only.

export interface FormaRegistroComercio {
  sobreDek?: unknown;
  material?: unknown;
}

export type EstadoCifrado = "cifrado" | "incompleto" | "sin-registro";

export interface CredencialVista {
  nombre: string;
  presente: boolean;
  nota: string;
}

/**
 * Masks a 14-digit NIT, keeping only the last three digits. Anything that is not a NIT shows as all asterisks,
 * so a malformed value never leaks through the mask.
 */
export function enmascararNit(nit: string): string {
  if (!/^\d{14}$/.test(nit)) return "**************";
  return `***********${nit.slice(-3)}`;
}

/** The record is encrypted when both the key envelope and the payload are present (envelope shape from cifrado.ts). */
export function estadoCifrado(reg: FormaRegistroComercio | null): EstadoCifrado {
  if (reg === null) return "sin-registro";
  return reg.sobreDek !== undefined && reg.sobreDek !== null && reg.material !== undefined && reg.material !== null
    ? "cifrado"
    : "incompleto";
}

export function etiquetaEstadoCifrado(estado: EstadoCifrado): string {
  switch (estado) {
    case "cifrado":
      return "Cifrado (AES-256-GCM)";
    case "incompleto":
      return "Incompleto";
    case "sin-registro":
      return "Sin registro";
  }
}

/** The master key is set in the server environment. Only the yes/no answer leaves this function, never the value. */
export function hayClaveMaestra(entorno: Record<string, string | undefined>): boolean {
  return (entorno.LEDGER_CLAVE_MAESTRA ?? "").trim() !== "";
}

/**
 * Which credentials each merchant has. The firmador password and private key sit in the encrypted blob, so their
 * presence is the blob's presence. The Hacienda API user and the BTCPay key are not stored per merchant today.
 */
export function credencialesDelComercio(reg: FormaRegistroComercio | null): CredencialVista[] {
  const firmador = reg !== null && estadoCifrado(reg) === "cifrado";
  return [
    {
      nombre: "Firmador: clave privada y contraseña",
      presente: firmador,
      nota: firmador ? "Dentro del sobre cifrado" : "No hay material cifrado",
    },
    {
      nombre: "API de Hacienda: usuario",
      presente: false,
      nota: "No se guarda por comercio todavía",
    },
    {
      nombre: "BTCPay: clave de API",
      presente: false,
      nota: "Hoy es una sola variable del servidor, no por comercio",
    },
  ];
}
