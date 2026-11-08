import Link from 'next/link';

import estilos from './ProximoPaso.module.css';

export interface OpcionProximoPaso {
  texto: string;
  /** A path inside Pay goes through the router; a full address opens the other product. */
  href: string;
  detalle: string;
}

// "¿Y ahora?": the next step after a success, one card per option, in the site's bordered card style.
export function ProximoPaso({ opciones }: { opciones: OpcionProximoPaso[] }) {
  return (
    <section className={estilos.bloque} aria-labelledby="proximo-paso">
      <h2 id="proximo-paso" className={estilos.titulo}>
        ¿Y ahora?
      </h2>
      <ul className={estilos.lista}>
        {opciones.map((o) => (
          <li key={o.href}>
            {o.href.startsWith('/') ? (
              <Link href={o.href} className={estilos.tarjeta}>
                <strong>{o.texto}</strong>
                <span>{o.detalle}</span>
              </Link>
            ) : (
              <a href={o.href} className={estilos.tarjeta}>
                <strong>{o.texto}</strong>
                <span>{o.detalle}</span>
              </a>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
