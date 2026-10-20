'use client';

import { useEffect, useRef, useState } from 'react';

import { formatoCuenta, restanteMs } from '@/lib/cuenta';

// "Esta cotización vale por 4:59": the quote's time left, counted down each second. When it runs out,
// onVencer is called once, and the form asks the server for a new quote. Not a live region: the number
// changes every second, and a screen reader would read each change.
export function VigenciaCotizacion({ validaHasta, onVencer }: { validaHasta: string; onVencer: () => void }) {
  // Null until the first check in the browser, so the server and the first render agree.
  const [restante, setRestante] = useState<number | null>(null);
  const vencidaPara = useRef<string | null>(null);
  const alVencer = useRef(onVencer);

  useEffect(() => {
    alVencer.current = onVencer;
  }, [onVencer]);

  useEffect(() => {
    vencidaPara.current = null;
    function revisar() {
      const quedan = restanteMs(validaHasta, Date.now());
      setRestante(quedan);
      if (quedan <= 0 && vencidaPara.current !== validaHasta) {
        vencidaPara.current = validaHasta;
        alVencer.current();
      }
    }
    revisar();
    const reloj = setInterval(revisar, 1000);
    return () => clearInterval(reloj);
  }, [validaHasta]);

  if (restante === null) return null;

  return (
    <p className="aviso">
      {restante > 0
        ? `Esta cotización vale por ${formatoCuenta(restante)}.`
        : 'La cotización venció. La estamos actualizando…'}
    </p>
  );
}
