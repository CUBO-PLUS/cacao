import type { Metadata } from 'next';
import { connection } from 'next/server';
import { Suspense } from 'react';

import { Boton } from '@/componentes/Boton';
import { Vacio } from '@/componentes/Vacio';
import {
  enlaceDeFiltros,
  ETIQUETA_FILTRO,
  estadosDeFiltro,
  FILTROS_ESTADO,
  parsearFiltros,
  textoVacio,
  type FiltroEstado,
} from '@/lib/filtrosEnvios';
import { exigirSesion } from '@/servidor/sesion';
import { misEnvios, POR_PAGINA, type PaginaEnvios } from '@/servidor/transferencias';

import { TarjetaEnvio } from './TarjetaEnvio';
import estilos from './estilos.module.css';

export const metadata: Metadata = {
  title: 'Mis envíos',
};

// The filter, the search and the page come from the URL, so they are read per request.
export default function PaginaEnvios(props: PageProps<'/envios'>) {
  return (
    <Suspense fallback={<p role="status">Cargando tus envíos…</p>}>
      <Lista busqueda={props.searchParams} />
    </Suspense>
  );
}

async function Lista({ busqueda }: { busqueda: PageProps<'/envios'>['searchParams'] }) {
  await connection();
  const params = await busqueda;
  // A redirect to the sign-in page happens here, outside any try block.
  const sesion = await exigirSesion('/envios');
  const { filtro, busqueda: texto, pagina } = parsearFiltros(params);

  let datos: PaginaEnvios;
  try {
    datos = await misEnvios(sesion.usuario.id, { pagina, estados: estadosDeFiltro(filtro), busqueda: texto });
  } catch (error) {
    console.error('Cargar envíos:', error instanceof Error ? error.message : error);
    return <ErrorCarga filtro={filtro} busqueda={texto} />;
  }

  const totalPaginas = Math.max(1, Math.ceil(datos.total / POR_PAGINA));
  const sinFiltros = filtro === 'todos' && texto === '';
  // With no filter, the transfers still waiting for the sender come first, then the rest.
  const porConfirmar = sinFiltros ? datos.envios.filter((envio) => envio.estado === 'creada') : [];
  const demas = sinFiltros ? datos.envios.filter((envio) => envio.estado !== 'creada') : datos.envios;

  return (
    <div className={estilos.lista}>
      <section className={estilos.encabezado}>
        <h1>Mis envíos</h1>
        <div>
          <Boton href="/enviar">Enviar dinero</Boton>
        </div>
      </section>

      <Filtros filtro={filtro} busqueda={texto} />

      {datos.envios.length === 0 && datos.total === 0 && (
        <Vacio
          texto={textoVacio(filtro, texto)}
          accion={
            sinFiltros
              ? { href: '/enviar', etiqueta: 'Enviar dinero' }
              : { href: '/envios', etiqueta: 'Ver todos mis envíos' }
          }
        />
      )}

      {datos.envios.length === 0 && datos.total > 0 && (
        <Vacio texto="No hay envíos en esta página." accion={{ href: enlaceDeFiltros(filtro, texto), etiqueta: 'Ver la primera página' }} />
      )}

      {porConfirmar.length > 0 && (
        <section className={estilos.bloque} aria-labelledby="titulo-por-confirmar">
          <h2 id="titulo-por-confirmar">Te falta confirmar</h2>
          <ul className={estilos.tarjetas}>
            {porConfirmar.map((envio) => (
              <li key={envio.id}>
                <TarjetaEnvio envio={envio} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {demas.length > 0 && (
        <section className={estilos.bloque} aria-labelledby="titulo-demas">
          <h2 id="titulo-demas">{porConfirmar.length > 0 ? 'Los demás envíos' : 'Envíos'}</h2>
          <ul className={estilos.tarjetas}>
            {demas.map((envio) => (
              <li key={envio.id}>
                <TarjetaEnvio envio={envio} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {datos.total > POR_PAGINA && (
        <nav aria-label="Páginas de envíos" className={estilos.paginas}>
          {pagina > 1 && (
            <Boton href={enlaceDeFiltros(filtro, texto, pagina - 1)} variante="secundario">
              Anterior
            </Boton>
          )}
          <p className={estilos.fecha}>
            Página {pagina} de {totalPaginas}
          </p>
          {pagina < totalPaginas && (
            <Boton href={enlaceDeFiltros(filtro, texto, pagina + 1)} variante="secundario">
              Siguiente
            </Boton>
          )}
        </nav>
      )}
    </div>
  );
}

/** The chips for each state and the search box. Plain GET links and a GET form: no script needed. */
function Filtros({ filtro, busqueda }: { filtro: FiltroEstado; busqueda: string }) {
  return (
    <div className={estilos.filtros}>
      <nav aria-label="Filtrar envíos por estado" className={estilos.chips}>
        {FILTROS_ESTADO.map((valor) => (
          <a
            key={valor}
            href={enlaceDeFiltros(valor, busqueda)}
            className={`${estilos.chip} ${valor === filtro ? estilos.chipActual : ''}`}
            aria-current={valor === filtro ? 'page' : undefined}
          >
            {ETIQUETA_FILTRO[valor]}
          </a>
        ))}
      </nav>

      <form action="/envios" method="get" role="search" className={estilos.buscador}>
        {filtro !== 'todos' && <input type="hidden" name="estado" value={filtro} />}
        <label htmlFor="buscar-envio" className="campo-etiqueta">
          Buscar por código o por nombre
        </label>
        <div className={estilos.buscadorFila}>
          <input
            id="buscar-envio"
            name="q"
            type="search"
            className="campo"
            defaultValue={busqueda}
            maxLength={60}
            autoComplete="off"
            placeholder="CP-XXXX-XXXX o Marta"
          />
          <button type="submit" className="boton boton--secundario">
            Buscar
          </button>
        </div>
      </form>
    </div>
  );
}

function ErrorCarga({ filtro, busqueda }: { filtro: FiltroEstado; busqueda: string }) {
  return (
    <div className={estilos.lista}>
      <section className={estilos.encabezado}>
        <h1>Mis envíos</h1>
      </section>
      <Filtros filtro={filtro} busqueda={busqueda} />
      <div role="alert" className={estilos.errorCarga}>
        <p>No pudimos cargar tus envíos. Probá de nuevo en un momento.</p>
        <Boton href={enlaceDeFiltros(filtro, busqueda)} variante="secundario">
          Volver a intentar
        </Boton>
      </div>
    </div>
  );
}
