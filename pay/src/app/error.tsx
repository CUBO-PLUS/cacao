'use client';

import Link from 'next/link';
import { useEffect } from 'react';

// The page broke. The reason goes to the log; the person gets a plain sentence and two ways out.
export default function ErrorPagina({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error('Error en CacaoPay:', error);
  }, [error]);

  return (
    <section className="vacio" role="alert" aria-labelledby="titulo-error-pagina">
      <h1 id="titulo-error-pagina">Algo no salió bien</h1>
      <p>Tuvimos un problema para mostrar esta página. Probá de nuevo; si sigue igual, volvé en un rato.</p>
      <div className="cargando__acciones">
        <button type="button" className="boton" onClick={() => reset()}>
          Probar de nuevo
        </button>
        <Link href="/" className="boton boton--secundario">
          Ir al inicio
        </Link>
      </div>
    </section>
  );
}
