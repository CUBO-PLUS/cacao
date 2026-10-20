import type { FormEvent, RefObject } from 'react';

import type { Entrega } from '@/lib/cotizacion';
import type { RecienteDestinatario } from '@/lib/recientes';

import estilos from './estilos.module.css';

// Short names for the chips: the full sentences are on the confirmation step.
const ENTREGA_CORTA: Record<Entrega, string> = {
  efectivo: 'Efectivo',
  cuenta: 'Cuenta bancaria',
  lightning: 'Lightning',
};

/** Step 2: who receives the money and how to reach them. */
export function PasoDestinatario({
  tituloRef,
  nombre,
  onNombre,
  nombreRef,
  errorNombre,
  contacto,
  onContacto,
  contactoRef,
  errorContacto,
  nota,
  onNota,
  recientes,
  onElegirReciente,
  onVolver,
  onSeguir,
}: {
  tituloRef: RefObject<HTMLHeadingElement | null>;
  nombre: string;
  onNombre: (valor: string) => void;
  nombreRef: RefObject<HTMLInputElement | null>;
  errorNombre: string | null;
  contacto: string;
  onContacto: (valor: string) => void;
  contactoRef: RefObject<HTMLInputElement | null>;
  errorContacto: string | null;
  nota: string;
  onNota: (valor: string) => void;
  /** The people sent to before: one tap fills the name and the contact. */
  recientes: RecienteDestinatario[];
  onElegirReciente: (reciente: RecienteDestinatario) => void;
  onVolver: () => void;
  onSeguir: (evento: FormEvent<HTMLFormElement>) => void;
}) {
  // A phone gets the fixed +503 in front; an email has none.
  const esCorreo = contacto.includes('@');

  return (
    <form className={estilos.formulario} onSubmit={onSeguir} noValidate>
      <h2 ref={tituloRef} tabIndex={-1} className={estilos.titulo}>
        Destinatario
      </h2>

      {recientes.length > 0 && (
        <section className={estilos.recientes} aria-labelledby="titulo-recientes">
          <h3 id="titulo-recientes" className={estilos.subtitulo}>
            Ya les enviaste
          </h3>
          <ul className={estilos.chips}>
            {recientes.map((reciente) => (
              <li key={reciente.contacto}>
                <button
                  type="button"
                  className={estilos.chip}
                  onClick={() => onElegirReciente(reciente)}
                  aria-label={`Usar a ${reciente.nombre}, ${reciente.contactoEnmascarado}`}
                >
                  <strong>{reciente.nombre}</strong>
                  <span className="dato">{reciente.contactoEnmascarado}</span>
                  <small>{ENTREGA_CORTA[reciente.entrega]}</small>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className={estilos.grupo}>
        <label htmlFor="envio-nombre" className="campo-etiqueta">
          Cómo se llama quien recibe
        </label>
        <input
          id="envio-nombre"
          ref={nombreRef}
          className="campo"
          type="text"
          autoComplete="off"
          value={nombre}
          onChange={(e) => onNombre(e.target.value)}
          aria-invalid={errorNombre ? true : undefined}
          aria-describedby={errorNombre ? 'envio-nombre-error' : undefined}
        />
        {errorNombre && (
          <p id="envio-nombre-error" role="alert" className={estilos.error}>
            {errorNombre}
          </p>
        )}
      </div>

      <div className={estilos.grupo}>
        <label htmlFor="envio-contacto" className="campo-etiqueta">
          Su celular o su correo
        </label>
        <div className={esCorreo ? undefined : estilos.contacto}>
          {!esCorreo && <span className={estilos.prefijo}>+503</span>}
          <input
            id="envio-contacto"
            ref={contactoRef}
            className="campo"
            type="text"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            value={contacto}
            onChange={(e) => onContacto(e.target.value)}
            aria-invalid={errorContacto ? true : undefined}
            aria-describedby={errorContacto ? 'envio-contacto-error' : 'envio-contacto-ayuda'}
          />
        </div>
        <p id="envio-contacto-ayuda" className={estilos.ayuda}>
          Son 8 números de El Salvador, o un correo. Si esa persona tiene cuenta con ese celular o correo, lo ve en
          Recibidos. Al confirmar, te damos un enlace para mandárselo por WhatsApp.
        </p>
        {errorContacto && (
          <p id="envio-contacto-error" role="alert" className={estilos.error}>
            {errorContacto}
          </p>
        )}
      </div>

      <div className={estilos.grupo}>
        <label htmlFor="envio-nota" className="campo-etiqueta">
          Nota para quien recibe (opcional)
        </label>
        <textarea
          id="envio-nota"
          className={`campo ${estilos.area}`}
          rows={3}
          maxLength={200}
          value={nota}
          onChange={(e) => onNota(e.target.value)}
          aria-describedby="envio-nota-contador"
        />
        <p id="envio-nota-contador" className={estilos.ayuda}>
          {`${Array.from(nota).length} de 200 caracteres`}
        </p>
      </div>

      <div className={estilos.acciones}>
        <button type="button" className={estilos.enlaceVolver} onClick={onVolver}>
          Volver al monto
        </button>
        <button type="submit" className="boton">
          Seguir
        </button>
      </div>
    </form>
  );
}
