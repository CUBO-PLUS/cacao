'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';

import type { AccionEnvio } from '@/lib/transferencias';

import estilos from '../../estilos.module.css';

import { ejecutarAccion } from './acciones';

const NOMBRE: Record<AccionEnvio, string> = {
  procesar: 'Poner en camino',
  completar: 'Marcar como entregado',
  fallar: 'Marcar como fallido',
  cancelar: 'Cancelar el envío',
};

// What the confirm step says before the change. Each one names what cannot be undone.
const PREGUNTA: Record<AccionEnvio, string> = {
  procesar: 'El envío sale hacia el destinatario. Después ya no se puede cancelar.',
  completar: 'Confirmá que el dinero llegó a la persona. Después no se puede volver atrás.',
  fallar: 'Contá por qué no se pudo entregar. Quien envió el dinero lo va a ver.',
  cancelar: 'Solo quien envió el dinero puede cancelarlo.',
};

// The three admin actions. One form at a time: the message stays here after a change, even when
// the buttons that were offered change with it.
export function AccionesEnvioAdmin({ envioId, acciones }: { envioId: string; acciones: AccionEnvio[] }) {
  const [estado, accion] = useActionState(ejecutarAccion, {});
  const [elegida, setElegida] = useState<AccionEnvio | null>(null);
  // A choice the transfer no longer allows closes by itself after a change.
  const abierta = elegida !== null && acciones.includes(elegida) ? elegida : null;

  return (
    <section className={estilos.seccion} aria-labelledby="titulo-acciones">
      <h2 id="titulo-acciones">Qué hacer con este envío</h2>

      {estado.mensaje && (
        <p role={estado.ok ? 'status' : 'alert'} className={estado.ok ? estilos.exito : estilos.error}>
          {estado.mensaje}
        </p>
      )}

      {acciones.length === 0 ? (
        <p className={estilos.leyenda}>No hay nada más que hacer: el envío ya terminó.</p>
      ) : abierta ? (
        <form action={accion} className={estilos.formulario}>
          <input type="hidden" name="envio" value={envioId} />
          <input type="hidden" name="accion" value={abierta} />
          <p className={estilos.frase}>{PREGUNTA[abierta]}</p>

          {abierta === 'fallar' && (
            <div className={estilos.filtroCampo}>
              <label htmlFor="motivo" className="campo-etiqueta">
                Motivo
              </label>
              <input
                id="motivo"
                name="motivo"
                type="text"
                className="campo"
                required
                minLength={4}
                maxLength={200}
                autoComplete="off"
                aria-describedby="ayuda-motivo"
              />
              <p id="ayuda-motivo" className={estilos.leyenda}>
                Entre 4 y 200 caracteres.
              </p>
            </div>
          )}

          <div className={estilos.acciones}>
            <BotonConfirmar etiqueta={`Sí, ${NOMBRE[abierta].toLowerCase()}`} />
            <button type="button" className="boton boton--secundario" onClick={() => setElegida(null)}>
              No, volver
            </button>
          </div>
        </form>
      ) : (
        <div className={estilos.acciones}>
          {acciones.map((a) => (
            <button key={a} type="button" className="boton" onClick={() => setElegida(a)}>
              {NOMBRE[a]}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

function BotonConfirmar({ etiqueta }: { etiqueta: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="boton" disabled={pending}>
      {pending ? 'Guardando…' : etiqueta}
    </button>
  );
}
