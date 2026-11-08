"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

// While this month's due waits for its payment, the page asks the server again every 5 seconds (only while the tab
// is visible). The server reads the charge from CacaoPay and marks the due paid. Copy and open-in-wallet live here too.
export function EsperandoPago({ factura }: { factura: string }) {
  const router = useRouter();
  const [copiada, setCopiada] = useState(false);

  useEffect(() => {
    const reloj = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, 5000);
    return () => clearInterval(reloj);
  }, [router]);

  async function copiar() {
    try {
      await navigator.clipboard.writeText(factura);
      setCopiada(true);
    } catch {
      setCopiada(false);
    }
  }

  return (
    <div className="plan-botones">
      <a className="boton" href={`lightning:${factura}`}>
        Abrir en mi billetera
      </a>
      <button type="button" className="boton secundario" onClick={copiar}>
        {copiada ? "Factura copiada" : "Copiar factura"}
      </button>
      <p role="status" aria-live="polite" className="nota">
        Esperando el pago. Esta página se actualiza sola.
      </p>
    </div>
  );
}

// The due exists but CacaoPay has not handed over its invoice yet: ask again in a few seconds.
export function PreparandoFactura() {
  const router = useRouter();
  useEffect(() => {
    const reloj = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, 3000);
    return () => clearInterval(reloj);
  }, [router]);
  return (
    <p role="status" aria-live="polite" className="nota">
      Preparando la factura de la cuota…
    </p>
  );
}
