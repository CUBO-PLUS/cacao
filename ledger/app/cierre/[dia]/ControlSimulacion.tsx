"use client";

import { useActionState } from "react";

import { cambiarSimulacionAccion, type EstadoControl } from "./accion-simulacion.ts";

const INICIAL: EstadoControl = { mensaje: null, error: null };

// The demo control. Its title and buttons say SIMULADO: nothing here reaches the Ministry of Finance.
export function ControlSimulacion({ caida, desde }: { caida: boolean; desde: string | null }) {
  const [estado, accion, pendiente] = useActionState(cambiarSimulacionAccion, INICIAL);
  return (
    <section className="bloque" aria-labelledby="titulo-simulacion">
      <h2 id="titulo-simulacion">
        Simulación de Hacienda <span className="aviso-simulado">SIMULADO</span>
      </h2>
      <p className="nota">
        {caida
          ? `Caída simulada activa desde ${desde ?? "hace un momento"}. Los documentos nuevos quedan en espera de 24 horas.`
          : "Sin caída simulada. Los documentos se transmiten a la recepción simulada."}
      </p>
      <form action={accion} className="acciones">
        <button type="submit" name="accion" value="caer" className="boton secundario" disabled={pendiente || caida}>
          Simular caída de Hacienda
        </button>
        <button type="submit" name="accion" value="volver" className="boton" disabled={pendiente || !caida}>
          Simular que Hacienda volvió
        </button>
      </form>
      <p role="status" aria-live="polite" className="nota">
        {pendiente ? "Cambiando la simulación…" : (estado.mensaje ?? "")}
      </p>
      {estado.error !== null ? (
        <p role="alert" className="error">
          {estado.error}
        </p>
      ) : null}
    </section>
  );
}
