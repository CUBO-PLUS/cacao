import type { Entrega } from '@/lib/cotizacion';
import type { EstadoEnvio } from '@/lib/transferencias';

import { LUGAR_RETIRO_DEMO } from './textosEnvio';
import estilos from './ComoSeRecoge.module.css';

/**
 * What happens next for a cash or bank transfer that is on its way: the pickup code and the place, or the
 * bank deposit. The sender and the recipient see the same block. Bitcoin transfers have their own screens.
 */
export function ComoSeRecoge({ entrega, codigo, estado }: { entrega: Entrega; codigo: string; estado: EstadoEnvio }) {
  if (estado !== 'procesando' || entrega === 'lightning') return null;

  if (entrega === 'efectivo') {
    return (
      <section className={estilos.caja} aria-labelledby="titulo-retiro">
        <h2 id="titulo-retiro" className={estilos.titulo}>
          Cómo lo recoge quien recibe
        </h2>
        <p>Tiene que llevar su DUI y este código al punto de pago.</p>
        <p className={estilos.codigo}>
          <span className="dato">{codigo}</span>
        </p>
        <p>
          <strong>Dónde:</strong> {LUGAR_RETIRO_DEMO}
        </p>
      </section>
    );
  }

  return (
    <section className={estilos.caja} aria-labelledby="titulo-deposito">
      <h2 id="titulo-deposito" className={estilos.titulo}>
        Cómo llega
      </h2>
      <p>El dinero se deposita en la cuenta bancaria indicada. No hay que hacer nada más.</p>
    </section>
  );
}
