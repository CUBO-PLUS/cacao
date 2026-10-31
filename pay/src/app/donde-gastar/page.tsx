import type { Metadata } from 'next';
import Link from 'next/link';
import { connection } from 'next/server';
import { Suspense } from 'react';

import { Paginacion } from '@/componentes/Paginacion';
import negocios from '@/data/negocios.json';
import {
  busquedaDeTexto,
  CATEGORIAS,
  categoriaDeTexto,
  fechaLarga,
  filtrarLugares,
  hrefLista,
  type Lugar,
  paginaDe,
  paginar,
} from '@/lib/negocios';

import { CercaDeMi } from './CercaDeMi';
import { FilaNegocio } from './FilaNegocio';
import estilos from './estilos.module.css';

export const metadata: Metadata = {
  title: 'Dónde gastar bitcoin',
};

// The list reads the search and the filters from the URL, per request, so it waits behind a boundary.
export const instant = false;

export default async function PaginaDondeGastar(props: PageProps<'/donde-gastar'>) {
  await connection();
  return (
    <Suspense fallback={<p role="status">Cargando los negocios…</p>}>
      <ListaNegocios busqueda={props.searchParams} />
    </Suspense>
  );
}

function texto(valor: string | string[] | undefined): string | undefined {
  return Array.isArray(valor) ? valor[0] : valor;
}

async function ListaNegocios({ busqueda }: { busqueda: PageProps<'/donde-gastar'>['searchParams'] }) {
  const params = await busqueda;
  const q = busquedaDeTexto(texto(params.q));
  const categoria = categoriaDeTexto(texto(params.categoria));
  const pagina = paginaDe(params.pagina);

  const lugares = negocios.lugares as Lugar[];
  const coincidencias = filtrarLugares(lugares, { busqueda: q, categoria });
  const pag = paginar(coincidencias, pagina);
  const filtrando = q !== '' || categoria !== null;
  const conteo = negocios.porCategoria as Record<string, number>;

  return (
    <div className={estilos.pagina}>
      <header className={estilos.encabezado}>
        <h1>Dónde gastar bitcoin</h1>
        <p className={estilos.total}>
          <span className={estilos.cifra}>{negocios.total}</span>
          <span>negocios en El Salvador</span>
        </p>
        <p>Estos negocios aceptan bitcoin según BTC Map. No son aliados de CacaoPay.</p>
        <p className={estilos.aviso}>
          El bitcoin de prueba de esta demo no lo acepta nadie: no tiene valor. Esta lista muestra dónde podría
          gastarse bitcoin real.
        </p>
      </header>

      <CercaDeMi />

      <section className={estilos.buscarSeccion} aria-labelledby="titulo-buscar">
        <h2 id="titulo-buscar">Buscar y filtrar</h2>
        <form action="/donde-gastar" method="get" role="search" className={estilos.buscar}>
          <label htmlFor="buscar-nombre" className="campo-etiqueta">
            Buscar por nombre
          </label>
          <div className={estilos.buscarFila}>
            <input
              id="buscar-nombre"
              name="q"
              type="search"
              defaultValue={q}
              maxLength={60}
              autoComplete="off"
              className="campo"
            />
            {categoria && <input type="hidden" name="categoria" value={categoria} />}
            <button type="submit" className="boton">
              Buscar
            </button>
          </div>
        </form>

        <nav aria-label="Categorías" className={estilos.chips}>
          <ul className={estilos.chipsLista}>
            <li>
              <Link
                href={hrefLista({ busqueda: q })}
                className={`boton ${categoria === null ? '' : 'boton--secundario'}`.trim()}
                aria-current={categoria === null ? 'page' : undefined}
              >
                Todos
              </Link>
            </li>
            {CATEGORIAS.map((c) => (
              <li key={c.clave}>
                <Link
                  href={hrefLista({ busqueda: q, categoria: c.clave })}
                  className={`boton ${categoria === c.clave ? '' : 'boton--secundario'}`.trim()}
                  aria-current={categoria === c.clave ? 'page' : undefined}
                >
                  {c.etiqueta} {conteo[c.clave] ?? 0}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </section>

      <section aria-label="Lista de negocios" className={estilos.lista}>
        <p role="status" className={estilos.nota}>
          {pag.total === 0
            ? 'Ningún negocio coincide con esa búsqueda.'
            : filtrando
              ? `Hay ${pag.total} ${pag.total === 1 ? 'negocio' : 'negocios'} con estos filtros.`
              : 'Lista completa, por orden alfabético.'}
        </p>

        {pag.total === 0 ? (
          <div className={estilos.vacio}>
            <p>Probá con una palabra más corta o quitá el filtro.</p>
            <Link href="/donde-gastar" className="boton boton--secundario">
              Ver todos
            </Link>
          </div>
        ) : (
          <>
            <ol className={estilos.lugares}>
              {pag.items.map((lugar) => (
                <FilaNegocio key={lugar.id} lugar={lugar} />
              ))}
            </ol>
            <Paginacion
              pagina={pag.pagina}
              totalPaginas={pag.totalPaginas}
              hrefDe={(p) => hrefLista({ busqueda: q, categoria, pagina: p })}
            />
          </>
        )}
      </section>

      <footer className={estilos.atribucion}>
        <p>
          Datos de{' '}
          <a href="https://btcmap.org/">BTC Map</a> y{' '}
          <a href="https://www.openstreetmap.org/copyright">colaboradores de OpenStreetMap</a> (ODbL).
        </p>
        <p>Lista actualizada el {fechaLarga(negocios.generado)}.</p>
      </footer>
    </div>
  );
}
