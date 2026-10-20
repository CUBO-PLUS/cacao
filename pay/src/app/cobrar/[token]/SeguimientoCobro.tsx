'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

import { estadoCobroAccion } from './acciones';

const INTERVALO_MS = 3000;

/**
 * While a claim is being paid, asks the server every few seconds, and only while the tab is visible.
 * When the server records the outcome, the page is read again.
 */
export function SeguimientoCobro({ token }: { token: string }) {
  const router = useRouter();

  useEffect(() => {
    let parado = false;
    const reloj = setInterval(revisar, INTERVALO_MS);

    function parar() {
      parado = true;
      clearInterval(reloj);
    }

    async function revisar() {
      if (parado || document.visibilityState !== 'visible') return;
      try {
        const resultado = await estadoCobroAccion(token);
        if (parado || !resultado.ok) return;
        if (resultado.dato.cobroEstado !== 'pagando') {
          parar();
          router.refresh();
        }
      } catch {
        // A failed check is tried again on the next tick.
      }
    }

    return parar;
  }, [token, router]);

  return null;
}
