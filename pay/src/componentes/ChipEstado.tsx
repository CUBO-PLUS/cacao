import { etiquetaDeEstado, type EstadoEnvio } from '@/lib/transferencias';
import type { Entrega } from '@/lib/cotizacion';

import estilos from './ChipEstado.module.css';

// The state as a labelled chip. The words carry the meaning; the colour only repeats it.
export function ChipEstado({ estado, entrega }: { estado: EstadoEnvio; entrega?: Entrega }) {
  return <span className={`${estilos.chip} ${estilos[estado]}`}>{etiquetaDeEstado(estado, entrega)}</span>;
}
