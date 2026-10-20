// Shown when the ticket store cannot be read. The page still renders, with no details for the public.
export function SinDatos() {
  return (
    <section className="bloque" role="alert" aria-labelledby="sin-datos">
      <h2 id="sin-datos">No se pudo leer los datos</h2>
      <p className="nota">Intentá de nuevo en un momento. Si sigue igual, avisale a Grupo Cacao.</p>
    </section>
  );
}
