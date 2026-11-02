import type { Metadata } from 'next';
import Link from 'next/link';
import { connection } from 'next/server';
import { Suspense } from 'react';

import { fechaSv, tiempoEstimado } from '@/componentes/textosEnvio';
import tabla from '@/componentes/Tabla.module.css';
import { formatoMonto } from '@/lib/cotizacion';
import { desgloseTributarioEnvio } from '@/lib/hacienda';
import { ETIQUETA_ENTREGA } from '@/lib/transferencias';
import { tarifasYTasas } from '@/servidor/monitor';
import { exigirAdmin } from '@/servidor/sesion';

import estilos from '../estilos.module.css';

export const metadata: Metadata = {
  title: 'Tarifas',
};

export default function PaginaTarifas() {
  return (
    <Suspense fallback={<p role="status">Cargando las tarifas…</p>}>
      <Tarifas />
    </Suspense>
  );
}

async function Tarifas() {
  await connection();
  const sesion = await exigirAdmin('/admin/tarifas');
  const resultado = await tarifasYTasas(sesion.usuario.id);

  return (
    <div className={estilos.marco}>
      {!resultado.ok ? (
        <p role="alert" className={estilos.error}>
          {resultado.mensaje}
        </p>
      ) : (
        <>
          <section className={estilos.seccion} aria-labelledby="titulo-comisiones">
            <div className={estilos.encabezadoSeccion}>
              <h2 id="titulo-comisiones">Comisiones</h2>
              <p className={estilos.leyenda}>Las comisiones se muestran aparte del tipo de cambio en cada envío.</p>
            </div>
            <div className={tabla.envoltura}>
              <table className={tabla.tabla}>
                <caption className={tabla.leyenda}>Comisión por forma de entrega</caption>
                <thead>
                  <tr>
                    <th scope="col">Forma de entrega</th>
                    <th scope="col">Parte fija (USD)</th>
                    <th scope="col">Porcentaje</th>
                    <th scope="col">Tiempo estimado</th>
                    <th scope="col">Código CAT-017 (DTE)</th>
                  </tr>
                </thead>
                <tbody>
                  {resultado.dato.tarifas.map((t) => {
                    const cat = desgloseTributarioEnvio({
                      monedaOrigen: 'USD',
                      montoOrigenCentavos: 10_000,
                      comisionCentavos: t.fijoCentavos + Math.floor((10_000 * t.porcentajeBps + 9_999) / 10_000),
                      entrega: t.entrega,
                    });
                    return (
                      <tr key={t.entrega}>
                        <th scope="row">{ETIQUETA_ENTREGA[t.entrega]}</th>
                        <td data-etiqueta="Parte fija (USD)">{formatoMonto(t.fijoCentavos, 'USD')}</td>
                        <td data-etiqueta="Porcentaje">{`${t.porcentajeBps / 100}%`}</td>
                        <td data-etiqueta="Tiempo estimado">{tiempoEstimado(t.minutosEstimados)}</td>
                        <td data-etiqueta="Código CAT-017 (DTE)" className={estilos.mono}>
                          {cat.etiquetaCat017}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className={estilos.leyenda}>
              Según el Art. 3 num. 4 de la LISR, los valores recibidos del exterior no constituyen renta; el alcance para
              remesas familiares no está confirmado, y el tratamiento de IVA del principal no fue verificado. El cobro por
              servicio local incluye 13% de IVA (F-07, v14 sin vigencia confirmada) y 1.75% de Pago a Cuenta sobre la base
              sin IVA (F-14 v17, Art. 151 CT; la base es un supuesto de cálculo).{' '}
              <Link href="/hacienda">Ver marco tributario completo</Link>.
            </p>
          </section>

          <section className={estilos.seccion} aria-labelledby="titulo-tasas">
            <div className={estilos.encabezadoSeccion}>
              <h2 id="titulo-tasas">Tipos de cambio</h2>
              <p className={estilos.leyenda}>Tasas guardadas, con su fuente y la fecha de la última actualización.</p>
            </div>
            <div className={tabla.envoltura}>
              <table className={tabla.tabla}>
                <caption className={tabla.leyenda}>Tipos de cambio guardados</caption>
                <thead>
                  <tr>
                    <th scope="col">Par</th>
                    <th scope="col">Tasa</th>
                    <th scope="col">Fuente</th>
                    <th scope="col">Actualizada</th>
                  </tr>
                </thead>
                <tbody>
                  {resultado.dato.tasas.map((t) => (
                    <tr key={t.par}>
                      <th scope="row">{t.par}</th>
                      <td data-etiqueta="Tasa" className={estilos.mono}>
                        {t.tasa.toLocaleString('en-US', { maximumFractionDigits: 8 })}
                      </td>
                      <td data-etiqueta="Fuente">{t.fuente}</td>
                      <td data-etiqueta="Actualizada">
                        <time dateTime={t.actualizadaEn}>{fechaSv(t.actualizadaEn)}</time>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}

