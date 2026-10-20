import { useActionState, useState, type RefObject } from 'react';
import { useFormStatus } from 'react-dom';

import { formatoMonto, type Entrega } from '@/lib/cotizacion';
import { ETIQUETA_ENTREGA } from '@/lib/transferencias';
import { LineasDinero } from '@/componentes/LineasDinero';
import { plazoEnvio, VIA_RECIBE } from '@/componentes/formatoEnvio';

import { crearEnvioAccion, type CotizacionEnvio, type EstadoCrearEnvio } from './acciones';
import estilos from './estilos.module.css';
import { VigenciaCotizacion } from './VigenciaCotizacion';
import { idAleatorio } from './visita';

/** Step 3: everything in plain words, then the button that creates the transfer. */
export function PasoConfirmar({
  tituloRef,
  montoCentavos,
  monedaOrigen,
  entrega,
  nombre,
  contacto,
  nota,
  cotizacion,
  usdBtc,
  onVencer,
  onVolver,
}: {
  tituloRef: RefObject<HTMLHeadingElement | null>;
  montoCentavos: number;
  monedaOrigen: 'USD' | 'EUR';
  entrega: Entrega;
  nombre: string;
  contacto: string;
  nota: string;
  cotizacion: CotizacionEnvio;
  usdBtc: number | null;
  /** The quote ran out: the form asks for a new one. */
  onVencer: () => void;
  onVolver: () => void;
}) {
  // One key per form: a double tap sends the same key, and the database answers with one transfer.
  const [clave] = useState(() => idAleatorio());
  const [estado, accion] = useActionState<EstadoCrearEnvio, FormData>(crearEnvioAccion, { error: null });

  const resumen = `Enviás ${formatoMonto(montoCentavos, monedaOrigen)}. ${nombre} recibe ${formatoMonto(
    cotizacion.montoDestino,
    cotizacion.monedaDestino,
  )} ${VIA_RECIBE[entrega]}. ${plazoEnvio(cotizacion.minutosEstimados)}`;

  return (
    <form action={accion} className={estilos.formulario}>
      <input type="hidden" name="montoCentavos" value={montoCentavos} />
      <input type="hidden" name="monedaOrigen" value={monedaOrigen} />
      <input type="hidden" name="entrega" value={entrega} />
      <input type="hidden" name="destinatarioNombre" value={nombre} />
      <input type="hidden" name="destinatarioContacto" value={contacto} />
      <input type="hidden" name="nota" value={nota} />
      <input type="hidden" name="clave" value={clave} />

      <h2 ref={tituloRef} tabIndex={-1} className={estilos.titulo}>
        Revisá y confirmá
      </h2>

      <p className={estilos.resumen}>{resumen}</p>

      <LineasDinero datos={cotizacion} usdBtc={usdBtc} />
      <VigenciaCotizacion validaHasta={cotizacion.validaHasta} onVencer={onVencer} />

      <dl className={estilos.datosFinales}>
        <div>
          <dt>Destinatario</dt> <dd>{nombre}</dd>
        </div>
        <div>
          <dt>Contacto</dt> <dd className="dato">{contacto}</dd>
        </div>
        <div>
          <dt>Cómo lo recibe</dt> <dd>{ETIQUETA_ENTREGA[entrega]}</dd>
        </div>
        {nota && (
          <div>
            <dt>Nota</dt> <dd>{nota}</dd>
          </div>
        )}
      </dl>

      <p className={estilos.recordatorio}>Después de confirmar pagás por Lightning. En esta demo es bitcoin de prueba, sin valor.</p>

      {estado.error && (
        <p role="alert" className={estilos.error}>
          {estado.error}
        </p>
      )}

      <div className={estilos.acciones}>
        <button type="button" className={estilos.enlaceVolver} onClick={onVolver}>
          Volver al destinatario
        </button>
        <BotonConfirmar />
      </div>
    </form>
  );
}

// Disabled while the form is sent, so a second tap waits for the first answer.
function BotonConfirmar() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="boton" disabled={pending}>
      {pending ? 'Confirmando…' : 'Confirmar envío'}
    </button>
  );
}
