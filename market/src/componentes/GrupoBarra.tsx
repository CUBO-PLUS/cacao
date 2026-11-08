import { PRODUCTOS, type ProductoId } from '@/lib/grupo';

import estilos from './GrupoBarra.module.css';

// The slim strip above every page: the group's products as links, the current one marked.
// It scrolls away with the page, above the site's own header. On phones it scrolls sideways.
export function GrupoBarra({ actual }: { actual: ProductoId }) {
  return (
    <nav aria-label="Grupo Cacao" className={estilos.barra}>
      <ul className={estilos.lista}>
        {PRODUCTOS.map((p) => {
          const etiqueta = p.id === 'cacao' ? 'cacao' : p.marca;
          const esActual = p.id === actual;
          return (
            <li key={p.id}>
              <a
                href={p.url}
                className={estilos.enlace}
                aria-current={esActual ? 'page' : undefined}
              >
                {p.id === 'cacao' ? <b>{etiqueta}</b> : etiqueta}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
