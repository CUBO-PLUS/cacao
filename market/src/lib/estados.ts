// Order states, Spanish labels, and what each role can do next.
// A product order (tipo 'productos') and a job (tipo 'servicio') share the table, but a job walks
// its own path: acordada -> hecha -> esperando_pago -> entregada -> cerrada.

export type EstadoOrden =
  | 'creada'
  | 'esperando_pago'
  | 'pagada'
  | 'lista'
  | 'entregada'
  | 'cerrada'
  | 'expirada'
  | 'disputada'
  | 'resuelta'
  | 'acordada'
  | 'hecha'
  | 'cancelada';

export type TipoOrden = 'productos' | 'servicio';

export type Rol = 'comprador' | 'vendedor' | 'admin';

// The two parties of an order, for the wording on screen.
export type RolParte = 'comprador' | 'vendedor';

export type Accion =
  | 'pagar'
  | 'confirmar_pago'
  | 'marcar_lista'
  | 'marcar_entregada'
  | 'entregar_con_codigo'
  | 'resenar'
  | 'abrir_disputa'
  | 'resolver_disputa'
  | 'marcar_reembolso'
  | 'confirmar_reembolso'
  | 'marcar_hecha'
  | 'cancelar';

export type ResultadoDisputa =
  | 'reembolso_total'
  | 'reembolso_parcial'
  | 'sin_reembolso'
  | 'corresponde_pagar'
  | 'no_corresponde_pagar';

export const ETIQUETA_ESTADO: Record<EstadoOrden, string> = {
  creada: 'Creada',
  esperando_pago: 'Esperando pago',
  pagada: 'Pagada',
  lista: 'Lista',
  entregada: 'Entregada',
  cerrada: 'Cerrada',
  expirada: 'Expirada',
  disputada: 'En disputa',
  resuelta: 'Resuelta',
  acordada: 'Acordada',
  hecha: 'Trabajo hecho',
  cancelada: 'Cancelada',
};

// Product wording. The job states that read differently come from DESCRIPCION_TRABAJO.
export const DESCRIPCION_ESTADO: Record<EstadoOrden, Record<RolParte, string>> = {
  creada: {
    comprador: 'Estamos registrando tu orden. Esperá un momento.',
    vendedor: 'Se está registrando la orden. Esperá un momento.',
  },
  esperando_pago: {
    comprador: 'Pagá la factura antes de que venza, o la orden expira.',
    vendedor: 'Esperá el pago. Si la Lightning Address no avisa sola, confirmalo a mano.',
  },
  pagada: {
    comprador: 'Pagaste. El vendedor está preparando tu pedido.',
    vendedor: 'Pago recibido. Preparalo y marcalo como lista cuando esté.',
  },
  lista: {
    comprador: 'Tu pedido está listo. Marcalo como entregado cuando lo recibas.',
    vendedor: 'Entregá el pedido y pedile al comprador el código de entrega.',
  },
  entregada: {
    comprador: 'Recibiste el pedido. Dejá una reseña o abrí una disputa dentro de las 48 h.',
    vendedor: 'El pedido fue entregado. La orden se cierra sola en 48 h si no hay disputa.',
  },
  cerrada: {
    comprador: 'La orden está cerrada. Podés dejar una reseña del vendedor.',
    vendedor: 'La orden está cerrada. El pago ya es tuyo.',
  },
  expirada: {
    comprador: 'El pago no llegó a tiempo y la orden expiró. Podés hacer otro pedido.',
    vendedor: 'El pago no llegó a tiempo y la orden expiró. El stock volvió a tu inventario.',
  },
  disputada: {
    comprador: 'Abriste una disputa. El administrador la va a revisar.',
    vendedor: 'El comprador abrió una disputa. El administrador la va a revisar.',
  },
  resuelta: {
    comprador: 'La disputa está resuelta. Revisá el resultado y confirmá el reembolso si corresponde.',
    vendedor: 'La disputa está resuelta. Si corresponde un reembolso, pagalo fuera de la app y marcalo.',
  },
  acordada: {
    comprador: 'Pagás cuando el trabajo esté hecho. CacaoMarket no guarda tu dinero. Coordiná hora y lugar por el chat.',
    vendedor: 'Coordiná hora y lugar por el chat. Cuando termines, marcá el trabajo como hecho.',
  },
  hecha: {
    comprador: 'El trabajo está hecho. Pagalo cuando estés conforme. Si no estás de acuerdo, abrí una disputa.',
    vendedor: 'Marcaste el trabajo como hecho. El cliente ya puede pagarte.',
  },
  // A product order is cancelled by its buyer before it is paid.
  cancelada: {
    comprador: 'Cancelaste este pedido. Los productos volvieron al inventario.',
    vendedor: 'El comprador canceló este pedido antes de pagar.',
  },
};

// Job wording for the states that read differently from a product. Other states use DESCRIPCION_ESTADO.
const DESCRIPCION_TRABAJO: Partial<Record<EstadoOrden, Record<RolParte, string>>> = {
  cancelada: {
    comprador: 'El trabajo se canceló. Revisá el motivo en la orden.',
    vendedor: 'El trabajo se canceló. Revisá el motivo en la orden.',
  },
  esperando_pago: {
    comprador: 'Pagá el trabajo. El monto en sats ya está fijado.',
    vendedor: 'El cliente está pagando.',
  },
  entregada: {
    comprador: 'Pagaste. Podés dejar una reseña.',
    vendedor: 'Te pagaron. El trabajo quedó terminado.',
  },
  cerrada: {
    comprador: 'El trabajo está cerrado. Podés dejar una reseña de quien trabajó.',
    vendedor: 'El trabajo está cerrado. El pago ya es tuyo.',
  },
};

export function descripcionDeEstado(estado: EstadoOrden, rol: RolParte, tipo: TipoOrden): string {
  if (tipo === 'servicio') {
    const trabajo = DESCRIPCION_TRABAJO[estado];
    if (trabajo) return trabajo[rol];
  }
  return DESCRIPCION_ESTADO[estado][rol];
}

// Happy path, in order, for the progress display.
export const PASOS: EstadoOrden[] = ['esperando_pago', 'pagada', 'lista', 'entregada', 'cerrada'];
export const PASOS_SERVICIO: EstadoOrden[] = ['acordada', 'hecha', 'esperando_pago', 'entregada', 'cerrada'];

export function pasosDe(tipo: TipoOrden): EstadoOrden[] {
  return tipo === 'servicio' ? PASOS_SERVICIO : PASOS;
}

// Money results: the order was paid, so a refund or none.
export const RESULTADOS_CON_REEMBOLSO: ResultadoDisputa[] = ['reembolso_total', 'reembolso_parcial', 'sin_reembolso'];
// A job never paid: the work is owed or it is not.
export const RESULTADOS_SIN_PAGAR: ResultadoDisputa[] = ['corresponde_pagar', 'no_corresponde_pagar'];
export const TODOS_LOS_RESULTADOS: ResultadoDisputa[] = [...RESULTADOS_CON_REEMBOLSO, ...RESULTADOS_SIN_PAGAR];

export const ETIQUETA_RESULTADO: Record<ResultadoDisputa, string> = {
  reembolso_total: 'Reembolso total',
  reembolso_parcial: 'Reembolso parcial',
  sin_reembolso: 'Sin reembolso',
  corresponde_pagar: 'Corresponde pagar',
  no_corresponde_pagar: 'No corresponde pagar',
};

export function resultadosPosibles(orden: Pick<OrdenParaAcciones, 'tipo' | 'pagada'>): ResultadoDisputa[] {
  return orden.tipo === 'servicio' && !orden.pagada ? [...RESULTADOS_SIN_PAGAR] : [...RESULTADOS_CON_REEMBOLSO];
}

const VENTANA_DISPUTA_MS = 48 * 60 * 60 * 1000;

export type OrdenParaAcciones = {
  tipo: TipoOrden;
  estado: EstadoOrden;
  // Whether the order was ever paid. A job never paid can only be resolved as owed or not owed.
  pagada: boolean;
  entregadaEn: Date | null;
  tieneResena: boolean;
  disputa: {
    estado: 'abierta' | 'resuelta';
    resultado: ResultadoDisputa | null;
    reembolsoMarcado: boolean;
    reembolsoConfirmado: boolean;
  } | null;
  proveedor: 'manual' | 'falso' | 'nwc' | 'blink' | 'btcpay';
};

// Buyer may open a dispute from payment until 48 h after delivery, and only once.
// A job can also be disputed while it is hecha and not yet paid.
function disputaPosible(orden: OrdenParaAcciones, ahora: Date): boolean {
  if (orden.disputa !== null) return false;
  if (orden.estado === 'hecha') return orden.tipo === 'servicio';
  if (orden.estado === 'pagada' || orden.estado === 'lista') return true;
  if (orden.estado === 'entregada' && orden.entregadaEn !== null) {
    return ahora.getTime() - orden.entregadaEn.getTime() <= VENTANA_DISPUTA_MS;
  }
  return false;
}

// Refund steps after a dispute is resolved with a refund. Products and paid jobs share them.
function accionesDeReembolso(orden: OrdenParaAcciones, rol: Rol): Accion[] {
  const acciones: Accion[] = [];
  const disputa = orden.disputa;
  const ordenaReembolso =
    disputa !== null &&
    disputa.estado === 'resuelta' &&
    (disputa.resultado === 'reembolso_total' || disputa.resultado === 'reembolso_parcial');
  if (ordenaReembolso && disputa !== null) {
    // The seller pays outside the app and marks it; the buyer confirms receipt.
    if (rol === 'vendedor' && !disputa.reembolsoMarcado) acciones.push('marcar_reembolso');
    if (rol === 'comprador' && disputa.reembolsoMarcado && !disputa.reembolsoConfirmado) {
      acciones.push('confirmar_reembolso');
    }
  }
  return acciones;
}

export function accionesPosibles(orden: OrdenParaAcciones, rol: Rol, ahora: Date = new Date()): Accion[] {
  return orden.tipo === 'servicio'
    ? accionesDeTrabajo(orden, rol, ahora)
    : accionesDeProducto(orden, rol, ahora);
}

function accionesDeProducto(orden: OrdenParaAcciones, rol: Rol, ahora: Date): Accion[] {
  const acciones: Accion[] = [];
  const comprador = rol === 'comprador';
  const vendedor = rol === 'vendedor';
  const admin = rol === 'admin';

  switch (orden.estado) {
    // The buyer may cancel an order until it is paid; the stock goes back. The seller cannot.
    case 'creada':
      if (comprador) acciones.push('cancelar');
      break;
    case 'esperando_pago':
      if (comprador) acciones.push('pagar', 'cancelar');
      // Only manual payments need the seller to confirm; the others are detected.
      if (vendedor && orden.proveedor === 'manual') acciones.push('confirmar_pago');
      break;
    case 'pagada':
      if (vendedor) acciones.push('marcar_lista');
      break;
    case 'lista':
      if (comprador) acciones.push('marcar_entregada');
      if (vendedor) acciones.push('entregar_con_codigo');
      break;
    case 'entregada':
    case 'cerrada':
      if (comprador && !orden.tieneResena) acciones.push('resenar');
      break;
    case 'disputada':
      if (admin) acciones.push('resolver_disputa');
      break;
    case 'resuelta':
      acciones.push(...accionesDeReembolso(orden, rol));
      break;
    // Jobs only, or nothing left to do: a product order never reaches the first two.
    case 'acordada':
    case 'hecha':
    case 'cancelada':
    case 'expirada':
      break;
  }

  if (comprador && disputaPosible(orden, ahora)) acciones.push('abrir_disputa');
  return acciones;
}

function accionesDeTrabajo(orden: OrdenParaAcciones, rol: Rol, ahora: Date): Accion[] {
  const acciones: Accion[] = [];
  const comprador = rol === 'comprador';
  const vendedor = rol === 'vendedor';
  const admin = rol === 'admin';

  switch (orden.estado) {
    case 'acordada':
      if (vendedor) acciones.push('marcar_hecha');
      if (comprador || vendedor) acciones.push('cancelar');
      break;
    case 'hecha':
      if (comprador) acciones.push('pagar');
      break;
    case 'esperando_pago':
      if (comprador) acciones.push('pagar');
      if (vendedor && orden.proveedor === 'manual') acciones.push('confirmar_pago');
      break;
    case 'entregada':
    case 'cerrada':
      if (comprador && !orden.tieneResena) acciones.push('resenar');
      break;
    case 'disputada':
      if (admin) acciones.push('resolver_disputa');
      break;
    case 'resuelta':
      acciones.push(...accionesDeReembolso(orden, rol));
      break;
    // A job never sits in these: it goes from esperando_pago to entregada in one step.
    case 'pagada':
    case 'lista':
    case 'creada':
    case 'expirada':
    case 'cancelada':
      break;
  }

  if (comprador && disputaPosible(orden, ahora)) acciones.push('abrir_disputa');
  return acciones;
}
