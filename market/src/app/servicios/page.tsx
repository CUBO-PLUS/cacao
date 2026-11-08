import type { Metadata } from 'next';
import { Suspense } from 'react';

import { Boton } from '@/componentes/Boton';
import { Chip } from '@/componentes/Chip';
import { Puertas } from '@/componentes/Puertas';
import { Vacio } from '@/componentes/Vacio';
import { cotizacionSegura } from '@/servidor/catalogo';
import { catalogoServicios, categoriasServicio } from '@/servidor/servicios';

import { TarjetaServicio } from './TarjetaServicio';

export const metadata: Metadata = {
  title: 'Servicios',
};

// The filters come from the URL, so the list is read per request and streams in.
// The heading above it is static.
export default function PaginaServicios(props: PageProps<'/servicios'>) {
  return (
    <>
      <Puertas actual="servicios" />

      <section className="encabezado">
        <h1>Servicios</h1>
        <p>Contratá a gente de tu zona y pagá en bitcoin cuando el trabajo esté hecho. Cada precio se muestra en dólares.</p>
      </section>

      <Suspense fallback={<CatalogoCargando />}>
        <CatalogoServicios busqueda={props.searchParams} />
      </Suspense>
    </>
  );
}

function CatalogoCargando() {
  return (
    <div className="filtros" aria-busy="true">
      <p role="status">Cargando servicios…</p>
      <ul className="cuadricula" aria-hidden="true">
        {[0, 1, 2, 3].map((n) => (
          <li key={n}>
            <div className="esqueleto" />
          </li>
        ))}
      </ul>
    </div>
  );
}

function valor(v: string | string[] | undefined): string {
  const texto = Array.isArray(v) ? v[0] : v;
  return (texto ?? '').trim();
}

// The link for a filter state. Keeps the search text when the category changes, and the category
// when the search text changes.
function enlaceServicios(q: string, categoria?: number): string {
  const params = new URLSearchParams();
  if (q) params.set('q', q);
  if (categoria !== undefined) params.set('categoria', String(categoria));
  const texto = params.toString();
  return texto ? `/servicios?${texto}` : '/servicios';
}

async function CatalogoServicios({ busqueda }: { busqueda: PageProps<'/servicios'>['searchParams'] }) {
  const params = await busqueda;
  const texto = valor(params.q);
  const textoCategoria = valor(params.categoria);
  const categoriaId = /^\d{1,4}$/.test(textoCategoria) ? Number(textoCategoria) : undefined;
  const filtrado = texto !== '' || categoriaId !== undefined;

  const [listaCategorias, servicios, cotizacion] = await Promise.all([
    categoriasServicio(),
    catalogoServicios({ busqueda: texto, categoriaId }),
    cotizacionSegura(),
  ]);

  // A category chip shows only when it has services for the search text. The list above is already
  // narrowed by category, so the other categories need the search alone. The active chip always stays.
  const deLaBusqueda = categoriaId === undefined ? servicios : await catalogoServicios({ busqueda: texto });
  const conServicios = new Set(deLaBusqueda.map((s) => s.categoriaId));
  const categoriasConServicios = listaCategorias.filter((c) => c.id === categoriaId || conServicios.has(c.id));

  const hayFijos = servicios.some((s) => s.tipoPrecio === 'fijo');

  return (
    <>
      <div className="filtros">
        <form className="buscador" action="/servicios" method="get" role="search">
          <label className="campo-etiqueta" htmlFor="buscar-servicios">
            Buscar servicios
          </label>
          <div className="buscador__fila">
            <input
              id="buscar-servicios"
              className="campo"
              name="q"
              type="search"
              // The server cuts the search at 80 characters (textoBusqueda); the field says so too.
              maxLength={80}
              defaultValue={texto}
              autoComplete="off"
            />
            <Boton type="submit">Buscar</Boton>
          </div>
          {categoriaId !== undefined && <input type="hidden" name="categoria" value={categoriaId} />}
        </form>

        <nav aria-label="Categorías">
          <ul className="chips">
            <li>
              <Chip href={enlaceServicios(texto)} activo={categoriaId === undefined}>
                Todo
              </Chip>
            </li>
            {categoriasConServicios.map((c) => (
              <li key={c.id}>
                <Chip href={enlaceServicios(texto, c.id)} activo={categoriaId === c.id}>
                  {c.nombre}
                </Chip>
              </li>
            ))}
          </ul>
        </nav>

        <p className="conteo">
          {servicios.length === 1 ? '1 servicio' : `${servicios.length} servicios`}
          {texto && ` para “${texto}”`}
        </p>
        {hayFijos && cotizacion === null && (
          <p className="aviso">No pudimos leer el precio de bitcoin ahora. Mostramos solo dólares.</p>
        )}
      </div>

      <h2 className="solo-lectores">Servicios</h2>

      {servicios.length === 0 ? (
        filtrado ? (
          <Vacio
            texto="No hay servicios con esa búsqueda o categoría."
            accion={{ href: '/servicios', etiqueta: 'Quitar filtros' }}
          />
        ) : (
          <Vacio texto="Todavía no hay servicios publicados. Volvé pronto." />
        )
      ) : (
        <ul className="cuadricula">
          {servicios.map((s, indice) => (
            <li key={s.id}>
              <TarjetaServicio servicio={s} cotizacion={cotizacion} prioridad={indice < 4} />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
