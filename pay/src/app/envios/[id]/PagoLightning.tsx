'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';

import { formatoSats, formatoUsd } from '@/lib/dinero';
import type { PagoLightning as Pago } from '@/lib/lightning';

import { estadoDePagoAccion, pagarEnvioAccion } from './acciones';
import estilos from './PagoLightning.module.css';

const INTERVALO_MS = 3000;

function minutosYSegundos(milisegundos: number): string {
  const total = Math.max(0, Math.ceil(milisegundos / 1000));
  const minutos = Math.floor(total / 60);
  const segundos = String(total % 60).padStart(2, '0');
  return `${minutos}:${segundos}`;
}

/**
 * The sender pays the transfer with a Lightning invoice from BTCPay. While the invoice is open, the
 * page asks the server every few seconds, and only while the tab is visible. The server asks BTCPay;
 * when the invoice is Settled the transfer moves on, and the page is refreshed.
 */
export function PagoLightning({ envioId }: { envioId: string }) {
  const router = useRouter();
  const [pago, setPago] = useState<Pago | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copiada, setCopiada] = useState(false);
  const [ahora, setAhora] = useState(() => Date.now());
  const [pendiente, empezar] = useTransition();

  function pagar() {
    setError(null);
    setCopiada(false);
    empezar(async () => {
      const respuesta = await pagarEnvioAccion(envioId);
      if (respuesta.ok) {
        setPago(respuesta.dato);
        // The page hides "Cancelar envío" while an invoice is live: read it again.
        router.refresh();
      } else {
        setError(respuesta.mensaje);
        // The invoice may have been paid meanwhile, so the state is read again.
        router.refresh();
      }
    });
  }

  // The countdown needs the clock every second, but only while an invoice is shown.
  useEffect(() => {
    if (!pago) return;
    const reloj = setInterval(() => setAhora(Date.now()), 1000);
    return () => clearInterval(reloj);
  }, [pago]);

  // Asks whether the invoice was paid, until it is paid, expires, or the page goes away.
  useEffect(() => {
    if (!pago) return;
    const limite = Date.parse(pago.expiraEn);
    let parado = false;

    function parar() {
      parado = true;
      clearInterval(temporizador);
    }

    async function revisar() {
      if (parado || document.visibilityState !== 'visible') return;
      if (limite <= Date.now()) {
        parar();
        return;
      }
      try {
        const estado = await estadoDePagoAccion(envioId);
        if (parado) return;
        if (estado !== null && estado !== 'creada') {
          parar();
          router.refresh();
        }
      } catch {
        // A failed check is tried again on the next tick.
      }
    }

    function alVolverLaPestana() {
      if (document.visibilityState === 'visible') void revisar();
    }

    const temporizador = setInterval(revisar, INTERVALO_MS);
    document.addEventListener('visibilitychange', alVolverLaPestana);
    return () => {
      parar();
      document.removeEventListener('visibilitychange', alVolverLaPestana);
    };
  }, [pago, envioId, router]);

  async function copiar() {
    if (!pago) return;
    try {
      await navigator.clipboard.writeText(pago.bolt11);
      setCopiada(true);
    } catch {
      setError('No pudimos copiar la factura. Seleccionala a mano.');
    }
  }

  const restan = pago ? Date.parse(pago.expiraEn) - ahora : 0;
  const vencida = pago !== null && restan <= 0;

  return (
    <section className={estilos.pago} aria-labelledby="titulo-pago">
      <h2 id="titulo-pago">Pagar con Lightning</h2>
      <p className={estilos.regtest}>
        <strong>Bitcoin de prueba (regtest): no tiene valor.</strong>
      </p>

      {!pago && (
        <>
          <p>Pagás el monto completo del envío en sats. Cuando la factura se paga, el envío sale.</p>
          <button type="button" className="boton" disabled={pendiente} onClick={pagar}>
            {pendiente ? 'Preparando la factura…' : 'Pagar con Lightning'}
          </button>
        </>
      )}

      {pago && (
        <div className={estilos.factura}>
          {pago.montoDestinoActualizado !== undefined && (
            <p role="status" className={estilos.regtest}>
              La cotización se actualizó: ahora recibe {formatoSats(pago.montoDestinoActualizado)}.
            </p>
          )}
          <p className={estilos.monto}>
            <span className="dato">{formatoSats(pago.sats)}</span>
            <span> equivalen a {formatoUsd(pago.usdCentavos)}</span>
          </p>

          <label htmlFor="factura-lightning" className="campo-etiqueta">
            Factura Lightning
          </label>
          <textarea
            id="factura-lightning"
            className={estilos.textoFactura}
            value={pago.bolt11}
            readOnly
            rows={4}
            onFocus={(e) => e.currentTarget.select()}
          />

          <div className={estilos.botones}>
            <button type="button" className="boton boton--secundario" onClick={copiar}>
              {copiada ? 'Factura copiada' : 'Copiar factura'}
            </button>
            {pago.enlaceBilleteraDePrueba && !vencida && (
              <a
                className="boton"
                href={pago.enlaceBilleteraDePrueba}
                target="_blank"
                rel="noopener"
              >
                Pagar con la billetera de prueba
              </a>
            )}
          </div>

          {vencida ? (
            <>
              <p role="status">La factura venció y no se pagó. Pedí otra para seguir.</p>
              <button type="button" className="boton" disabled={pendiente} onClick={pagar}>
                {pendiente ? 'Preparando la factura…' : 'Pedir otra factura'}
              </button>
            </>
          ) : (
            <p className="aviso">
              Vence en {minutosYSegundos(restan)}. Esta página se actualiza sola cuando la factura se paga.
            </p>
          )}
        </div>
      )}

      {error && (
        <p role="alert" className={estilos.error}>
          {error}
        </p>
      )}
    </section>
  );
}
