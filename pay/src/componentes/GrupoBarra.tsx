import { PRODUCTOS, type ProductoId } from '@/lib/grupo';

import estilos from './GrupoBarra.module.css';

// The group strip above every page: the wordmark, then the products. The current product is marked with
// aria-current and a Mazorca colour. On phones the strip scrolls sideways instead of wrapping.
export function GrupoBarra({ actual }: { actual: ProductoId }) {
  return (
    <nav aria-label="Grupo Cacao" className={`barra-grupo ${estilos.barra}`}>
      <ul className={estilos.lista}>
        {PRODUCTOS.map((p) => {
          const esActual = p.id === actual;
          return (
            <li key={p.id}>
              <a href={p.url} className={esActual ? estilos.actual : undefined} aria-current={esActual ? 'page' : undefined}>
                {p.id === 'cacao' ? <b>cacao</b> : p.marca}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
