import Link from 'next/link';
import { Suspense } from 'react';

import { Boton } from '@/componentes/Boton';
import { Chip } from '@/componentes/Chip';
import { Puertas } from '@/componentes/Puertas';
import { TarjetaProducto } from '@/componentes/TarjetaProducto';
import { Vacio } from '@/componentes/Vacio';
import { usdCentavosASats } from '@/lib/dinero';
import { URL_PAY } from '@/lib/grupo';
import { DATOS } from '@/lib/negocios-bitcoin';
import { categorias, cotizacionSegura, productosDelCatalogo } from '@/servidor/catalogo';

// The filters come from the URL, so the catalogue is read per request and streams in.
// The heading above it is static.
export default function Inicio(props: PageProps<'/'>) {
  return (
    <>
      <Puertas actual="supermercado" />

      <div className="inicio">
        <section className="encabezado">
          <h1>Comprá directo al productor.</h1>
          <p>Precios en dólares. Cada vendedor tiene su propia tienda.</p>
          <p>Algunos negocios de esta página son perfiles de demostración: no reciben pedidos reales.</p>
        </section>

        <Suspense fallback={<CatalogoCargando />}>
          <CatalogoInicio busqueda={props.searchParams} />
        </Suspense>

        <p className="aviso">
          ¿Te mandan dinero del exterior? Seguí tu envío en{' '}
          <a href={URL_PAY}>CacaoPay</a>
        </p>

        <p className="aviso">
          <Link className="enlace-directorio" href="/negocios-bitcoin">
            Mirá los {DATOS.total} negocios de El Salvador que ya aceptan bitcoin
          </Link>
        </p>
      </div>
    </>
  );
}

function CatalogoCargando() {
  return (
    <div className="filtros" aria-busy="true">
      <p role="status">Cargando productos…</p>
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
function enlaceCatalogo(q: string, categoria?: number): string {
  const params = new URLSearchParams();
  if (q) params.set('q', q);
  if (categoria !== undefined) params.set('categoria', String(categoria));
  const texto = params.toString();
  return texto ? `/?${texto}` : '/';
}

async function CatalogoInicio({ busqueda }: { busqueda: PageProps<'/'>['searchParams'] }) {
  const params = await busqueda;
  const texto = valor(params.q);
  const textoCategoria = valor(params.categoria);
  const categoriaId = /^\d{1,4}$/.test(textoCategoria) ? Number(textoCategoria) : undefined;
  const filtrado = texto !== '' || categoriaId !== undefined;

  const [listaCategorias, productos, cotizacion] = await Promise.all([
    categorias(),
    productosDelCatalogo({ texto, categoriaId }),
    cotizacionSegura(),
  ]);

  return (
    <>
      <div className="filtros">
        <form className="buscador" action="/" method="get" role="search">
          <label className="solo-lectores" htmlFor="buscar">
            Buscar productos
          </label>
          <div className="buscador__fila">
            <input
              id="buscar"
              className="campo"
              name="q"
              type="search"
              placeholder="Buscar productos"
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
              <Chip href={enlaceCatalogo(texto)} activo={categoriaId === undefined}>
                Todo
              </Chip>
            </li>
            {listaCategorias.map((c) => (
              <li key={c.id}>
                <Chip href={enlaceCatalogo(texto, c.id)} activo={categoriaId === c.id}>
                  {c.nombre}
                </Chip>
              </li>
            ))}
          </ul>
        </nav>

        <p className="conteo">
          {productos.length === 1 ? '1 producto' : `${productos.length} productos`}
          {texto && ` para “${texto}”`}
        </p>
        {productos.length > 0 && cotizacion === null && (
          <p className="aviso">No pudimos leer el precio de bitcoin ahora. Mostramos solo dólares.</p>
        )}
      </div>

      <h2 className="solo-lectores">Productos</h2>

      {productos.length === 0 ? (
        filtrado ? (
          <Vacio
            texto="No hay productos con esa búsqueda o categoría."
            accion={{ href: '/', etiqueta: 'Quitar filtros' }}
          />
        ) : (
          <Vacio texto="Todavía no hay productos a la venta. Volvé pronto." />
        )
      ) : (
        <ul className="cuadricula">
          {productos.map((p, indice) => (
            <li key={p.id}>
              <TarjetaProducto
                producto={p}
                sats={cotizacion === null ? null : usdCentavosASats(p.precioUsdCentavos, cotizacion)}
                prioridad={indice < 4}
              />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
