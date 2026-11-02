'use client';

import { useState } from 'react';

import { Boton } from '@/componentes/Boton';
import type { Accion } from '@/lib/estados';
import type { Resultado } from '@/servidor/resultado';

import {
  confirmarEntregaComprador,
  confirmarPago,
  confirmarReembolsoComprador,
  entregarConCodigoVendedor,
  marcarOrdenLista,
  marcarReembolsoVendedor,
  marcarTrabajoHecho,
  simularEntregaDeDemo,
} from './acciones';
import { FormularioCancelar } from './FormularioCancelar';
import { FormularioDisputa } from './FormularioDisputa';
import { FormularioResena } from './FormularioResena';
import styles from './orden.module.css';
import { useOrdenViva } from './OrdenViva';
import { useAccion } from './useAccion';

// Renders exactly the actions the state machine returned. Nothing here decides who may act.
// `trabajo` and `pagada` only change the wording: a job says "trabajo" where a product says "orden".
export function AccionesOrden({
  ordenId,
  acciones,
  trabajo = false,
  pagada = true,
}: {
  ordenId: string;
  acciones: Accion[];
  trabajo?: boolean;
  pagada?: boolean;
}) {
  const tiene = (accion: Accion) => acciones.includes(accion);
  // The page's order state: an action that ends the order shows its result at once, not after the round trip.
  const orden = useOrdenViva();

  return (
    <div className={styles.bloque}>
      {tiene('pagar') && (
        <Boton href={`/ordenes/${ordenId}/pagar`}>{trabajo ? 'Pagar el trabajo' : 'Pagar la orden'}</Boton>
      )}

      {tiene('marcar_hecha') && (
        <BotonConConfirmacion
          etiqueta="Marcar trabajo hecho"
          pregunta="El cliente va a recibir el aviso para pagar."
          etiquetaConfirmar="Sí, está hecho"
          operacion={() => marcarTrabajoHecho(ordenId)}
        />
      )}

      {tiene('cancelar') && (
        <FormularioCancelar
          ordenId={ordenId}
          trabajo={trabajo}
          alIniciar={trabajo ? undefined : () => orden?.marcarEstado('cancelada')}
          alCancelar={trabajo ? undefined : () => orden?.setResultado('cancelada')}
        />
      )}

      {tiene('confirmar_pago') && (
        <Paso descripcion="El pago no llega solo a la app cuando la Lightning Address no avisa. Confirmalo a mano.">
          <BotonConConfirmacion
            etiqueta="Confirmar pago recibido"
            pregunta="¿Ya viste el pago en tu billetera?"
            etiquetaConfirmar="Sí, lo vi"
            operacion={() => confirmarPago(ordenId)}
          />
        </Paso>
      )}

      {tiene('marcar_lista') && (
        <Paso descripcion="Avisale al comprador que el pedido está listo.">
          <BotonDirecto etiqueta="Marcar como lista" operacion={() => marcarOrdenLista(ordenId)} />
        </Paso>
      )}

      {tiene('marcar_entregada') && (
        <Paso descripcion="Confirmá solo cuando ya tengas el pedido en la mano.">
          <BotonConConfirmacion
            etiqueta="Ya lo recibí"
            pregunta="¿Ya recibiste el pedido?"
            etiquetaConfirmar="Sí, ya lo recibí"
            operacion={() => confirmarEntregaComprador(ordenId)}
          />
        </Paso>
      )}

      {tiene('simular_entrega') && (
        <Paso descripcion="Este negocio es de demostración: no participa en CacaoMarket y no va a marcar el pedido. Simulá la entrega para ver el recibo.">
          <BotonConConfirmacion
            etiqueta="Simular entrega"
            pregunta="¿Simulamos la entrega de este pedido de demostración?"
            etiquetaConfirmar="Sí, simular entrega"
            operacion={() => simularEntregaDeDemo(ordenId)}
            alIniciar={() => orden?.marcarEstado('entregada')}
            alExito={() => orden?.setResultado('entregada')}
          />
        </Paso>
      )}

      {tiene('entregar_con_codigo') && <EntregarConCodigo ordenId={ordenId} />}

      {tiene('marcar_reembolso') && (
        <Paso descripcion="Pagá el reembolso fuera de la app y marcalo acá. El comprador lo confirma después.">
          <BotonConConfirmacion
            etiqueta="Marcar reembolso como pagado"
            pregunta="¿Ya pagaste el reembolso fuera de la app?"
            etiquetaConfirmar="Sí, ya lo pagué"
            operacion={() => marcarReembolsoVendedor(ordenId)}
          />
        </Paso>
      )}

      {tiene('confirmar_reembolso') && (
        <Paso descripcion="El vendedor marcó el reembolso como pagado.">
          <BotonConConfirmacion
            etiqueta="Confirmar que recibí el reembolso"
            pregunta="¿Ya recibiste el reembolso?"
            etiquetaConfirmar="Sí, lo recibí"
            operacion={() => confirmarReembolsoComprador(ordenId)}
          />
        </Paso>
      )}

      {tiene('resenar') && (
        <section aria-labelledby="resena-titulo" className={styles.bloque}>
          <h3 id="resena-titulo">Dejá tu reseña</h3>
          <FormularioResena ordenId={ordenId} />
        </section>
      )}

      {tiene('abrir_disputa') && (
        <FormularioDisputa ordenId={ordenId} trabajoSinPagar={trabajo && !pagada} trabajo={trabajo} />
      )}
    </div>
  );
}

function Paso({ descripcion, children }: { descripcion: string; children: React.ReactNode }) {
  return (
    <div className={styles.accion}>
      <p>{descripcion}</p>
      {children}
    </div>
  );
}

function BotonDirecto({ etiqueta, operacion }: { etiqueta: string; operacion: () => Promise<Resultado<null>> }) {
  const { pendiente, error, correr } = useAccion();
  return (
    <div className={styles.bloque}>
      <button type="button" className="boton" disabled={pendiente} onClick={() => correr(operacion)}>
        {pendiente ? 'Enviando…' : etiqueta}
      </button>
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
    </div>
  );
}

// Two steps for the actions that cannot be undone: the first button asks, the second confirms.
function BotonConConfirmacion({
  etiqueta,
  pregunta,
  etiquetaConfirmar,
  operacion,
  alIniciar,
  alExito,
}: {
  etiqueta: string;
  pregunta: string;
  etiquetaConfirmar: string;
  operacion: () => Promise<Resultado<null>>;
  alIniciar?: () => void;
  alExito?: () => void;
}) {
  const [preguntando, setPreguntando] = useState(false);
  const { pendiente, error, correr } = useAccion();

  if (!preguntando) {
    return (
      <button type="button" className="boton" onClick={() => setPreguntando(true)}>
        {etiqueta}
      </button>
    );
  }

  return (
    <div className={styles.confirmacion}>
      <p className={styles.pregunta}>{pregunta}</p>
      <div className={styles.fila}>
        <button
          type="button"
          className="boton"
          disabled={pendiente}
          onClick={() =>
            correr(
              operacion,
              () => {
                setPreguntando(false);
                alExito?.();
              },
              alIniciar,
            )
          }
        >
          {pendiente ? 'Enviando…' : etiquetaConfirmar}
        </button>
        <button
          type="button"
          className="boton boton--secundario"
          disabled={pendiente}
          onClick={() => setPreguntando(false)}
        >
          Cancelar
        </button>
      </div>
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
    </div>
  );
}

// The six digits the buyer shows. Spaces are allowed and dropped before sending.
function EntregarConCodigo({ ordenId }: { ordenId: string }) {
  const [codigo, setCodigo] = useState('');
  const [errorLocal, setErrorLocal] = useState<string | null>(null);
  const { pendiente, error, correr } = useAccion();

  function enviar(evento: React.FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    const limpio = codigo.replace(/\s/g, '');
    if (!/^\d{6}$/.test(limpio)) {
      setErrorLocal('El código tiene seis números.');
      return;
    }
    setErrorLocal(null);
    correr(() => entregarConCodigoVendedor(ordenId, limpio), () => setCodigo(''));
  }

  const mensajeError = errorLocal ?? error;

  return (
    <form className={styles.formulario} onSubmit={enviar} noValidate>
      <p>Cuando entregues el pedido, pedile al comprador el código de entrega. Lo ve en su orden.</p>
      <div className={styles.campoGrupo}>
        <label htmlFor="codigo-entrega" className="campo-etiqueta">
          Código de entrega
        </label>
        <input
          id="codigo-entrega"
          className={`campo ${styles.codigoEntrada}`}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          spellCheck={false}
          maxLength={7}
          value={codigo}
          aria-describedby="codigo-ayuda"
          onChange={(e) => setCodigo(e.target.value.replace(/[^\d ]/g, ''))}
        />
        <span id="codigo-ayuda" className={styles.ayuda}>
          Seis números. El espacio del medio es opcional.
        </span>
      </div>
      {mensajeError && (
        <p role="alert" className={styles.error}>
          {mensajeError}
        </p>
      )}
      <div>
        <button type="submit" className="boton" disabled={pendiente}>
          {pendiente ? 'Confirmando…' : 'Confirmar entrega'}
        </button>
      </div>
    </form>
  );
}
