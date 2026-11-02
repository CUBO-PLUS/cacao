import Link from 'next/link';

import styles from './Puertas.module.css';

export type Seccion = 'supermercado' | 'servicios' | 'necesito';

const PUERTAS: { id: Seccion; nombre: string; href: string; linea: string }[] = [
  { id: 'supermercado', nombre: 'Supermercado', href: '/', linea: 'Productos del huerto' },
  // trailingSlash is on, so the slashed address is the canonical one for every section.
  { id: 'servicios', nombre: 'Servicios', href: '/servicios/', linea: 'Gente que trabaja' },
  { id: 'necesito', nombre: 'Necesito', href: '/necesito/', linea: 'Pedí lo que buscás' },
];

// The three-way switch between the sections. It is plain links: no data, no session.
// The current section is marked with aria-current so a screen reader announces it.
export function Puertas({ actual }: { actual: Seccion }) {
  return (
    <nav aria-label="Secciones" className={styles.nav}>
      <ul className={styles.lista}>
        {PUERTAS.map((puerta) => {
          const activa = puerta.id === actual;
          return (
            <li key={puerta.id} className={styles.item}>
              <Link
                href={puerta.href}
                className={styles.puerta}
                aria-current={activa ? 'page' : undefined}
              >
                <span className={styles.nombre}>{puerta.nombre}</span>
                <span className={styles.linea}>{puerta.linea}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
