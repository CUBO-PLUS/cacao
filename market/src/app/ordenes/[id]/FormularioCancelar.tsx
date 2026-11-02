'use client';

import { useState } from 'react';

import { cancelarPedido, cancelarTrabajo } from './acciones';
import styles from './orden.module.css';
import { useAccion } from './useAccion';

// The database checks the same limits; the form shows them before a round trip.
const MINIMO = 4;
const MAXIMO = 300;

// One tap fills the reason. The text can still be edited, and the same limits apply to it.
const MOTIVOS_PEDIDO = ['Cambié de idea', 'Encontré otro precio', 'Me equivoqué al pedir', 'Tarda mucho el pago'];
const MOTIVOS_TRABAJO = ['Ya no lo necesito', 'No pudimos coordinar la hora', 'Cambió el precio acordado'];

// Cancels with a reason. A job: either party while it is agreed. A product order: the buyer, before it
// is paid, and the stock goes back. Behind a disclosure, like the dispute form, and a second step,
// because a cancelled order cannot be reopened. `alCancelar` lets the payment screen refresh itself.
export function FormularioCancelar({
  ordenId,
  trabajo = true,
  alCancelar,
  alIniciar,
}: {
  ordenId: string;
  trabajo?: boolean;
  alCancelar?: () => void;
  alIniciar?: () => void;
}) {
  const [abierto, setAbierto] = useState(false);
  const [motivo, setMotivo] = useState('');
  const [preguntando, setPreguntando] = useState(false);
  const [errorLocal, setErrorLocal] = useState<string | null>(null);
  const { pendiente, error, correr } = useAccion();

  // Counted in code points, as the server counts them.
  const largo = Array.from(motivo.trim()).length;

  function pedirConfirmacion(evento: React.FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    if (largo < MINIMO || largo > MAXIMO) {
      setErrorLocal(`El motivo tiene que tener entre ${MINIMO} y ${MAXIMO} caracteres.`);
      return;
    }
    setErrorLocal(null);
    setPreguntando(true);
  }

  function confirmar() {
    const operacion = trabajo ? cancelarTrabajo : cancelarPedido;
    correr(
      () => operacion(ordenId, motivo.trim()),
      () => {
        setPreguntando(false);
        setAbierto(false);
        alCancelar?.();
      },
      alIniciar,
    );
  }

  const mensajeError = errorLocal ?? error;

  return (
    <div className={styles.disclosure}>
      <button
        type="button"
        className="boton boton--secundario"
        aria-expanded={abierto}
        aria-controls="formulario-cancelar"
        onClick={() => setAbierto((v) => !v)}
      >
        {trabajo ? 'Cancelar este trabajo' : 'Cancelar pedido'}
      </button>

      {abierto && (
        <form id="formulario-cancelar" className={styles.formulario} onSubmit={pedirConfirmacion} noValidate>
          <p className={styles.ayuda}>
            {trabajo
              ? 'Si lo cancelás, no se puede deshacer. La otra persona ve el motivo en la orden.'
              : 'Si lo cancelás, no se puede deshacer. Los productos vuelven al inventario y la tienda ve el motivo.'}
          </p>

          <div className={styles.campoGrupo}>
            <label htmlFor="cancelar-motivo" className="campo-etiqueta">
              Motivo de la cancelación
            </label>
            <div className={styles.motivosRapidos} role="group" aria-label="Motivos frecuentes">
              {(trabajo ? MOTIVOS_TRABAJO : MOTIVOS_PEDIDO).map((motivoRapido) => (
                <button
                  key={motivoRapido}
                  type="button"
                  className="boton boton--secundario"
                  onClick={() => {
                    setMotivo(motivoRapido);
                    setPreguntando(false);
                    setErrorLocal(null);
                  }}
                >
                  {motivoRapido}
                </button>
              ))}
            </div>
            <textarea
              id="cancelar-motivo"
              className={styles.campoTexto}
              rows={3}
              maxLength={MAXIMO}
              required
              value={motivo}
              aria-describedby="cancelar-motivo-ayuda"
              onChange={(e) => {
                setMotivo(e.target.value);
                setPreguntando(false);
              }}
            />
            <span id="cancelar-motivo-ayuda" className={styles.ayuda}>
              Entre {MINIMO} y {MAXIMO} caracteres. {largo}/{MAXIMO}
            </span>
          </div>

          {!preguntando && (
            <div>
              <button type="submit" className="boton" disabled={pendiente}>
                {trabajo ? 'Cancelar el trabajo' : 'Cancelar el pedido'}
              </button>
            </div>
          )}

          {preguntando && (
            <div className={styles.confirmacion}>
              <p className={styles.pregunta}>
                {trabajo
                  ? '¿Seguro que querés cancelar este trabajo? No se puede deshacer.'
                  : '¿Seguro que querés cancelar este pedido? No se puede deshacer.'}
              </p>
              <div className={styles.fila}>
                <button type="button" className="boton" disabled={pendiente} onClick={confirmar}>
                  {pendiente ? 'Cancelando…' : trabajo ? 'Sí, cancelar el trabajo' : 'Sí, cancelar el pedido'}
                </button>
                <button
                  type="button"
                  className="boton boton--secundario"
                  disabled={pendiente}
                  onClick={() => setPreguntando(false)}
                >
                  Volver
                </button>
              </div>
            </div>
          )}

          {mensajeError && (
            <p role="alert" className={styles.error}>
              {mensajeError}
            </p>
          )}
        </form>
      )}
    </div>
  );
}
