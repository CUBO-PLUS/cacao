import type { Metadata } from 'next';

import { Boton } from '@/componentes/Boton';
import tabla from '@/componentes/Tabla.module.css';
import { cotizar, formatoMonto, TARIFAS, TASA_EUR_USD, type Entrega } from '@/lib/cotizacion';
import { formatoUsd } from '@/lib/dinero';
import { URL_LEDGER } from '@/lib/grupo';
import { desgloseTributarioEnvio } from '@/lib/hacienda';
import { ETIQUETA_ENTREGA } from '@/lib/transferencias';

import estilos from './estilos.module.css';

export const metadata: Metadata = {
  title: 'Hacienda y regulación',
};

const ENTREGAS_EJEMPLO: Entrega[] = ['efectivo', 'cuenta', 'lightning'];
const MONTO_EJEMPLO_CENTAVOS = 10_000;
const BTC_EJEMPLO_USD = 100_000;

export default function PaginaHacienda() {
  const filasEjemplo = ENTREGAS_EJEMPLO.map((entrega) => {
    const c = cotizar({
      monedaOrigen: 'USD',
      montoOrigenCentavos: MONTO_EJEMPLO_CENTAVOS,
      entrega,
      tarifas: TARIFAS,
      eurUsd: TASA_EUR_USD,
      usdBtc: BTC_EJEMPLO_USD,
      fuenteBtc: 'Referencia 1 BTC = $100,000.00',
    });
    if ('error' in c) throw new Error(c.error);
    const t = desgloseTributarioEnvio({
      monedaOrigen: 'USD',
      montoOrigenCentavos: c.montoOrigenCentavos,
      comisionCentavos: c.comisionCentavos,
      entrega,
    });
    return { cotizacion: c, tributario: t };
  });

  return (
    <div className={estilos.pagina}>
      <section className="encabezado">
        <h1>Marco tributario y de Hacienda en El Salvador</h1>
        <p>
          Cómo se tratan las remesas familiares, la comisión del servicio, la facturación electrónica (DTE) ante la
          Dirección General de Impuestos Internos (DGII · Ministerio de Hacienda) y las reglas del Banco Central de
          Reserva (BCR) en El Salvador.
        </p>
        <p>Esta página resume normas para la demo. No es asesoría tributaria.</p>
      </section>

      <section className={estilos.seccion} aria-labelledby="titulo-regla-principal">
        <h2 id="titulo-regla-principal">1. Qué impuestos recaen sobre una remesa</h2>
        <div className={estilos.tarjetas}>
          <div className={estilos.tarjeta}>
            <h3>El monto que recibe tu familiar: alcance de Renta e IVA no confirmado</h3>
            <p>
              Según el <strong>Artículo 3 numeral 4) de la Ley de Impuesto sobre la Renta (LISR)</strong>, los valores
              recibidos del exterior no constituyen renta. El alcance de esa norma para las remesas familiares no está
              confirmado en esta revisión.
            </p>
            <p>
              El tratamiento de IVA sobre el monto principal <strong>no fue verificado en esta revisión</strong>.
            </p>
          </div>

          <div className={estilos.tarjeta}>
            <h3>El cobro por el servicio de envío: IVA 13% y Pago a Cuenta 1.75%</h3>
            <p>
              Cuando un operador o punto de pago domiciliado en El Salvador cobra por el servicio de remesa, ese ingreso
              por servicio sí constituye hecho generador tributario local:
            </p>
            <ul className={estilos.lista}>
              <li>
                <strong>IVA del 13% incluido:</strong> en una Factura de Consumidor Final
                (DTE 01), la base gravada sin IVA es <span className="dato">round(cobro × 100 / 113)</span> y el débito
                fiscal de IVA es <span className="dato">cobro - base</span>.
              </li>
              <li>
                <strong>Pago a cuenta de renta del 1.75% (Art. 151 CT, por confirmar):</strong> anticipo sobre los
                ingresos brutos. En este simulador se aplica a la base sin IVA (<span className="dato">base × 1.75%</span>).
                Supuesto: ingresos sin IVA; confirmalo con tu contador.
              </li>
            </ul>
          </div>
        </div>
      </section>

      <section className={estilos.seccion} aria-labelledby="titulo-ejemplo">
        <h2 id="titulo-ejemplo">2. Ejemplo con un envío de $100.00 según la vía de entrega</h2>
        <p>
          Desglose de un envío de <span className="dato">$100.00</span> (con referencia de{' '}
          <span className="dato">1 BTC = $100,000.00</span> para Lightning), separando el principal que llega al
          destinatario y los impuestos que recaen sobre el cobro del servicio local:
        </p>
        <div className={tabla.envoltura}>
          <table className={tabla.tabla}>
            <caption className={tabla.leyenda}>Desglose tributario de un envío de $100.00</caption>
            <thead>
              <tr>
                <th scope="col">Vía de entrega</th>
                <th scope="col">Recibe (principal)</th>
                <th scope="col">Cobro servicio (bruto)</th>
                <th scope="col">Base sin IVA (F-07)</th>
                <th scope="col">IVA 13% (F-07)</th>
                <th scope="col">Pago a cuenta 1.75% (Art. 151 CT, por confirmar)</th>
                <th scope="col">Código CAT-017</th>
              </tr>
            </thead>
            <tbody>
              {filasEjemplo.map(({ cotizacion: c, tributario: t }) => (
                <tr key={c.entrega}>
                  <th scope="row">{ETIQUETA_ENTREGA[c.entrega]}</th>
                  <td data-etiqueta="Recibe (principal)" className="dato">
                    {formatoMonto(c.montoDestino, c.monedaDestino)}
                    {c.monedaDestino === 'SATS' ? ` (${formatoUsd(t.principalExentoUsdCentavos)})` : ''}
                  </td>
                  <td data-etiqueta="Cobro servicio (bruto)" className="dato">
                    {formatoUsd(t.comisionBrutaUsdCentavos)}
                  </td>
                  <td data-etiqueta="Base sin IVA (F-07)" className="dato">
                    {formatoUsd(t.baseSinIvaUsdCentavos)}
                  </td>
                  <td data-etiqueta="IVA 13% (F-07)" className="dato">
                    {formatoUsd(t.ivaUsdCentavos)}
                  </td>
                  <td data-etiqueta="Pago a cuenta 1.75% (Art. 151 CT, por confirmar)" className="dato">
                    {formatoUsd(t.pagoACuentaUsdCentavos)}
                  </td>
                  <td data-etiqueta="Código CAT-017" className="dato">
                    {t.etiquetaCat017}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p>
          La base sin IVA es un supuesto de cálculo de este simulador. Confirmalo con tu contador. Las versiones de
          F-07 y F-14 se describen en la sección 3.
        </p>
      </section>

      <section className={estilos.seccion} aria-labelledby="titulo-dte">
        <h2 id="titulo-dte">3. Facturación electrónica (DTE), F-07, F-14 v17 y CacaoLedger</h2>
        <dl className={estilos.definiciones}>
          <div>
            <dt>Emisión de DTE 01 y 03 (Arts. 119-B, 119-C y 119-F CT, por confirmar)</dt>
            <dd>
              El documento tributario electrónico se emite por el valor del servicio cobrado, expresado siempre en
              dólares (<span className="dato">tipoMoneda: &quot;USD&quot;</span>). Por regla general (Art. 119-C CT, por confirmar) el
              DTE se considera emitido al recibir el sello de recepción; la contingencia tiene reglas propias (Art. 119-F
              CT). Para personas naturales se emite{' '}
              <strong>Factura de Consumidor Final (tipoDte 01)</strong>; entre comercios o corresponsales con NRC se
              emite <strong>Comprobante de Crédito Fiscal (tipoDte 03)</strong>.
            </dd>
          </div>
          <div>
            <dt>Catálogo CAT-017 y envíos por Lightning</dt>
            <dd>
              El catálogo <span className="dato">CAT-017</span> (códigos no verificados en esta revisión) asigna{' '}
              <span className="dato">01</span> a
              efectivo, <span className="dato">05</span> a transferencia o depósito bancario y{' '}
              <span className="dato">11</span> a Bitcoin. En la generación de esquemas v1 de Factura 01 donde el patrón
              del validador restringe el código <span className="dato">11</span>, se declara{' '}
              <span className="dato">99</span> (Otros) con la referencia estructurada{' '}
              <span className="dato">BTC-LN|&lt;sats&gt;sat|&lt;tasa&gt;|&lt;hash&gt;</span> y la cadena de atestación
              SHA-256 en CacaoLedger. La <strong>Resolución 1003 del CVPCPA</strong> (por confirmar), según la guía de esa institución, indica que el bitcoin se mida a costo de adquisición, con el tipo de cambio de referencia al dólar
              establecido por los mercados internacionales e indicado en la billetera que se utilice.
            </dd>
          </div>
          <div>
            <dt>Declaraciones F-07 y F-14 v17</dt>
            <dd>
              El <strong>Formulario F-07</strong> se presenta dentro de los primeros <strong>10 días hábiles</strong> del
              mes siguiente (arts. 93-94 Ley de IVA, según la DGII). Las operaciones con sello de recepción alimentan el Libro de Ventas
              a Consumidor Final y el <strong>Anexo 2 de 23 columnas (A a W)</strong> de la plantilla de la DGII de 2021.
              La versión 14 del F-07 está publicada en mh.gob.sv (ago. 2025); vigencia por confirmar. El{' '}
              <strong>Formulario F-14 v17</strong> de pago a cuenta e impuesto retenido se rige por el Art. 151 CT (pago a
              cuenta, por confirmar). Las retenciones de renta, por el Art. 62 de la LISR (10 días hábiles, por confirmar).
            </dd>
          </div>
          <div>
            <dt>Sanciones por incumplimiento (Art. 239-A CT)</dt>
            <dd>
              Las multas del Art. 239-A del Código Tributario dependen del salario mínimo y del tipo de incumplimiento.
              Consultá el texto vigente antes de tomar decisiones.
            </dd>
          </div>
        </dl>
      </section>

      <section className={estilos.seccion} aria-labelledby="titulo-bcr">
        <h2 id="titulo-bcr">4. Banco Central de Reserva (BCR), Ley Bitcoin (D.L. 199) y prevención de lavado (UIF)</h2>
        <dl className={estilos.definiciones}>
          <div>
            <dt>Norma del BCR sobre entidades que envían o reciben dinero (NRP-19)</dt>
            <dd>
              La <strong>NRP-19</strong>, que regula a las entidades que envían o
              reciben dinero mediante subagentes y deroga la NRP-12.
            </dd>
          </div>
          <div>
            <dt>Ley Contra el Lavado de Dinero y de Activos (LCLDA · UIF)</dt>
            <dd>
              CacaoPay acota cada operación entre <span className="dato">$1.00</span> y{' '}
              <span className="dato">$3,000.00</span> (o su equivalente en euros), exige cuenta con teléfono o correo
              verificado para quien envía y registra auditoría inmutable de cada cambio de estado. En operación real,
              las transacciones que superan los umbrales legales se reportan a la Unidad de Investigación Financiera
              (UIF) de la Fiscalía General de la República.
            </dd>
          </div>
          <div>
            <dt>Ley Bitcoin (Decreto Legislativo 199)</dt>
            <dd>
              Desde la reforma de 2025 (D.L. 199) aceptar bitcoin es voluntario. Los registros se llevan en dólares (<span className="dato">USD</span>): Art. 139
              del Código Tributario y Art. 6 de la Ley Bitcoin. En cada envío por Lightning, CacaoPay fija y guarda la tasa{' '}
              <span className="dato">USD/BTC</span> obtenida de Coinbase y Kraken junto con su marca de tiempo. En
              producción, las entidades financieras que operen en el ecosistema bitcoin se rigen por la{' '}
              <strong>NRP-29 del BCR</strong>, cuyo artículo 10 exige registro en el{' '}
              <strong>Registro de Proveedores de Bitcoin del BCR</strong> (por confirmar).
            </dd>
          </div>
        </dl>

        <div className={estilos.acciones}>
          <Boton href="/enviar">Enviar dinero</Boton>
          <Boton href={URL_LEDGER} variante="secundario">
            Ver CacaoLedger (DTE y F-07)
          </Boton>
        </div>
      </section>

      <p className={estilos.pie}>
        CacaoPay es una simulación educativa. No mueve dinero real ni emite documentos fiscales reales ante el
        Ministerio de Hacienda.
      </p>
    </div>
  );
}
