"use client";

import { useActionState } from "react";

import { elegirPlanAccion, type EstadoElegir } from "./acciones.ts";

const INICIAL: EstadoElegir = { error: null };

export function ElegirPlan({ plan, actual }: { plan: string; actual: boolean }) {
  const [estado, accion, pendiente] = useActionState(elegirPlanAccion, INICIAL);
  if (actual) return <p className="chip chip-emitido">Tu plan</p>;
  return (
    <form action={accion}>
      <input type="hidden" name="plan" value={plan} />
      <button type="submit" className="boton" disabled={pendiente}>
        {pendiente ? "Guardando…" : "Elegir este plan"}
      </button>
      {estado.error !== null ? (
        <p role="alert" className="error">
          {estado.error}
        </p>
      ) : null}
    </form>
  );
}
