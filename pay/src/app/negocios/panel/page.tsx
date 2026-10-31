import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { connection } from 'next/server';
import { Suspense } from 'react';

import { ETIQUETA_ESTADO, formatoDolares, horaSV } from '@/lib/cobro-negocio';
import { negocioDeCuenta, resumenNegocio } from '@/servidor/negocios';
import { sesionActual } from '@/servidor/sesion';

import estilos from '../estilos.module.css';

export const metadata: Metadata = {
  title: 'Ventas de tu negocio',
};

// The business's own numbers, read per request for the signed-in account only.
export default function PaginaPanel() {
  return (
    <Suspense fallback={<p role="status">Cargando las ventas…</p>}>
      <Contenido />
    </Suspense>
  );
}

async function Contenido() {
  await connection();
  const sesion = await sesionActual();
  if (!sesion) redirect('/entrar?volver=%2Fnegocios%2Fpanel');
  const negocio = await negocioDeCuenta(sesion.usuario.id);
  if (!negocio || !negocio.activo) redirect('/negocios');

  const resumen = await resumenNegocio(sesion.usuario.id);
  if (!resumen.ok) {
    return (
      <div className={estilos.pagina}>
        <header className="encabezado">
          <h1>Ventas</h1>
        </header>
        <p role="alert" className={estilos.error}>
          {resumen.mensaje}
        </p>
      </div>
    );
  }
  const { hoy, mes, recientes } = resumen.dato;

  return (
    <div className={estilos.pagina}>
      <header className="encabezado">
        <h1>Ventas</h1>
        <p>Lo que entró con los cobros pagados. Los cobros vencidos o cancelados no suman.</p>
      </header>

      <dl className={estilos.cifras}>
        <div className={estilos.cifra}>
          <dt>Hoy</dt>
          <dd>{formatoDolares(hoy.centavos)}</dd>
          <small>
            {hoy.cuenta} {hoy.cuenta === 1 ? 'venta' : 'ventas'}
          </small>
        </div>
        <div className={estilos.cifra}>
          <dt>Este mes</dt>
          <dd>{formatoDolares(mes.centavos)}</dd>
          <small>
            {mes.cuenta} {mes.cuenta === 1 ? 'venta' : 'ventas'}
          </small>
        </div>
      </dl>

      <section className={estilos.bloque} aria-labelledby="titulo-cobros">
        <h2 id="titulo-cobros">Últimos cobros</h2>
        {recientes.length === 0 ? (
          <div className={estilos.vacio}>
            <p>Todavía no hay cobros. Cuando cobres en caja o un cliente pague con el código QR, aparecen acá.</p>
            <Link href="/negocios/cobrar" className="boton">
              Cobrar en caja
            </Link>
          </div>
        ) : (
          <div className={estilos.tablaWrap}>
            <table className={estilos.tabla}>
              <caption className="solo-lectores">Los últimos 20 cobros, del más nuevo al más viejo</caption>
              <thead>
                <tr>
                  <th scope="col">Hora</th>
                  <th scope="col">Monto</th>
                  <th scope="col">Estado</th>
                </tr>
              </thead>
              <tbody>
                {recientes.map((c) => (
                  <tr key={c.id}>
                    <td>{horaSV(new Date(c.creado_en))}</td>
                    <td>{formatoDolares(c.usd_centavos)}</td>
                    <td>
                      <span className={estilos.estado}>{ETIQUETA_ESTADO[c.estado] ?? c.estado}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className={estilos.bloque} aria-labelledby="titulo-ledger">
        <h2 id="titulo-ledger">Cuentas y tickets</h2>
        <p>Las ventas quedan registradas. Emitir facturas a nombre de tu negocio llegará más adelante.</p>
      </section>
    </div>
  );
}
