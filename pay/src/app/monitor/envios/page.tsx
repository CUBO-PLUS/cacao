import type { Metadata } from 'next';
import Link from 'next/link';
import { connection } from 'next/server';
import { Suspense } from 'react';

import { EtiquetaEstado } from '@/componentes/EtiquetaEstado';
import { Paginacion } from '@/componentes/Paginacion';
import { fechaSv, primerNombre } from '@/componentes/textosEnvio';
import tabla from '@/componentes/Tabla.module.css';
import { formatoMonto } from '@/lib/cotizacion';
import { ETIQUETA_ENTREGA, ETIQUETA_ESTADO, type EstadoEnvio } from '@/lib/transferencias';
import { todosLosEnvios } from '@/servidor/monitor';
import { exigirAdmin } from '@/servidor/sesion';

import estilos from '../estilos.module.css';

export const metadata: Metadata = {
  title: 'Envíos',
};

export default function PaginaEnvios(props: PageProps<'/monitor/envios'>) {
  return (
    <Suspense fallback={<p role="status">Cargando los envíos…</p>}>
      <ListaEnvios busqueda={props.searchParams} />
    </Suspense>
  );
}

const ESTADOS = Object.keys(ETIQUETA_ESTADO) as EstadoEnvio[];

function valorDe(valor: string | string[] | undefined): string | undefined {
  return Array.isArray(valor) ? valor[0] : valor;
}

// Only a state the transfers can have filters the list; anything else shows all of them.
function estadoDe(valor: string | undefined): EstadoEnvio | undefined {
  return ESTADOS.find((estado) => estado === valor);
}

function paginaDe(valor: string | undefined): number {
  return valor && /^\d+$/.test(valor) && Number(valor) >= 1 ? Number(valor) : 1;
}

async function ListaEnvios({ busqueda }: { busqueda: PageProps<'/monitor/envios'>['searchParams'] }) {
  await connection();
  const params = await busqueda;
  const sesion = await exigirAdmin('/monitor/envios');
  const estado = estadoDe(valorDe(params.estado));
  const pagina = paginaDe(valorDe(params.pagina));
  const resultado = await todosLosEnvios(sesion.usuario.id, { estado, pagina });

  const hrefDe = (p: number) => {
    const query = new URLSearchParams();
    if (estado) query.set('estado', estado);
    if (p > 1) query.set('pagina', String(p));
    const texto = query.toString();
    return texto ? `/monitor/envios?${texto}` : '/monitor/envios';
  };

  return (
    <section className={estilos.seccion} aria-labelledby="titulo-envios">
      <div className={estilos.encabezadoSeccion}>
        <h2 id="titulo-envios">Envíos</h2>
        <p className={estilos.leyenda}>Del más nuevo al más viejo. Tocá el código para ver el detalle.</p>
      </div>

      <form action="/monitor/envios" method="get" className={estilos.filtro}>
        <div className={estilos.filtroCampo}>
          <label htmlFor="estado" className="campo-etiqueta">
            Estado
          </label>
          <select id="estado" name="estado" className="campo" defaultValue={estado ?? ''}>
            <option value="">Todos los estados</option>
            {ESTADOS.map((e) => (
              <option key={e} value={e}>
                {ETIQUETA_ESTADO[e]}
              </option>
            ))}
          </select>
        </div>
        <button type="submit" className="boton">
          Filtrar
        </button>
      </form>

      {!resultado.ok ? (
        <p role="alert" className={estilos.error}>
          {resultado.mensaje}
        </p>
      ) : resultado.dato.total === 0 ? (
        <p>Todavía no hay envíos con este filtro.</p>
      ) : (
        <>
          <p className={estilos.leyenda}>
            {resultado.dato.total === 1 ? '1 envío' : `${resultado.dato.total} envíos`}
          </p>
          <div className={tabla.envoltura}>
            <table className={tabla.tabla}>
              <caption className={tabla.leyenda}>Envíos y su estado</caption>
              <thead>
                <tr>
                  <th scope="col">Código</th>
                  <th scope="col">Quién envía</th>
                  <th scope="col">Destinatario</th>
                  <th scope="col">Enviado</th>
                  <th scope="col">Recibe</th>
                  <th scope="col">Entrega</th>
                  <th scope="col">Estado</th>
                  <th scope="col">Creado</th>
                </tr>
              </thead>
              <tbody>
                {resultado.dato.envios.map((e) => (
                  <tr key={e.id}>
                    <th scope="row">
                      <Link href={`/monitor/envios/${e.id}`} className={estilos.mono}>
                        {e.codigo}
                      </Link>
                    </th>
                    <td data-etiqueta="Quién envía">{primerNombre(e.remitenteNombre, 'Sin nombre')}</td>
                    <td data-etiqueta="Destinatario">
                      {e.destinatarioNombre}
                      <br />
                      <span className={estilos.mono}>{e.destinatarioContactoEnmascarado}</span>
                    </td>
                    <td data-etiqueta="Enviado">{formatoMonto(e.montoOrigenCentavos, e.monedaOrigen)}</td>
                    <td data-etiqueta="Recibe">{formatoMonto(e.montoDestino, e.monedaDestino)}</td>
                    <td data-etiqueta="Entrega">{ETIQUETA_ENTREGA[e.entrega]}</td>
                    <td data-etiqueta="Estado">
                      <EtiquetaEstado estado={e.estado} />
                      {e.pagoTardioEn && <span className={estilos.devolver}>Devolver pago</span>}
                    </td>
                    <td data-etiqueta="Creado">
                      <time dateTime={e.creadaEn}>{fechaSv(e.creadaEn)}</time>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Paginacion
            pagina={resultado.dato.pagina}
            totalPaginas={Math.max(1, Math.ceil(resultado.dato.total / resultado.dato.porPagina))}
            hrefDe={hrefDe}
          />
        </>
      )}
    </section>
  );
}
