import type { Metadata } from 'next';
import { connection } from 'next/server';
import { Suspense } from 'react';

import { exigirAdmin } from '@/servidor/sesion';
import { embudoPay, type PasoEmbudo } from '@/servidor/monitor';

import { FiltroPeriodo } from '../FiltroPeriodo';
import { periodoDe } from '../periodo';
import estilos from '../estilos.module.css';

export const metadata: Metadata = {
  title: 'Embudo',
};

export default function PaginaEmbudo(props: PageProps<'/admin/embudo'>) {
  return (
    <Suspense fallback={<p role="status">Cargando el embudo…</p>}>
      <Embudo busqueda={props.searchParams} />
    </Suspense>
  );
}

async function Embudo({ busqueda }: { busqueda: PageProps<'/admin/embudo'>['searchParams'] }) {
  await connection();
  const params = await busqueda;
  const sesion = await exigirAdmin('/admin/embudo');
  const periodo = periodoDe(params, new Date());
  const resultado = await embudoPay(sesion.usuario.id, periodo.inicio, periodo.fin);

  return (
    <section className={estilos.seccion} aria-labelledby="titulo-embudo">
      <div className={estilos.encabezadoSeccion}>
        <h2 id="titulo-embudo">Embudo de Cacao Pay</h2>
        <p className={estilos.leyenda}>
          Cuántas sesiones llegaron a cada paso, del {periodo.desde} al {periodo.hasta}, los dos días incluidos.
        </p>
      </div>

      <FiltroPeriodo ruta="/admin/embudo" desde={periodo.desde} hasta={periodo.hasta} aviso={periodo.aviso} />

      {resultado.ok ? (
        <EmbudoContenido pasos={resultado.dato} />
      ) : (
        <p role="alert" className={estilos.error}>
          {resultado.mensaje}
        </p>
      )}
    </section>
  );
}

function EmbudoContenido({ pasos }: { pasos: PasoEmbudo[] }) {
  if (pasos.length === 0) return <p>Todavía no hay datos del embudo.</p>;

  const primero = pasos[0].sesiones;
  const ultimo = pasos[pasos.length - 1].sesiones;
  // Completions above the quotes mean the events do not line up for this period; say so, not a share above 100.
  const frase =
    primero === 0
      ? 'Todavía no hay cotizaciones en este período.'
      : ultimo > primero
        ? 'Hay más envíos completados que cotizaciones en este período. Revisá cómo se registran las cotizaciones.'
        : `De cada 100 personas que cotizaron un envío, ${Math.round((ultimo / primero) * 100)} tuvieron un envío completado.`;

  return (
    <>
      <p className={estilos.frase}>{frase}</p>
      <ol className={estilos.pasosEmbudo}>
        {pasos.map((paso, i) => {
          // Each bar is the share of the first step; the text gives the same number, so colour is not needed.
          const delPrimero = primero === 0 ? 0 : Math.round((paso.sesiones / primero) * 100);
          const anterior = i === 0 ? null : pasos[i - 1].sesiones;
          const siguio = anterior === null || anterior === 0 ? null : Math.round((paso.sesiones / anterior) * 100);
          return (
            <li key={paso.nombre} className={estilos.paso}>
              <div className={estilos.pasoCabecera}>
                <span>
                  {i + 1}. {paso.etiqueta}
                </span>
                <span className={estilos.pasoCifra}>
                  {paso.sesiones} {paso.sesiones === 1 ? 'sesión' : 'sesiones'}
                </span>
              </div>
              <div
                className={estilos.barra}
                role="img"
                aria-label={`${delPrimero} de cada 100 sesiones llegaron a este paso`}
              >
                <div className={estilos.barraRelleno} style={{ width: `${Math.min(delPrimero, 100)}%` }} />
              </div>
              <p className={estilos.pasoDetalle}>
                {i === 0
                  ? 'Primer paso del embudo.'
                  : siguio === null
                    ? 'Nadie llegó al paso anterior en este período.'
                    : siguio > 100
                      ? 'Este paso tiene más sesiones que el anterior. Revisá cómo se registran los eventos.'
                      : `${siguio} de cada 100 sesiones del paso anterior llegaron a este paso.`}
              </p>
            </li>
          );
        })}
      </ol>
    </>
  );
}
