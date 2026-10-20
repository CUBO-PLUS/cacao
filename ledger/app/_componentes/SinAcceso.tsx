import Link from "next/link";

import { TEXTO_SIN_ACCESO } from "../../src/servidor/acceso.ts";

// Shown to a signed-in person who is not an owner. The page itself reads nothing.
export function SinAcceso() {
  return (
    <section className="bloque" role="status" aria-labelledby="sin-acceso">
      <h1 id="sin-acceso">Sin acceso</h1>
      <p className="nota" style={{ marginTop: "0.5rem" }}>
        {TEXTO_SIN_ACCESO}
      </p>
      <p className="acciones">
        <Link className="boton secundario" href="/">
          Ir al tablero
        </Link>
      </p>
    </section>
  );
}
