import type { Metadata } from 'next';
import Link from 'next/link';
import { connection } from 'next/server';
import { Suspense } from 'react';

import { Boton } from '@/componentes/Boton';
import { EtiquetaEstado } from '@/componentes/EtiquetaEstado';
import { Paginacion } from '@/componentes/Paginacion';
import { fechaSv, primerNombre } from '@/componentes/textosEnvio';
import { formatoMonto } from '@/lib/cotizacion';
import { formatoUsd } from '@/lib/dinero';
import { usdCotizadoCentavos } from '@/lib/transferencias';
import { recibidos, type Envio, vincularRecibidos } from '@/servidor/transferencias';
import { exigirSesion } from '@/servidor/sesion';

import estilos from './estilos.module.css';

export const metadata: Metadata = {
  title: 'Dinero que te mandaron',
};

// Blocking, so a visitor who is not signed in is redirected before anything streams.
export const instant = false;

// The list itself is read per request, so it waits behind a boundary and the page shell streams first.
export default async function PaginaRecibidos(props: PageProps<'/recibidos'>) {
  await connection();
  const sesion = await exigirSesion('/recibidos');
  return (
    <Suspense fallback={<p role="status">Cargando el dinero que te mandaron…</p>}>
      <ListaRecibidos sesionId={sesion.usuario.id} busqueda={props.searchParams} />
    </Suspense>
  );
}

// A page number from the URL. Anything that is not a whole number from 1 up is the first page.
function paginaDe(valor: string | string[] | undefined): number {
  const texto = Array.isArray(valor) ? valor[0] : valor;
  return texto && /^\d+$/.test(texto) && Number(texto) >= 1 ? Number(texto) : 1;
}

async function ListaRecibidos({
  sesionId,
  busqueda,
}: {
  sesionId: string;
  busqueda: PageProps<'/recibidos'>['searchParams'];
}) {
  const params = await busqueda;
  const pagina = paginaDe(params.pagina);
  // Transfers sent to this person's phone or email before they signed in are linked first.
  await vincularRecibidos(sesionId);
  const datos = await recibidos(sesionId, { pagina });
  const totalPaginas = Math.max(1, Math.ceil(datos.total / datos.porPagina));

  return (
    <div className={estilos.pagina}>
      <section className="encabezado">
        <h1>Dinero que te mandaron</h1>
        <p>Del más nuevo al más viejo. Tocá un envío para ver cómo va.</p>
      </section>

      {datos.total === 0 ? (
        <div className="vacio">
          <p>
            Todavía no te han mandado dinero. Cuando alguien te envíe a tu celular o a tu correo, sus envíos aparecen
            aquí.
          </p>
          <p>
            Si te mandaron un enlace de cobro o un código de envío, podés usarlo sin tener cuenta: el enlace te lleva a
            cobrar y el código a seguir el envío.
          </p>
          <Boton href="/rastrear" variante="secundario">
            ¿Tenés un código? Seguí tu envío
          </Boton>
        </div>
      ) : datos.envios.length === 0 ? (
        <div className="vacio">
          <p>No hay envíos en esta página.</p>
          <Boton href="/recibidos" variante="secundario">
            Volver al primer envío
          </Boton>
        </div>
      ) : (
        <>
          <ul className={estilos.lista}>
            {datos.envios.map((envio) => (
              <li key={envio.id}>
                <TarjetaRecibido envio={envio} />
              </li>
            ))}
          </ul>
          <Paginacion
            pagina={pagina}
            totalPaginas={totalPaginas}
            hrefDe={(p) => (p === 1 ? '/recibidos' : `/recibidos?pagina=${p}`)}
          />
        </>
      )}
    </div>
  );
}

function TarjetaRecibido({ envio }: { envio: Envio }) {
  // The dollars fixed when the transfer was quoted; no live price is read for the list.
  const usd = usdCotizadoCentavos(envio);
  return (
    <Link href={`/recibidos/${envio.id}`} className={estilos.tarjeta}>
      <span className={estilos.de}>Te mandó {primerNombre(envio.remitenteNombre)}</span>
      <span className={estilos.monto}>{formatoMonto(envio.montoDestino, envio.monedaDestino)}</span>
      {envio.monedaDestino === 'SATS' && usd !== null && (
        <span className={estilos.dolares}>{`Unos ${formatoUsd(usd)} en dólares`}</span>
      )}
      <span>
        <EtiquetaEstado estado={envio.estado} entrega={envio.entrega} />
      </span>
      <time className={estilos.fecha} dateTime={envio.creadaEn}>
        {fechaSv(envio.creadaEn)}
      </time>
    </Link>
  );
}
