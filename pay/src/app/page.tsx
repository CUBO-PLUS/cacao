import Link from 'next/link';
import { connection } from 'next/server';
import { Suspense } from 'react';

import { Boton } from '@/componentes/Boton';
import { Cotizador } from '@/componentes/Cotizador';
import { comisionExplicada } from '@/componentes/formatoEnvio';
import { ETIQUETA_ENTREGA } from '@/lib/transferencias';
import { cotizacionUsdBtc } from '@/lib/precio/fuente';
import { leerTarifas } from '@/servidor/tasas';

import estilos from './page.module.css';

// The promise and the steps are static. The quote needs the BTC price, which is fetched at request
// time, so only the calculator and the fee line wait for it.
export default function Inicio() {
  return (
    <div className={estilos.inicio}>
      <section className="encabezado">
        <h1>Mandá dinero a El Salvador y mirá cada centavo.</h1>
        <p>
          Antes de confirmar ves el tipo de cambio, la comisión y cuánto llega. Elegís si la persona lo recibe en
          efectivo, en su cuenta bancaria o en bitcoin por Lightning.
        </p>
      </section>

      <section className={estilos.bloque} aria-labelledby="titulo-cotizador">
        <h2 id="titulo-cotizador">Cotizá tu envío</h2>
        <Suspense fallback={<p role="status">Cargando la cotización…</p>}>
          <CotizadorConPrecio />
        </Suspense>
      </section>

      <section className={estilos.bloque} aria-labelledby="titulo-como">
        <h2 id="titulo-como">Cómo funciona</h2>
        <ol className={estilos.pasos}>
          <li>
            <span className={estilos.numero} aria-hidden="true">1</span>
            <div>
              <strong>Cotizá</strong>
              <p>Ves el tipo de cambio, la comisión y cuánto recibe tu familia antes de pagar.</p>
            </div>
          </li>
          <li>
            <span className={estilos.numero} aria-hidden="true">2</span>
            <div>
              <strong>Pagá con Lightning</strong>
              <p>Pagás desde tu billetera de bitcoin. El envío sale cuando la factura se paga.</p>
            </div>
          </li>
          <li>
            <span className={estilos.numero} aria-hidden="true">3</span>
            <div>
              <strong>Tu familia cobra con un enlace</strong>
              <p>Recibe un enlace por WhatsApp y cobra sin cuenta, o retira en efectivo o en su banco.</p>
            </div>
          </li>
        </ol>
        <Suspense fallback={null}>
          <ComparacionComisiones />
        </Suspense>
        <p className={estilos.nota}>
          <Link href="/hacienda">Mirá el marco tributario de Hacienda y del BCR</Link>.
        </p>
        <div>
          <Boton href="/enviar">Enviar dinero</Boton> <Boton href="/rastrear" variante="secundario">Seguir un envío</Boton>
        </div>
      </section>
    </div>
  );
}

async function CotizadorConPrecio() {
  // The price is read per request; the quote stays correct when the source is slow or down.
  await connection();
  const fijo = Boolean(process.env.PRECIO_FIJO_USD_BTC);
  const fuenteBtc = fijo ? 'Precio de bitcoin fijo de demostración' : 'Precio de bitcoin: Coinbase y Kraken';
  let usdBtc: number | null = null;
  try {
    usdBtc = await cotizacionUsdBtc();
  } catch (error) {
    // Cash and bank quotes still work without it; the calculator says Lightning is not available.
    console.error('Precio de bitcoin:', error instanceof Error ? error.message : error);
  }
  return <Cotizador usdBtc={usdBtc} fuenteBtc={fuenteBtc} />;
}

// The fee of each way of delivery, side by side. Shown only when the fee table could be read.
async function ComparacionComisiones() {
  await connection();
  const tarifas = await leerTarifas();
  if (!tarifas || tarifas.length === 0) return null;
  const orden = ['lightning', 'cuenta', 'efectivo'] as const;
  const partes = orden
    .map((entrega) => tarifas.find((t) => t.entrega === entrega))
    .filter((t): t is NonNullable<typeof t> => t !== undefined)
    .map((t) => `${ETIQUETA_ENTREGA[t.entrega]}: ${comisionExplicada(t, 'USD')}`);
  return <p className={estilos.comparacion}>Comisiones: {partes.join(' · ')}.</p>;
}
