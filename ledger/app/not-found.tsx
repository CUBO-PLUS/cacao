import Link from "next/link";

export const metadata = { title: "No encontrado" };

export default function NoEncontrado() {
  return (
    <section className="bloque" aria-labelledby="no-encontrado-titulo">
      <h1 id="no-encontrado-titulo">No encontramos esa página</h1>
      <p className="nota" style={{ marginTop: "0.5rem" }}>
        Puede que el ticket o el mes no existan. Volvé al tablero o a la lista de tickets.
      </p>
      <p className="acciones">
        <Link className="boton" href="/">
          Ir al tablero
        </Link>
        <Link className="boton secundario" href="/tickets">
          Ver tickets
        </Link>
      </p>
    </section>
  );
}
