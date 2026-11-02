import type { Metadata } from 'next';
import Link from 'next/link';

import { Chip } from '@/componentes/Chip';
import { ESTADOS_ORDEN, ETIQUETA_TIPO, formatoFecha, montoExacto, nombreVisible } from '@/app/admin/etiquetas';
import { ETIQUETA_ESTADO, type TipoOrden } from '@/lib/estados';
import { estadoDesde, ordenesAdmin, paginaDesde, POR_PAGINA, trabajosSinPagar } from '@/servidor/admin';
import { exigirAdmin } from '@/servidor/sesion';

import estilos from '../estilos.module.css';
import { TablaAdmin } from '../TablaAdmin';

export const metadata: Metadata = {
  title: 'Órdenes',
};

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function valor(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

// Only the two order types filter the list. "todas" and anything else show every order.
function tipoDesde(v: string | undefined): TipoOrden | null {
  return v === 'productos' || v === 'servicio' ? v : null;
}

type Filtros = { estado: string | null; tipo: TipoOrden | null };

// The link for one set of filters and page. Changing one filter keeps the other.
function enlace(filtros: Filtros, pagina: number): string {
  const params = new URLSearchParams();
  if (filtros.estado) params.set('estado', filtros.estado);
  if (filtros.tipo) params.set('tipo', filtros.tipo);
  if (pagina > 1) params.set('pagina', String(pagina));
  const texto = params.toString();
  return texto ? `/admin/ordenes?${texto}` : '/admin/ordenes';
}

export default async function PaginaOrdenes(props: Props) {
  const sesion = await exigirAdmin();
  const params = await props.searchParams;
  // Unknown states and types are ignored (show all). The page number defaults to 1.
  const estado = estadoDesde(valor(params.estado));
  const tipo = tipoDesde(valor(params.tipo));
  const pagina = paginaDesde(valor(params.pagina));
  const filtros: Filtros = { estado, tipo };

  const [datos, sinPagar] = await Promise.all([
    ordenesAdmin(sesion.usuario.id, { pagina, estado, tipo }),
    trabajosSinPagar(sesion.usuario.id),
  ]);
  const paginas = Math.max(1, Math.ceil(datos.total / POR_PAGINA));
  const desde = datos.total === 0 ? 0 : (datos.pagina - 1) * POR_PAGINA + 1;
  const hasta = Math.min(datos.pagina * POR_PAGINA, datos.total);

  return (
    <>
      {sinPagar.length > 0 && (
        <section id="sin-pagar" className={estilos.bloque} aria-labelledby="titulo-sin-pagar">
          <h2 id="titulo-sin-pagar" className={estilos.subtitulo}>
            Trabajos sin pagar hace más de 48 horas
          </h2>
          <p className={estilos.explicacion}>
            CacaoMarket no cobra por nadie. Podés revisar el caso y suspender el negocio o hablar con el cliente.
          </p>
          <ul className={estilos.grupo}>
            {sinPagar.map((t) => (
              <li key={t.id} className={estilos.sinPagarTarjeta}>
                <Link href={`/admin/ordenes/${t.id}`} className={estilos.nombreTarjeta}>
                  Trabajo {t.numero}
                </Link>
                <dl className={estilos.datos}>
                  <div>
                    <dt>Cliente</dt>
                    <dd>{nombreVisible(t.comprador)}</dd>
                  </div>
                  <div>
                    <dt>Negocio</dt>
                    <dd>{t.negocio || '—'}</dd>
                  </div>
                  <div>
                    <dt>Total</dt>
                    <dd className={estilos.dato}>{montoExacto(t.totalSats, t.totalUsdCentavos)}</dd>
                  </div>
                  <div>
                    <dt>Esperando pago</dt>
                    <dd>{textoDias(Math.floor(t.horasEsperando / 24))}</dd>
                  </div>
                </dl>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className={estilos.bloque} aria-labelledby="titulo-ordenes">
        <h2 id="titulo-ordenes" className={estilos.subtitulo}>
          Órdenes
        </h2>
        <p className={estilos.descripcion}>Todas las órdenes, de la más nueva a la más vieja.</p>

        <div className={estilos.filtros}>
          <nav aria-label="Filtrar por tipo" className={estilos.filtrosGrupo}>
            <p>Tipo</p>
            <ul className="chips">
              <li>
                <Chip href={enlace({ estado, tipo: null }, 1)} activo={tipo === null}>
                  Todas
                </Chip>
              </li>
              <li>
                <Chip href={enlace({ estado, tipo: 'productos' }, 1)} activo={tipo === 'productos'}>
                  {ETIQUETA_TIPO.productos}
                </Chip>
              </li>
              <li>
                <Chip href={enlace({ estado, tipo: 'servicio' }, 1)} activo={tipo === 'servicio'}>
                  {ETIQUETA_TIPO.servicio}
                </Chip>
              </li>
            </ul>
          </nav>

          <nav aria-label="Filtrar por estado" className={estilos.filtrosGrupo}>
            <p>Estado</p>
            <ul className="chips">
              <li>
                <Chip href={enlace({ estado: null, tipo }, 1)} activo={estado === null}>
                  Todas
                </Chip>
              </li>
              {ESTADOS_ORDEN.map((e) => (
                <li key={e}>
                  <Chip href={enlace({ estado: e, tipo }, 1)} activo={estado === e}>
                    {ETIQUETA_ESTADO[e]}
                  </Chip>
                </li>
              ))}
            </ul>
          </nav>
        </div>

        <p className={estilos.ayuda} aria-live="polite">
          {datos.total === 0
            ? estado === null && tipo === null
              ? 'Todavía no hay órdenes.'
              : 'No hay órdenes con este filtro.'
            : `Mostrando ${desde} a ${hasta} de ${datos.total}.`}
        </p>
      </section>

      {datos.filas.length > 0 && (
        <TablaAdmin
          titulo="Órdenes"
          encabezados={['Orden', 'Fecha', 'Tipo', 'Negocio', 'Comprador', 'Estado', 'Total']}
          filas={datos.filas.map((f) => ({
            clave: f.id,
            celdas: [
              <Link key="n" href={`/admin/ordenes/${f.id}`}>
                Orden {f.numero}
              </Link>,
              formatoFecha(f.creadaEn),
              ETIQUETA_TIPO[f.tipo],
              f.negocio || '—',
              nombreVisible(f.comprador),
              <span key="e" className={estilos.estado}>
                {ETIQUETA_ESTADO[f.estado]}
              </span>,
              <span key="t" className={estilos.dato}>
                {montoExacto(f.totalSats, f.totalUsdCentavos)}
              </span>,
            ],
          }))}
        />
      )}

      <nav aria-label="Páginas de órdenes" className={estilos.paginacion}>
        <p className={estilos.ayuda}>
          Página {datos.pagina} de {paginas}
        </p>
        <div className={estilos.paginacionFila}>
          {datos.pagina > 1 ? (
            <Link href={enlace(filtros, datos.pagina - 1)} className={estilos.paginacionBoton}>
              Página anterior
            </Link>
          ) : (
            <span className={estilos.paginacionBoton} aria-disabled="true">
              Página anterior
            </span>
          )}
          {datos.pagina < paginas ? (
            <Link href={enlace(filtros, datos.pagina + 1)} className={estilos.paginacionBoton}>
              Página siguiente
            </Link>
          ) : (
            <span className={estilos.paginacionBoton} aria-disabled="true">
              Página siguiente
            </span>
          )}
        </div>
      </nav>
    </>
  );
}

function textoDias(dias: number): string {
  return dias === 1 ? '1 día' : `${dias} días`;
}
