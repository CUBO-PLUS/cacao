// Who may read the ledger. Pure on purpose: the pages and routes ask decidirAcceso and act on the answer, and the
// tests cover the answer without Clerk or the database.
//
// Public: the tablero with aggregates only. Owner (signed in, usuarios.es_admin = true): everything else.
// Signed in without es_admin: a friendly denial. Not signed in: sign-in, then back to the page asked for.

export type SesionAcceso = { esAdmin: boolean } | null;

export type DecisionAcceso =
  | { tipo: "permitir" }
  | { tipo: "entrar"; destino: string }
  | { tipo: "denegar" };

export const TEXTO_SIN_ACCESO = "Esta cuenta no tiene acceso al libro de Grupo Cacao.";

/** Sign-in, sign-up, or the page that asks for it, keeping the way back in `volver`. */
export function rutaAcceso(ruta: "/entrar" | "/registrarse", volver: string): string {
  return volver === "/" ? ruta : `${ruta}?volver=${encodeURIComponent(volver)}`;
}

/** The step after sign-in: it sends the visitor on with the destination kept in `volver`. */
export function rutaContinuar(volver: string): string {
  return volver === "/" ? "/continuar" : `/continuar?volver=${encodeURIComponent(volver)}`;
}

/**
 * Where to send the visitor after sign-in. Only a path on this site; anything else goes to the home page.
 * This is the open-redirect guard, so keep it strict.
 */
export function destinoSeguro(volver: string | string[] | undefined | null): string {
  const texto = Array.isArray(volver) ? volver[0] : volver;
  if (!texto || texto.length > 300) return "/";
  if (!texto.startsWith("/") || texto.startsWith("//") || texto.includes("\\")) return "/";
  // Control characters (tabs, newlines) can change how browsers read the URL.
  if (/[\u0000-\u001f\u007f]/.test(texto)) return "/";
  const origen = "http://interno.invalid";
  try {
    if (new URL(texto, origen).origin !== origen) return "/";
  } catch {
    return "/";
  }
  // Sign-in must not send the visitor back to sign-in again.
  if (texto === "/entrar" || texto.startsWith("/entrar?") || texto.startsWith("/entrar/")) return "/";
  return texto;
}

/**
 * The decision for an owner-only page or route. `volver` is the path the visitor asked for.
 * Null session = not signed in. A session without es_admin = signed in, not an owner.
 */
export function decidirAcceso(sesion: SesionAcceso, volver: string): DecisionAcceso {
  if (sesion === null) return { tipo: "entrar", destino: rutaAcceso("/entrar", destinoSeguro(volver)) };
  if (!sesion.esAdmin) return { tipo: "denegar" };
  return { tipo: "permitir" };
}
