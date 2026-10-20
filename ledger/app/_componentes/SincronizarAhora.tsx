"use client";

import { useActionState } from "react";

import { sincronizarAhora, type EstadoAccionSincronizar } from "../accion-sincronizar.ts";

const INICIAL: EstadoAccionSincronizar = { mensaje: null, error: null };

export function SincronizarAhora() {
  const [estado, accion, pendiente] = useActionState(sincronizarAhora, INICIAL);
  return (
    <form action={accion} className="sincronizar">
      <button type="submit" className="boton" disabled={pendiente}>
        {pendiente ? "Sincronizando…" : "Sincronizar ahora"}
      </button>
      <p role="status" aria-live="polite" className="nota">
        {pendiente ? "Consultando BTCPay. Puede tardar unos segundos." : (estado.mensaje ?? "")}
      </p>
      {estado.error !== null ? (
        <p role="alert" className="error">
          {estado.error}
        </p>
      ) : null}
    </form>
  );
}
