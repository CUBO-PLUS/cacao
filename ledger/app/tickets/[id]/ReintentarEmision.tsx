"use client";

import { useActionState } from "react";

import { LineaContacto } from "../../_componentes/LineaContacto.tsx";
import { reintentarEmisionTicket, type EstadoReintento } from "./accion-reintentar.ts";

const INICIAL: EstadoReintento = { mensaje: null, error: null };

export function ReintentarEmision({ ticketId }: { ticketId: string }) {
  const [estado, accion, pendiente] = useActionState(reintentarEmisionTicket, INICIAL);
  return (
    <form action={accion} className="no-imprimir" style={{ marginTop: "0.75rem" }}>
      <input type="hidden" name="ticket" value={ticketId} />
      <button type="submit" className="boton" disabled={pendiente}>
        {pendiente ? "Reintentando…" : "Reintentar emisión"}
      </button>
      <p role="status" aria-live="polite" className="nota">
        {pendiente ? "Enviando el documento de nuevo. Puede tardar unos segundos." : (estado.mensaje ?? "")}
      </p>
      {estado.error !== null ? (
        <>
          <p role="alert" className="error">
            {estado.error}
          </p>
          {/* Same request as the button above: the form submits the same action again. */}
          <button type="submit" className="boton secundario" disabled={pendiente} style={{ marginTop: "0.5rem" }}>
            Intentar de nuevo
          </button>
          <LineaContacto pregunta="¿Algo no funciona?" />
        </>
      ) : null}
    </form>
  );
}
