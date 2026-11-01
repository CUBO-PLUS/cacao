"use client";

import { useState } from "react";

import { verificarCadenaAccion, type EstadoVerificacion } from "./accion-verificar.ts";

// Runs the check on the server and shows what it found. The result is not stored: each press recomputes it.
export function VerificarCadena() {
  const [estado, setEstado] = useState<EstadoVerificacion | null>(null);
  const [ocupado, setOcupado] = useState(false);

  async function verificar() {
    setOcupado(true);
    try {
      setEstado(await verificarCadenaAccion());
    } finally {
      setOcupado(false);
    }
  }

  const r = estado?.resultado ?? null;
  return (
    <div className="no-imprimir" style={{ marginTop: "0.75rem" }}>
      <button type="button" className="boton secundario" onClick={verificar} disabled={ocupado}>
        {ocupado ? "Verificando…" : "Verificar cadena"}
      </button>
      <p role="status" aria-live="polite" className="nota" style={{ marginTop: "0.5rem" }}>
        {r === null ? "" : r.ok ? `Cadena íntegra: ${r.registros} registros, cada hash recalculado. Cabeza ${r.cabeza.slice(0, 16)}…` : null}
      </p>
      {r !== null && !r.ok && r.primerRoto !== null ? (
        <p role="alert" className="error">
          Cadena rota en el registro {r.primerRoto.orden} (ticket {r.primerRoto.ticketId}): {r.primerRoto.motivo}.
        </p>
      ) : null}
      {estado?.error ? (
        <p role="alert" className="error">
          {estado.error}
        </p>
      ) : null}
    </div>
  );
}
