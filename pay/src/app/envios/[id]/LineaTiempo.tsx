import { fechaEnvio, plazoEnvio } from '@/componentes/formatoEnvio';
import { PASOS, type EstadoEnvio } from '@/lib/transferencias';
import type { EnvioDetalle } from '@/servidor/transferencias';

import estilos from './estilos.module.css';

// Every step carries its word, so the state never depends on colour alone.
type Visual = 'hecho' | 'enCurso' | 'pendiente' | 'final';
const ROTULO: Record<Visual, string> = {
  hecho: 'Hecho',
  enCurso: 'En curso',
  pendiente: 'Pendiente',
  final: 'Final',
};

type Item = { titulo: string; visual: Visual; cuando: string | null; detalle: string | null };

// Where the transfer stopped on the way, by state. The history is the source; the columns of the
// transfer fill in a state that has no history line.
function cuandoLlego(envio: EnvioDetalle, estado: EstadoEnvio): string | null {
  const paso = envio.historial.find((p) => p.estado === estado);
  if (paso) return paso.cuando;
  const columna: Record<EstadoEnvio, string | null> = {
    creada: envio.creadaEn,
    procesando: envio.procesandoEn,
    completada: envio.completadaEn,
    fallida: envio.fallidaEn,
    cancelada: envio.canceladaEn,
    devuelta: envio.devueltaEn,
  };
  return columna[estado];
}

// What each of the three steps looks like for each state on the way.
const VISUALES: Record<'creada' | 'procesando' | 'completada', Visual[]> = {
  creada: ['hecho', 'pendiente', 'pendiente'],
  procesando: ['hecho', 'enCurso', 'pendiente'],
  completada: ['hecho', 'hecho', 'hecho'],
};

// The last step of a transfer that ended without arriving.
const TITULO_FIN: Partial<Record<EstadoEnvio, string>> = {
  fallida: 'No se pudo entregar',
  cancelada: 'Cancelado',
  devuelta: 'Devuelto a quien lo envió',
};

function pasosDelEnvio(envio: EnvioDetalle): Item[] {
  if (envio.estado === 'fallida' || envio.estado === 'cancelada' || envio.estado === 'devuelta') {
    // The steps it reached, then the end, with the reason.
    const alcanzados: Item[] = PASOS.filter((p) => cuandoLlego(envio, p.estado) !== null).map((p) => ({
      titulo: p.titulo,
      visual: 'hecho',
      cuando: cuandoLlego(envio, p.estado),
      detalle: null,
    }));
    const fin: Item = {
      titulo: TITULO_FIN[envio.estado] ?? 'Final',
      visual: 'final',
      cuando: cuandoLlego(envio, envio.estado),
      detalle: envio.estado === 'fallida' && envio.motivo ? `Motivo: ${envio.motivo}` : null,
    };
    return [...alcanzados, fin];
  }

  const estado = envio.estado;
  return PASOS.map((p, i) => ({
    titulo: p.titulo,
    visual: VISUALES[estado][i],
    cuando: cuandoLlego(envio, p.estado),
    detalle: null,
  }));
}

/** The steps of a transfer as an ordered list: state word, title and time for each. */
export function LineaTiempo({ envio }: { envio: EnvioDetalle }) {
  const items = pasosDelEnvio(envio);
  return (
    <div className={estilos.tiempo}>
      <ol className={estilos.lineaTiempo}>
        {items.map((item) => (
          <li key={item.titulo} className={`${estilos.paso} ${estilos[item.visual]}`}>
            <span className={estilos.rotulo}>{ROTULO[item.visual]}</span>
            <span className={estilos.textoPaso}>
              <strong>{item.titulo}</strong>
              {item.cuando && <small className={estilos.nota}>{fechaEnvio(item.cuando)}</small>}
              {item.detalle && <small className={estilos.nota}>{item.detalle}</small>}
            </span>
          </li>
        ))}
      </ol>
      {envio.estado === 'procesando' && <p className={estilos.plazo}>{plazoEnvio(envio.minutosEstimados)}</p>}
    </div>
  );
}
