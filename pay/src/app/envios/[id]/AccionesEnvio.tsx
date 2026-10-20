'use client';

import { type FormEvent, useState, useTransition } from 'react';

import type { AccionEnvio } from '@/lib/transferencias';

import {
  cancelarEnvioAccion,
  procesarEnvioAccion,
  type ResultadoAccion,
  simularCompletarAccion,
  simularFallarAccion,
} from './acciones';
import estilos from './estilos.module.css';
import { PagoLightning } from './PagoLightning';

const MOTIVO_MINIMO = 4;
const MOTIVO_MAXIMO = 200;

type Confirmacion = 'procesar' | 'cancelar' | null;

/**
 * What the person can do with the transfer now. The list comes from the server (accionesPosibles);
 * this only shows it, asks before the irreversible step, and reports the result.
 */
export function AccionesEnvio({
  envioId,
  acciones,
  pagoLightning,
}: {
  envioId: string;
  acciones: AccionEnvio[];
  /** BTCPay is set up and the viewer is the sender: "Enviar ahora" becomes a Lightning payment. */
  pagoLightning: boolean;
}) {
  const [confirmando, setConfirmando] = useState<Confirmacion>(null);
  const [enCurso, setEnCurso] = useState<AccionEnvio | null>(null);
  const [resultado, setResultado] = useState<ResultadoAccion | null>(null);
  const [motivo, setMotivo] = useState('');
  const [errorMotivo, setErrorMotivo] = useState<string | null>(null);
  const [pendiente, empezar] = useTransition();

  function ejecutar(accion: AccionEnvio, hacer: () => Promise<ResultadoAccion>) {
    setResultado(null);
    setConfirmando(null);
    setEnCurso(accion);
    empezar(async () => {
      const respuesta = await hacer();
      setResultado(respuesta);
      setEnCurso(null);
    });
  }

  function simularFallo(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    const limpio = motivo.trim();
    const largo = Array.from(limpio).length;
    if (largo < MOTIVO_MINIMO || largo > MOTIVO_MAXIMO) {
      setErrorMotivo(`Escribí el motivo con entre ${MOTIVO_MINIMO} y ${MOTIVO_MAXIMO} caracteres.`);
      return;
    }
    setErrorMotivo(null);
    ejecutar('fallar', () => simularFallarAccion(envioId, limpio));
  }

  // With Lightning on, the sender pays the invoice instead of starting the transfer by hand.
  const puedeProcesar = acciones.includes('procesar') && !pagoLightning;
  const puedePagar = acciones.includes('procesar') && pagoLightning;
  const puedeCancelar = acciones.includes('cancelar');
  const puedeCompletar = acciones.includes('completar');
  const puedeFallar = acciones.includes('fallar');

  return (
    <div className={estilos.acciones}>
      {puedePagar && <PagoLightning envioId={envioId} />}

      {(puedeProcesar || puedeCancelar) && (
        <section className={estilos.bloqueAcciones} aria-labelledby="titulo-acciones">
          <h2 id="titulo-acciones" className="solo-lectores">
            Qué podés hacer
          </h2>

          {puedeProcesar &&
            (confirmando === 'procesar' ? (
              <div className={estilos.confirmacion}>
                <p>Una vez que sale, ya no se puede cancelar.</p>
                <div className={estilos.botones}>
                  <button
                    type="button"
                    className="boton"
                    disabled={pendiente}
                    onClick={() => ejecutar('procesar', () => procesarEnvioAccion(envioId))}
                  >
                    {enCurso === 'procesar' ? 'Enviando…' : 'Sí, enviar ahora'}
                  </button>
                  <button
                    type="button"
                    className="boton boton--secundario"
                    disabled={pendiente}
                    onClick={() => setConfirmando(null)}
                  >
                    Volver
                  </button>
                </div>
              </div>
            ) : (
              <button type="button" className="boton" disabled={pendiente} onClick={() => setConfirmando('procesar')}>
                Enviar ahora
              </button>
            ))}

          {puedeCancelar &&
            (confirmando === 'cancelar' ? (
              <div className={estilos.confirmacion}>
                <p>¿Cancelás el envío? Todavía no salió, así que no se mueve dinero.</p>
                <div className={estilos.botones}>
                  <button
                    type="button"
                    className="boton"
                    disabled={pendiente}
                    onClick={() => ejecutar('cancelar', () => cancelarEnvioAccion(envioId))}
                  >
                    {enCurso === 'cancelar' ? 'Cancelando…' : 'Sí, cancelar el envío'}
                  </button>
                  <button
                    type="button"
                    className="boton boton--secundario"
                    disabled={pendiente}
                    onClick={() => setConfirmando(null)}
                  >
                    No, dejarlo
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                className="boton boton--secundario"
                disabled={pendiente}
                onClick={() => setConfirmando('cancelar')}
              >
                Cancelar envío
              </button>
            ))}
        </section>
      )}

      {(puedeCompletar || puedeFallar) && (
        <section className={estilos.simulacion} aria-labelledby="titulo-simulacion">
          <h2 id="titulo-simulacion">Simulación (modo demo)</h2>
          <p>No se mueve dinero real. Sirve para ver cómo termina un envío.</p>

          {puedeCompletar && (
            <button
              type="button"
              className="boton"
              disabled={pendiente}
              onClick={() => ejecutar('completar', () => simularCompletarAccion(envioId))}
            >
              {enCurso === 'completar' ? 'Simulando…' : 'Simular que llegó'}
            </button>
          )}

          {puedeFallar && (
            <form className={estilos.formularioFallo} onSubmit={simularFallo} noValidate>
              <div className={estilos.grupo}>
                <label htmlFor="motivo-fallo" className="campo-etiqueta">
                  Motivo del fallo
                </label>
                <input
                  id="motivo-fallo"
                  className="campo"
                  type="text"
                  autoComplete="off"
                  maxLength={MOTIVO_MAXIMO}
                  value={motivo}
                  onChange={(e) => setMotivo(e.target.value)}
                  aria-invalid={errorMotivo ? true : undefined}
                  aria-describedby={errorMotivo ? 'motivo-fallo-error' : undefined}
                />
                {errorMotivo && (
                  <p id="motivo-fallo-error" role="alert" className={estilos.error}>
                    {errorMotivo}
                  </p>
                )}
              </div>
              <button type="submit" className="boton boton--secundario" disabled={pendiente}>
                {enCurso === 'fallar' ? 'Simulando…' : 'Simular que falló'}
              </button>
            </form>
          )}
        </section>
      )}

      <div aria-live="polite" className={estilos.resultado}>
        {resultado &&
          (resultado.ok ? (
            <p className={estilos.exito}>{resultado.mensaje}</p>
          ) : (
            <p role="alert" className={estilos.error}>
              {resultado.mensaje}
            </p>
          ))}
      </div>
    </div>
  );
}
