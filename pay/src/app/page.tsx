import Link from 'next/link';
import { connection } from 'next/server';
import { Suspense } from 'react';

import { Cotizador } from '@/componentes/Cotizador';
import { MAXIMO_CENTAVOS, MINIMO_CENTAVOS, formatoMonto } from '@/lib/cotizacion';
import { cotizacionUsdBtc } from '@/lib/precio/fuente';

import estilos from './page.module.css';

// The headline and the facts are static. The quote needs the BTC price, which is fetched at request
// time, so only the calculator waits for it.
export default function Inicio() {
  return (
    <div className={estilos.inicio}>
      <div className={estilos.texto}>
      <section className={estilos.titulo}>
        <h1>Mandá dinero a tu familia en El Salvador.</h1>
      </section>

      <section className={estilos.datos} aria-labelledby="titulo-antes">
        <h2 id="titulo-antes">Antes de enviar</h2>
        <ul className={estilos.hechos}>
          <li>Podés mandar entre {formatoMonto(MINIMO_CENTAVOS, 'USD')} y {formatoMonto(MAXIMO_CENTAVOS, 'USD')} por envío.</li>
          <li>Ves la comisión y el tipo de cambio antes de confirmar.</li>
          <li>Cada envío tiene un código para seguirlo.</li>
        </ul>
        <nav className={estilos.enlaces} aria-label="Más opciones">
          <Link href="/rastrear">Seguir un envío</Link>
          <Link href="/hacienda">Marco tributario de Hacienda y del BCR</Link>
        </nav>
      </section>
      </div>

      <section className={estilos.calculo} aria-label="Cuánto recibe tu familia">
        <Suspense fallback={<p role="status">Cargando la cotización…</p>}>
          <CotizadorConPrecio />
        </Suspense>
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
