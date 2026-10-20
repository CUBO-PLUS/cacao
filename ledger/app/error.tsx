"use client";

import { useEffect } from "react";

// Last-resort boundary for the pages under the shared layout. The message is plain; the cause goes to the console.
export default function ErrorDePagina({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <section className="bloque" role="alert" aria-labelledby="error-titulo">
      <h1 id="error-titulo">Algo salió mal</h1>
      <p className="nota" style={{ marginTop: "0.5rem" }}>
        No se pudo cargar esta página. Podés intentar de nuevo.
      </p>
      <div className="acciones">
        <button type="button" className="boton" onClick={() => reset()}>
          Intentar de nuevo
        </button>
      </div>
    </section>
  );
}
