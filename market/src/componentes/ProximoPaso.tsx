import estilos from './ProximoPaso.module.css';

export interface OpcionProximoPaso {
  href: string;
  titulo: string;
  texto: string;
}

// The "¿Y ahora?" block after a customer success: one or two cards to the natural next product.
// Plain links, so they open in the same tab like the rest of the site.
export function ProximoPaso({
  id,
  opciones,
  intro,
}: {
  /** The id of the heading, unique on the page. */
  id: string;
  opciones: OpcionProximoPaso[];
  /** One plain line under the heading, what the customer keeps. */
  intro?: string;
}) {
  return (
    <section className={estilos.bloque} aria-labelledby={id}>
      <h2 id={id}>¿Y ahora?</h2>
      {intro && <p className={estilos.intro}>{intro}</p>}
      <ul className={estilos.lista}>
        {opciones.map((o) => (
          <li key={o.href}>
            <a className={estilos.tarjeta} href={o.href}>
              <span className={estilos.titulo}>{o.titulo}</span>
              <span className={estilos.texto}>{o.texto}</span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
