'use client';

import { useEffect, useState, useTransition, type FormEvent } from 'react';

import { devolverEnvioAccion, estadoDeDevolucionAccion } from './acciones';
import estilos from './RecuperarDinero.module.css';

const INTERVALO_MS = 3000;

/**
 * The sender takes the money back once nobody claimed the transfer in time. The sender pastes an invoice for the
 * exact sats paid and presses the button; the server pays it and records the outcome. While a refund is being
 * paid, the page asks the server until BTCPay has answered.
 */
export function RecuperarDinero({
  envioId,
  sats,
  enCurso,
  motivo,
}: {
  envioId: string;
  /** The amount to put on the invoice, in words: "1,250 sats". */
  sats: string;
  /** True while BTCPay has not answered the refund yet. */
  enCurso: boolean;
  /** Why the last refund failed, shown again so the sender can try another invoice. */
  motivo: string | null;
}) {
  const [factura, setFactura] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [pendiente, empezar] = useTransition();

  useEffect(() => {
    if (!enCurso) return;
    let parado = false;
    const reloj = setInterval(consultar, INTERVALO_MS);

    async function consultar() {
      if (parado || document.visibilityState !== 'visible') return;
      try {
        // The server refreshes the page when BTCPay has answered; this check only keeps asking until then.
        await estadoDeDevolucionAccion(envioId);
      } catch {
        // A failed check is tried again on the next tick.
      }
    }

    return () => {
      parado = true;
      clearInterval(reloj);
    };
  }, [enCurso, envioId]);

  function devolver(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    setError(null);
    setAviso(null);
    empezar(async () => {
      try {
        const resultado = await devolverEnvioAccion(envioId, factura);
        if (!resultado.ok) setError(resultado.mensaje);
      } catch {
        setError('No pudimos conectarnos. Revisá tu conexión y probá de nuevo.');
      }
    });
  }

  function revisar() {
    setError(null);
    setAviso(null);
    empezar(async () => {
      try {
        const resultado = await estadoDeDevolucionAccion(envioId);
        if (!resultado.ok) setError(resultado.mensaje);
        else if (resultado.dato.devolucion === 'pagando') setAviso('Todavía no hay respuesta de BTCPay. Probá de nuevo en unos minutos.');
      } catch {
        setError('No pudimos conectarnos. Revisá tu conexión y probá de nuevo.');
      }
    });
  }

  if (enCurso) {
    return (
      <section className={estilos.recuperar} aria-labelledby="titulo-recuperar">
        <h2 id="titulo-recuperar">Recuperar mi dinero</h2>
        <p role="status" className={estilos.aviso}>
          Estamos devolviendo tu dinero. Esta página se actualiza sola.
        </p>
        {aviso && <p className={estilos.nota}>{aviso}</p>}
        {error && (
          <p role="alert" className={estilos.error}>
            {error}
          </p>
        )}
        <button type="button" className="boton boton--secundario" disabled={pendiente} onClick={revisar}>
          {pendiente ? 'Revisando…' : 'Revisar ahora'}
        </button>
      </section>
    );
  }

  return (
    <section className={estilos.recuperar} aria-labelledby="titulo-recuperar">
      <h2 id="titulo-recuperar">Recuperar mi dinero</h2>
      <p className={estilos.texto}>
        Nadie cobró este envío a tiempo. Copiá un código de pago de tu billetera de bitcoin por el mismo monto que pagaste
        y te devolvemos el dinero.
      </p>

      {motivo && (
        <p role="alert" className={estilos.error}>
          {motivo}
        </p>
      )}

      <form className={estilos.formulario} onSubmit={devolver}>
        <label htmlFor="factura-devolucion" className="campo-etiqueta">
          Pegá el código de pago
        </label>
        <textarea
          id="factura-devolucion"
          className={estilos.textoFactura}
          value={factura}
          onChange={(e) => setFactura(e.target.value)}
          rows={4}
          required
          spellCheck={false}
          autoComplete="off"
          aria-describedby="ayuda-devolucion"
          placeholder="Pegá aquí el código de pago"
        />
        <p id="ayuda-devolucion" className={estilos.nota}>
          El código tiene que ser por el mismo monto que pagaste: {sats} en bitcoin. Empieza con &quot;lnbc&quot;.
        </p>
        <p className={estilos.regtest}>
          <strong>Es bitcoin de prueba: no tiene valor real.</strong>
        </p>

        {error && (
          <p role="alert" className={estilos.error}>
            {error}
          </p>
        )}

        <button type="submit" className="boton" disabled={pendiente}>
          {pendiente ? 'Devolviendo…' : 'Recuperar mi dinero'}
        </button>
      </form>
    </section>
  );
}
