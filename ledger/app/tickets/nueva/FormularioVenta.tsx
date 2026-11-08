"use client";

import { useActionState, useRef, useState, useTransition } from "react";

import { LineaContacto } from "../../_componentes/LineaContacto.tsx";
import { registrarVentaAccion, type EstadoVenta } from "./accion-venta.ts";

const INICIAL: EstadoVenta = { error: null };

// Each form carries one token: a double submit (or a retry after a lost answer) makes the same sale, never two.
export function FormularioVenta() {
  const [estado, accion, pendiente] = useActionState(registrarVentaAccion, INICIAL);
  const [tipo, setTipo] = useState<"consumidor" | "contribuyente">("consumidor");
  const [envio] = useState(() => crypto.randomUUID());
  const [, enTransicion] = useTransition();
  // A copy of the last submitted data: React clears the fields after an action, and the retry needs them again.
  const ultimoEnvio = useRef<FormData | null>(null);

  function enviar(formulario: FormData) {
    ultimoEnvio.current = formulario;
    accion(formulario);
  }

  // Same request as "Registrar venta", with the same token, so a retry never makes a second sale.
  function reintentar() {
    const copia = ultimoEnvio.current;
    if (copia !== null) enTransicion(() => accion(copia));
  }

  return (
    <form action={enviar} className="bloque" aria-labelledby="titulo-venta">
      <h2 id="titulo-venta">Venta en efectivo</h2>
      <p className="nota">Marcá el cobro en efectivo. No pasa por ningún riel de pago: lo registra quien lo recibió.</p>
      <input type="hidden" name="envio" value={envio} />

      <div className="campo">
        <label htmlFor="concepto">Concepto</label>
        <input id="concepto" name="concepto" required maxLength={200} autoComplete="off" />
      </div>

      <div className="campo">
        <label htmlFor="precio">Precio en dólares</label>
        <input id="precio" name="precio" required inputMode="decimal" placeholder="4.52" autoComplete="off" />
        <p className="nota">Factura 01: con IVA incluido. Comprobante 03: sin IVA; el IVA se suma.</p>
      </div>

      <fieldset className="campo">
        <legend>Tipo de cliente</legend>
        <label>
          <input type="radio" name="cliente" value="consumidor" checked={tipo === "consumidor"} onChange={() => setTipo("consumidor")} />{" "}
          Consumidor final (factura 01)
        </label>
        <label>
          <input type="radio" name="cliente" value="contribuyente" checked={tipo === "contribuyente"} onChange={() => setTipo("contribuyente")} />{" "}
          Contribuyente (comprobante 03)
        </label>
      </fieldset>

      {tipo === "contribuyente" ? (
        <fieldset className="campo">
          <legend>Datos fiscales del cliente</legend>
          <div className="campo">
            <label htmlFor="nombre">Nombre o razón social</label>
            <input id="nombre" name="nombre" required maxLength={250} />
          </div>
          <div className="campo">
            <label htmlFor="nit">NIT (solo números)</label>
            <input id="nit" name="nit" required inputMode="numeric" />
          </div>
          <div className="campo">
            <label htmlFor="nrc">NRC (solo números)</label>
            <input id="nrc" name="nrc" required inputMode="numeric" />
          </div>
          <div className="campo">
            <label htmlFor="codActividad">Código de actividad económica</label>
            <input id="codActividad" name="codActividad" required inputMode="numeric" />
          </div>
          <div className="campo">
            <label htmlFor="descActividad">Descripción de la actividad</label>
            <input id="descActividad" name="descActividad" required maxLength={150} />
          </div>
          <div className="campo">
            <label htmlFor="departamento">Departamento (código de 2 dígitos)</label>
            <input id="departamento" name="departamento" required inputMode="numeric" />
          </div>
          <div className="campo">
            <label htmlFor="municipio">Municipio (código de 2 dígitos)</label>
            <input id="municipio" name="municipio" required inputMode="numeric" />
          </div>
          <div className="campo">
            <label htmlFor="distrito">Distrito</label>
            <input id="distrito" name="distrito" required maxLength={100} />
          </div>
          <div className="campo">
            <label htmlFor="complemento">Dirección</label>
            <input id="complemento" name="complemento" required maxLength={200} />
          </div>
        </fieldset>
      ) : null}

      <button type="submit" className="boton" disabled={pendiente}>
        {pendiente ? "Registrando…" : "Registrar venta"}
      </button>
      <p role="status" aria-live="polite" className="nota">
        {pendiente ? "Emitiendo el documento. No apretes de nuevo: no se duplica." : ""}
      </p>
      {estado.error !== null ? (
        <>
          <p role="alert" className="error">
            {estado.error}
          </p>
          <button type="button" className="boton secundario" onClick={reintentar} disabled={pendiente}>
            Intentar de nuevo
          </button>
          <LineaContacto pregunta="¿Algo no funciona?" />
        </>
      ) : null}
    </form>
  );
}
