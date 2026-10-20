import { destinoSeguro, rutaAcceso } from "../../src/servidor/acceso.ts";
import { sesionActual } from "../../src/servidor/sesion.ts";

// Clerk sends the visitor here after signing in. The destination stays in the `volver` query, so this route
// reads it from the URL on every hop. No session goes back to sign-in; a session goes to its destination.
export async function GET(request: Request) {
  const volver = destinoSeguro(new URL(request.url).searchParams.get("volver"));
  const sesion = await sesionActual();
  const destino = sesion ? volver : rutaAcceso("/entrar", volver);
  return new Response(null, {
    status: 307,
    headers: { Location: destino, "Cache-Control": "private, no-store" },
  });
}
