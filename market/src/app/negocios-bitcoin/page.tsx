import type { Metadata } from 'next';
import { Suspense } from 'react';

import { Boton } from '@/componentes/Boton';
import { Chip } from '@/componentes/Chip';
import { Vacio } from '@/componentes/Vacio';
import {
  CATEGORIAS,
  DATOS,
  enlaceDirectorio,
  fechaLarga,
  filtrarNegocios,
  leerFiltro,
  nombreCategoria,
  ordenarNegocios,
  paginar,
  sitioDe,
} from '@/lib/negocios-bitcoin';

// A directory, not a store. It reads only the JSON file from BTC Map: no database, no cart, no prices.
// The list is server-rendered and paged, so the whole file is never sent to the browser.
const LISTA = ordenarNegocios(DATOS.lugares);

export const metadata: Metadata = {
  title: 'Negocios que aceptan bitcoin',
};

export default function PaginaNegociosBitcoin(props: PageProps<'/negocios-bitcoin'>) {
  return (
    <div className="directorio">
      <header className="directorio__cabeza">
        <h1>Negocios que aceptan bitcoin</h1>
        <p className="directorio__cifra">
          <span>{DATOS.total}</span> negocios en El Salvador
        </p>
        <p className="directorio__aviso">Estos negocios ya aceptan bitcoin según BTC Map. No venden en CacaoMarket.</p>
      </header>

      <Suspense fallback={<p role="status">Cargando negocios…</p>}>
        <Listado busqueda={props.searchParams} />
      </Suspense>

      <p className="directorio__fuente">
        Datos de{' '}
        <a href="https://btcmap.org/" rel="noopener noreferrer">
          BTC Map
        </a>{' '}
        y colaboradores de{' '}
        <a href="https://www.openstreetmap.org/copyright" rel="noopener noreferrer">
          OpenStreetMap
        </a>{' '}
        (ODbL). Lista generada el {fechaLarga(DATOS.generado)}.
      </p>
    </div>
  );
}

async function Listado({ busqueda }: { busqueda: PageProps<'/negocios-bitcoin'>['searchParams'] }) {
  const filtro = leerFiltro(await busqueda);
  const encontrados = filtrarNegocios(LISTA, filtro);
  const pagina = paginar(encontrados, filtro.pagina);
  const filtrado = filtro.texto !== '' || filtro.categoria !== undefined;

  return (
    <>
      <form className="buscador" action="/negocios-bitcoin" method="get" role="search">
        <label className="campo-etiqueta" htmlFor="buscar-negocio">
          Buscar por nombre
        </label>
        <div className="buscador__fila">
          <input
            id="buscar-negocio"
            className="campo"
            name="q"
            type="search"
            defaultValue={filtro.texto}
            autoComplete="off"
          />
          <Boton type="submit">Buscar</Boton>
        </div>
        {filtro.categoria !== undefined && <input type="hidden" name="categoria" value={filtro.categoria} />}
      </form>

      <nav aria-label="Categorías de negocios">
        <ul className="chips">
          <li>
            <Chip href={enlaceDirectorio({ texto: filtro.texto })} activo={filtro.categoria === undefined}>
              Todos
            </Chip>
          </li>
          {CATEGORIAS.map((c) => (
            <li key={c.id}>
              <Chip
                href={enlaceDirectorio({ texto: filtro.texto, categoria: c.id })}
                activo={filtro.categoria === c.id}
              >
                {c.nombre} ({DATOS.porCategoria[c.id]})
              </Chip>
            </li>
          ))}
        </ul>
      </nav>

      <p className="conteo">
        {encontrados.length === 1 ? '1 negocio' : `${encontrados.length} negocios`}
        {filtro.texto && ` para “${filtro.texto}”`}
      </p>
      <p className="directorio__dato">
        Los enlaces de cada negocio abren otra página, fuera de CacaoMarket: su sitio web o su ficha en BTC Map.
      </p>

      {pagina.items.length === 0 ? (
        <Vacio
          texto="No encontramos negocios con esa búsqueda o categoría."
          accion={filtrado ? { href: '/negocios-bitcoin', etiqueta: 'Quitar filtros' } : undefined}
        />
      ) : (
        <ul className="directorio__lista">
          {pagina.items.map((lugar) => {
            const sitio = sitioDe(lugar);
            return (
              <li key={lugar.id} className="directorio__item">
                <h2 className="directorio__nombre">{lugar.nombre}</h2>
                <p className="directorio__dato">
                  {nombreCategoria(lugar.categoria)}
                  {lugar.verificado && ` · Revisado el ${fechaLarga(lugar.verificado)}`}
                </p>
                <p>
                  <a href={sitio.href} rel="noopener noreferrer">
                    {sitio.etiqueta}
                  </a>
                </p>
              </li>
            );
          })}
        </ul>
      )}

      {pagina.paginas > 1 && (
        <nav aria-label="Páginas de negocios" className="directorio__paginas">
          {pagina.pagina > 1 ? (
            <Boton
              href={enlaceDirectorio({ texto: filtro.texto, categoria: filtro.categoria, pagina: pagina.pagina - 1 })}
              variante="secundario"
            >
              Página anterior
            </Boton>
          ) : (
            <span />
          )}
          <p>
            Página {pagina.pagina} de {pagina.paginas}
          </p>
          {pagina.pagina < pagina.paginas ? (
            <Boton
              href={enlaceDirectorio({ texto: filtro.texto, categoria: filtro.categoria, pagina: pagina.pagina + 1 })}
              variante="secundario"
            >
              Página siguiente
            </Boton>
          ) : (
            <span />
          )}
        </nav>
      )}
    </>
  );
}
