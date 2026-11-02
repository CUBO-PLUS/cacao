'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';

import estilos from '../../estilos.module.css';

import { ejecutarAccionCobro } from './acciones';

const MOTIVO_MINIMO = 4;
const MOTIVO_MAXIMO = 200;

// The claim of a Lightning transfer is stuck while its invoice is being paid. The admin asks BTCPay
// first; only if that does not settle it, marks the claim as failed, with a reason the claimant reads.
export function AccionesCobroAdmin({ envioId }: { envioId: string }) {
  const [estado, accion] = useActionState(ejecutarAccionCobro, {});
  const [marcando, setMarcando] = useState(false);

  return (
    <section className={estilos.seccion} aria-labelledby="titulo-cobro-admin">
      <h2 id="titulo-cobro-admin">Cobro en curso</h2>
      <p className={estilos.leyenda}>
        La factura se está pagando. Revisá primero en BTCPay: si el pago salió, el envío se cierra solo. Marcar como
        fallido solo sirve si BTCPay no tiene respuesta.
      </p>

      {estado.mensaje && (
        <p role={estado.ok ? 'status' : 'alert'} className={estado.ok ? estilos.exito : estilos.error}>
          {estado.mensaje}
        </p>
      )}

      <form action={accion} className={estilos.acciones}>
        <input type="hidden" name="envio" value={envioId} />
        <input type="hidden" name="accion" value="revisar" />
        <BotonEnviar etiqueta="Revisar cobro" enCurso="Revisando…" />
      </form>

      {marcando ? (
        <form action={accion} className={estilos.formulario}>
          <input type="hidden" name="envio" value={envioId} />
          <input type="hidden" name="accion" value="fallar" />
          <div className={estilos.filtroCampo}>
            <label htmlFor="motivo-cobro" className="campo-etiqueta">
              Motivo (lo ve quien cobra)
            </label>
            <input
              id="motivo-cobro"
              name="motivo"
              type="text"
              className="campo"
              required
              minLength={MOTIVO_MINIMO}
              maxLength={MOTIVO_MAXIMO}
              autoComplete="off"
            />
          </div>
          <div className={estilos.acciones}>
            <BotonEnviar etiqueta="Sí, marcar como fallido" enCurso="Guardando…" />
            <button type="button" className="boton boton--secundario" onClick={() => setMarcando(false)}>
              No, volver
            </button>
          </div>
        </form>
      ) : (
        <div className={estilos.acciones}>
          <button type="button" className="boton boton--secundario" onClick={() => setMarcando(true)}>
            Marcar cobro como fallido
          </button>
        </div>
      )}
    </section>
  );
}

function BotonEnviar({ etiqueta, enCurso }: { etiqueta: string; enCurso: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="boton" disabled={pending}>
      {pending ? enCurso : etiqueta}
    </button>
  );
}
