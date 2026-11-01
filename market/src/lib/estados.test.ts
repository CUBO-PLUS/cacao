import { describe, expect, it } from 'vitest';
import {
  accionesPosibles,
  descripcionDeEstado,
  DESCRIPCION_ESTADO,
  ETIQUETA_ESTADO,
  ETIQUETA_RESULTADO,
  PASOS,
  PASOS_SERVICIO,
  pasosDe,
  resultadosPosibles,
  TODOS_LOS_RESULTADOS,
  type Accion,
  type EstadoOrden,
  type OrdenParaAcciones,
  type ResultadoDisputa,
  type Rol,
} from './estados';

const HORA = 60 * 60 * 1000;
const ENTREGA = new Date('2026-10-10T12:00:00Z');

function orden(parche: Partial<OrdenParaAcciones> = {}): OrdenParaAcciones {
  return {
    tipo: 'productos',
    pagada: true,
    estado: 'pagada',
    entregadaEn: null,
    tieneResena: false,
    disputa: null,
    proveedor: 'manual',
    ...parche,
  };
}

// Sorted so the tests compare sets, not order.
function ver(o: OrdenParaAcciones, rol: Rol, ahora?: Date): Accion[] {
  return [...accionesPosibles(o, rol, ahora)].sort();
}

const AHORA = new Date('2026-10-12T12:00:00Z');

describe('accionesPosibles, transition table', () => {
  it('creada: the buyer may cancel while the system registers the order; nobody else acts', () => {
    expect(ver(orden({ estado: 'creada' }), 'comprador', AHORA)).toEqual(['cancelar']);
    expect(ver(orden({ estado: 'creada' }), 'vendedor', AHORA)).toEqual([]);
    expect(ver(orden({ estado: 'creada' }), 'admin', AHORA)).toEqual([]);
  });

  it('esperando_pago: the buyer pays or cancels', () => {
    expect(ver(orden({ estado: 'esperando_pago' }), 'comprador', AHORA)).toEqual(['cancelar', 'pagar']);
  });

  it('esperando_pago: the seller confirms by hand only for the manual provider', () => {
    const manual = orden({ estado: 'esperando_pago', proveedor: 'manual' });
    expect(ver(manual, 'vendedor', AHORA)).toEqual(['confirmar_pago']);

    for (const proveedor of ['falso', 'nwc', 'blink'] as const) {
      expect(ver(orden({ estado: 'esperando_pago', proveedor }), 'vendedor', AHORA)).toEqual([]);
    }
  });

  it('pagada: the seller marks it ready; the buyer may dispute', () => {
    expect(ver(orden({ estado: 'pagada' }), 'vendedor', AHORA)).toEqual(['marcar_lista']);
    expect(ver(orden({ estado: 'pagada' }), 'comprador', AHORA)).toEqual(['abrir_disputa']);
  });

  it('lista: the buyer marks it delivered, the seller delivers with the code, the buyer may dispute', () => {
    expect(ver(orden({ estado: 'lista' }), 'comprador', AHORA)).toEqual(['abrir_disputa', 'marcar_entregada']);
    expect(ver(orden({ estado: 'lista' }), 'vendedor', AHORA)).toEqual(['entregar_con_codigo']);
  });

  it('entregada: the buyer can review and dispute inside the 48 h window', () => {
    const o = orden({ estado: 'entregada', entregadaEn: ENTREGA });
    expect(ver(o, 'comprador', new Date(ENTREGA.getTime() + HORA))).toEqual(['abrir_disputa', 'resenar']);
  });

  it('entregada: the dispute window closes at exactly 48 h and not after', () => {
    const o = orden({ estado: 'entregada', entregadaEn: ENTREGA });
    const justoEn48 = new Date(ENTREGA.getTime() + 48 * HORA);
    const unMsDespues = new Date(ENTREGA.getTime() + 48 * HORA + 1);
    expect(ver(o, 'comprador', justoEn48)).toContain('abrir_disputa');
    expect(ver(o, 'comprador', unMsDespues)).toEqual(['resenar']);
  });

  it('entregada: no dispute when the delivery time is unknown', () => {
    const o = orden({ estado: 'entregada', entregadaEn: null });
    expect(ver(o, 'comprador', AHORA)).toEqual(['resenar']);
  });

  it('entregada with a review: the buyer can still dispute, but not review again', () => {
    const o = orden({ estado: 'entregada', entregadaEn: ENTREGA, tieneResena: true });
    expect(ver(o, 'comprador', new Date(ENTREGA.getTime() + HORA))).toEqual(['abrir_disputa']);
  });

  it('cerrada: the buyer reviews when there is no review yet', () => {
    expect(ver(orden({ estado: 'cerrada', entregadaEn: ENTREGA }), 'comprador', AHORA)).toEqual(['resenar']);
  });

  it('cerrada with a review: nothing left to do', () => {
    expect(ver(orden({ estado: 'cerrada', entregadaEn: ENTREGA, tieneResena: true }), 'comprador', AHORA)).toEqual([]);
  });

  it('cerrada: no dispute, even inside the window', () => {
    const o = orden({ estado: 'cerrada', entregadaEn: ENTREGA });
    expect(ver(o, 'comprador', new Date(ENTREGA.getTime() + HORA))).not.toContain('abrir_disputa');
  });

  it('expirada: nothing for anyone', () => {
    for (const rol of ['comprador', 'vendedor', 'admin'] as Rol[]) {
      expect(ver(orden({ estado: 'expirada' }), rol, AHORA)).toEqual([]);
    }
  });

  it('cancelada (product): nothing for anyone, and the buyer cannot cancel it again', () => {
    for (const rol of ['comprador', 'vendedor', 'admin'] as Rol[]) {
      expect(ver(orden({ estado: 'cancelada' }), rol, AHORA)).toEqual([]);
    }
  });

  it('disputada: the admin resolves; the parties wait', () => {
    const o = orden({ estado: 'disputada', disputa: { estado: 'abierta', resultado: null, reembolsoMarcado: false, reembolsoConfirmado: false } });
    expect(ver(o, 'admin', AHORA)).toEqual(['resolver_disputa']);
    expect(ver(o, 'comprador', AHORA)).toEqual([]);
    expect(ver(o, 'vendedor', AHORA)).toEqual([]);
  });

  describe('resuelta', () => {
    const resuelta = (
      resultado: 'reembolso_total' | 'reembolso_parcial' | 'sin_reembolso',
      reembolsoMarcado: boolean,
      reembolsoConfirmado: boolean,
    ) =>
      orden({
        estado: 'resuelta',
        disputa: { estado: 'resuelta', resultado, reembolsoMarcado, reembolsoConfirmado },
      });

    it('refund ordered, not marked: the seller marks it', () => {
      expect(ver(resuelta('reembolso_total', false, false), 'vendedor', AHORA)).toEqual(['marcar_reembolso']);
      expect(ver(resuelta('reembolso_parcial', false, false), 'vendedor', AHORA)).toEqual(['marcar_reembolso']);
      expect(ver(resuelta('reembolso_total', false, false), 'comprador', AHORA)).toEqual([]);
    });

    it('refund marked, not confirmed: the buyer confirms it', () => {
      expect(ver(resuelta('reembolso_total', true, false), 'comprador', AHORA)).toEqual(['confirmar_reembolso']);
      expect(ver(resuelta('reembolso_parcial', true, false), 'comprador', AHORA)).toEqual(['confirmar_reembolso']);
      expect(ver(resuelta('reembolso_total', true, false), 'vendedor', AHORA)).toEqual([]);
    });

    it('refund fully done: nothing left', () => {
      expect(ver(resuelta('reembolso_total', true, true), 'comprador', AHORA)).toEqual([]);
      expect(ver(resuelta('reembolso_total', true, true), 'vendedor', AHORA)).toEqual([]);
    });

    it('no refund ordered: nothing to mark or confirm', () => {
      expect(ver(resuelta('sin_reembolso', false, false), 'vendedor', AHORA)).toEqual([]);
      expect(ver(resuelta('sin_reembolso', false, false), 'comprador', AHORA)).toEqual([]);
    });

    it('the admin gets nothing once resolved', () => {
      expect(ver(resuelta('reembolso_total', false, false), 'admin', AHORA)).toEqual([]);
    });
  });
});

describe('accionesPosibles, roles and guards', () => {
  it('a stranger gets no buyer or seller actions on a dispute they are not part of', () => {
    // Admin only resolves, never pays, marks or disputes.
    for (const estado of ['esperando_pago', 'pagada', 'lista', 'entregada', 'cerrada'] as EstadoOrden[]) {
      expect(ver(orden({ estado, entregadaEn: ENTREGA }), 'admin', AHORA)).toEqual([]);
    }
  });

  it('a seller never gets buyer actions', () => {
    const buyerOnly = [
      'pagar',
      'cancelar',
      'marcar_entregada',
      'resenar',
      'abrir_disputa',
      'confirmar_reembolso',
    ] as Accion[];
    for (const estado of ['esperando_pago', 'pagada', 'lista', 'entregada', 'cerrada'] as EstadoOrden[]) {
      const acciones = ver(orden({ estado, entregadaEn: ENTREGA, proveedor: 'manual' }), 'vendedor', AHORA);
      for (const accion of buyerOnly) expect(acciones).not.toContain(accion);
    }
  });

  it('a buyer never gets seller actions', () => {
    const sellerOnly = [
      'confirmar_pago',
      'marcar_lista',
      'entregar_con_codigo',
      'marcar_reembolso',
    ] as Accion[];
    for (const estado of ['esperando_pago', 'pagada', 'lista', 'resuelta'] as EstadoOrden[]) {
      const disputa =
        estado === 'resuelta'
          ? { estado: 'resuelta' as const, resultado: 'reembolso_total' as const, reembolsoMarcado: false, reembolsoConfirmado: false }
          : null;
      const acciones = ver(orden({ estado, disputa, proveedor: 'manual' }), 'comprador', AHORA);
      for (const accion of sellerOnly) expect(acciones).not.toContain(accion);
    }
  });

  it('nobody can open a second dispute', () => {
    const conDisputa = orden({
      estado: 'pagada',
      disputa: { estado: 'abierta', resultado: null, reembolsoMarcado: false, reembolsoConfirmado: false },
    });
    expect(ver(conDisputa, 'comprador', AHORA)).not.toContain('abrir_disputa');
  });
});

describe('demo sellers: the buyer may simulate a pickup delivery', () => {
  it('a demo pickup order that is paid or ready offers the simulation to the buyer only', () => {
    expect(accionesPosibles(orden({ demo: true, estado: 'pagada' }), 'comprador')).toContain('simular_entrega');
    expect(accionesPosibles(orden({ demo: true, estado: 'lista' }), 'comprador')).toContain('simular_entrega');
    expect(accionesPosibles(orden({ demo: true, estado: 'pagada' }), 'vendedor')).not.toContain('simular_entrega');
    expect(accionesPosibles(orden({ demo: true, estado: 'lista' }), 'vendedor')).not.toContain('simular_entrega');
  });

  it('a real seller never gets the simulation, paid or ready', () => {
    expect(accionesPosibles(orden({ demo: false, estado: 'pagada' }), 'comprador')).not.toContain('simular_entrega');
    expect(accionesPosibles(orden({ estado: 'lista' }), 'comprador')).not.toContain('simular_entrega');
  });

  it('the simulation is offered only before delivery, never on a job', () => {
    expect(accionesPosibles(orden({ demo: true, estado: 'creada', pagada: false }), 'comprador')).not.toContain('simular_entrega');
    expect(accionesPosibles(orden({ demo: true, estado: 'entregada' }), 'comprador')).not.toContain('simular_entrega');
    expect(accionesPosibles(orden({ demo: true, tipo: 'servicio', estado: 'pagada' }), 'comprador')).not.toContain('simular_entrega');
  });
});

describe('product orders: buyer cancellation before payment', () => {
  it('the buyer cancels while creada or esperando_pago, and never once paid', () => {
    for (const estado of ['creada', 'esperando_pago'] as EstadoOrden[]) {
      expect(ver(orden({ estado, pagada: false }), 'comprador', AHORA)).toContain('cancelar');
      expect(ver(orden({ estado, pagada: false }), 'vendedor', AHORA)).not.toContain('cancelar');
    }
    for (const estado of ['pagada', 'lista', 'entregada', 'cerrada', 'disputada', 'resuelta'] as EstadoOrden[]) {
      expect(ver(orden({ estado }), 'comprador', AHORA)).not.toContain('cancelar');
    }
  });

  it('a manual payment does not change the cancellation: the buyer may still cancel', () => {
    expect(ver(orden({ estado: 'esperando_pago', proveedor: 'manual' }), 'comprador', AHORA)).toContain('cancelar');
    expect(ver(orden({ estado: 'esperando_pago', proveedor: 'falso' }), 'comprador', AHORA)).toContain('cancelar');
  });

  it('the seller reads the cancelled product sentence: the buyer cancelled before paying', () => {
    expect(descripcionDeEstado('cancelada', 'comprador', 'productos')).toBe(
      'Cancelaste este pedido. Los productos volvieron al inventario.',
    );
    expect(descripcionDeEstado('cancelada', 'vendedor', 'productos')).toBe(
      'El comprador canceló este pedido antes de pagar.',
    );
  });

  it('a cancelled job keeps the job sentence for both parties', () => {
    expect(descripcionDeEstado('cancelada', 'comprador', 'servicio')).toBe(
      'El trabajo se canceló. Revisá el motivo en la orden.',
    );
    expect(descripcionDeEstado('cancelada', 'vendedor', 'servicio')).toBe(
      'El trabajo se canceló. Revisá el motivo en la orden.',
    );
  });

  it('a job keeps its cancel rules: either party while agreed, the buyer never cancels a paid product', () => {
    const trabajo = orden({ tipo: 'servicio', pagada: false, estado: 'acordada' });
    expect(ver(trabajo, 'comprador', AHORA)).toEqual(['cancelar']);
    expect(ver(trabajo, 'vendedor', AHORA)).toEqual(['cancelar', 'marcar_hecha']);
  });
});

describe('estados labels and steps', () => {
  it('every state has a Spanish label and two descriptions', () => {
    const estados: EstadoOrden[] = [
      'creada', 'esperando_pago', 'pagada', 'lista', 'entregada', 'cerrada', 'expirada', 'disputada', 'resuelta',
      'acordada', 'hecha', 'cancelada',
    ];
    for (const estado of estados) {
      expect(ETIQUETA_ESTADO[estado]).toBeTruthy();
      expect(DESCRIPCION_ESTADO[estado].comprador).toBeTruthy();
      expect(DESCRIPCION_ESTADO[estado].vendedor).toBeTruthy();
    }
    expect(ETIQUETA_ESTADO.disputada).toBe('En disputa');
    expect(ETIQUETA_ESTADO.esperando_pago).toBe('Esperando pago');
    expect(ETIQUETA_ESTADO.acordada).toBe('Acordada');
    expect(ETIQUETA_ESTADO.hecha).toBe('Trabajo hecho');
    expect(ETIQUETA_ESTADO.cancelada).toBe('Cancelada');
  });

  it('PASOS is the happy path in order', () => {
    expect(PASOS).toEqual(['esperando_pago', 'pagada', 'lista', 'entregada', 'cerrada']);
  });

  it('PASOS_SERVICIO is the job path, and pasosDe picks the right one', () => {
    expect(PASOS_SERVICIO).toEqual(['acordada', 'hecha', 'esperando_pago', 'entregada', 'cerrada']);
    expect(pasosDe('servicio')).toEqual(PASOS_SERVICIO);
    expect(pasosDe('productos')).toEqual(PASOS);
  });

  it('no description uses an em or en dash, and none shouts with an exclamation mark', () => {
    const textos = [
      ...Object.values(DESCRIPCION_ESTADO).flatMap((d) => [d.comprador, d.vendedor]),
      ...(['esperando_pago', 'entregada', 'cerrada'] as EstadoOrden[]).flatMap((e) => [
        descripcionDeEstado(e, 'comprador', 'servicio'),
        descripcionDeEstado(e, 'vendedor', 'servicio'),
      ]),
    ];
    for (const texto of textos) {
      expect(texto).not.toMatch(new RegExp('[' + String.fromCharCode(8211, 8212) + ']'));
      expect(texto).not.toContain('!');
    }
  });
});

describe('jobs (tipo servicio): transition table', () => {
  const trabajo = (parche: Partial<OrdenParaAcciones> = {}) => orden({ tipo: 'servicio', pagada: false, ...parche });

  it('acordada: the provider marks it done; either party may cancel; nobody disputes or reviews', () => {
    const o = trabajo({ estado: 'acordada' });
    expect(ver(o, 'vendedor', AHORA)).toEqual(['cancelar', 'marcar_hecha']);
    expect(ver(o, 'comprador', AHORA)).toEqual(['cancelar']);
    expect(ver(o, 'admin', AHORA)).toEqual([]);
  });

  it('hecha: the client pays or disputes; the provider only waits', () => {
    const o = trabajo({ estado: 'hecha' });
    expect(ver(o, 'comprador', AHORA)).toEqual(['abrir_disputa', 'pagar']);
    expect(ver(o, 'vendedor', AHORA)).toEqual([]);
    expect(ver(o, 'admin', AHORA)).toEqual([]);
  });

  it('hecha: no cancel and no mark-done, even for the provider', () => {
    const o = trabajo({ estado: 'hecha' });
    expect(ver(o, 'vendedor', AHORA)).not.toContain('cancelar');
    expect(ver(o, 'vendedor', AHORA)).not.toContain('marcar_hecha');
    expect(ver(o, 'comprador', AHORA)).not.toContain('cancelar');
  });

  it('esperando_pago: the client pays; the provider confirms only for the manual provider', () => {
    expect(ver(trabajo({ estado: 'esperando_pago' }), 'comprador', AHORA)).toEqual(['pagar']);
    expect(ver(trabajo({ estado: 'esperando_pago', proveedor: 'manual' }), 'vendedor', AHORA)).toEqual(['confirmar_pago']);
    for (const proveedor of ['falso', 'nwc', 'blink'] as const) {
      expect(ver(trabajo({ estado: 'esperando_pago', proveedor }), 'vendedor', AHORA)).toEqual([]);
    }
  });

  it('esperando_pago: no dispute, a job is never disputed while the invoice is open', () => {
    expect(ver(trabajo({ estado: 'esperando_pago' }), 'comprador', AHORA)).not.toContain('abrir_disputa');
  });

  it('entregada: the client reviews and disputes inside 48 h after payment, then only reviews', () => {
    const o = trabajo({ estado: 'entregada', entregadaEn: ENTREGA, pagada: true });
    expect(ver(o, 'comprador', new Date(ENTREGA.getTime() + HORA))).toEqual(['abrir_disputa', 'resenar']);
    expect(ver(o, 'comprador', new Date(ENTREGA.getTime() + 48 * HORA))).toContain('abrir_disputa');
    expect(ver(o, 'comprador', new Date(ENTREGA.getTime() + 48 * HORA + 1))).toEqual(['resenar']);
  });

  it('entregada with a review: the client can still dispute inside the window', () => {
    const o = trabajo({ estado: 'entregada', entregadaEn: ENTREGA, tieneResena: true, pagada: true });
    expect(ver(o, 'comprador', new Date(ENTREGA.getTime() + HORA))).toEqual(['abrir_disputa']);
  });

  it('entregada: the provider has nothing to do', () => {
    expect(ver(trabajo({ estado: 'entregada', entregadaEn: ENTREGA, pagada: true }), 'vendedor', AHORA)).toEqual([]);
  });

  it('cerrada: the client reviews once; no dispute', () => {
    const o = trabajo({ estado: 'cerrada', entregadaEn: ENTREGA, pagada: true });
    expect(ver(o, 'comprador', AHORA)).toEqual(['resenar']);
    expect(ver(trabajo({ estado: 'cerrada', entregadaEn: ENTREGA, pagada: true, tieneResena: true }), 'comprador', AHORA)).toEqual([]);
  });

  it('cancelada: nothing for anyone', () => {
    for (const rol of ['comprador', 'vendedor', 'admin'] as Rol[]) {
      expect(ver(trabajo({ estado: 'cancelada' }), rol, AHORA)).toEqual([]);
    }
  });

  it('disputada: the admin resolves; the parties wait', () => {
    const o = trabajo({ estado: 'disputada', disputa: { estado: 'abierta', resultado: null, reembolsoMarcado: false, reembolsoConfirmado: false } });
    expect(ver(o, 'admin', AHORA)).toEqual(['resolver_disputa']);
    expect(ver(o, 'comprador', AHORA)).toEqual([]);
    expect(ver(o, 'vendedor', AHORA)).toEqual([]);
  });

  it('a paid dispute resolved with a refund marks the refund like a product', () => {
    const resuelta = (resultado: ResultadoDisputa, reembolsoMarcado: boolean, reembolsoConfirmado: boolean) =>
      trabajo({
        estado: 'resuelta',
        pagada: true,
        disputa: { estado: 'resuelta', resultado, reembolsoMarcado, reembolsoConfirmado },
      });
    expect(ver(resuelta('reembolso_total', false, false), 'vendedor', AHORA)).toEqual(['marcar_reembolso']);
    expect(ver(resuelta('reembolso_parcial', true, false), 'comprador', AHORA)).toEqual(['confirmar_reembolso']);
    expect(ver(resuelta('sin_reembolso', false, false), 'vendedor', AHORA)).toEqual([]);
  });

  it('never offers product actions', () => {
    const productos: Accion[] = ['marcar_lista', 'marcar_entregada', 'entregar_con_codigo'];
    for (const estado of ['acordada', 'hecha', 'esperando_pago', 'entregada', 'cerrada', 'cancelada'] as EstadoOrden[]) {
      for (const rol of ['comprador', 'vendedor'] as Rol[]) {
        const acciones = ver(trabajo({ estado, proveedor: 'manual', entregadaEn: ENTREGA, pagada: true }), rol, AHORA);
        for (const accion of productos) expect(acciones).not.toContain(accion);
      }
    }
  });

  it('a job never offers a dispute at acordada', () => {
    expect(ver(trabajo({ estado: 'acordada' }), 'comprador', AHORA)).not.toContain('abrir_disputa');
  });

  it('a stranger has no job action', () => {
    expect(ver(trabajo({ estado: 'acordada' }), 'admin', AHORA)).not.toContain('cancelar');
    expect(ver(trabajo({ estado: 'hecha' }), 'admin', AHORA)).not.toContain('pagar');
  });
});

describe('jobs: descriptions', () => {
  it('the same state reads differently for a job', () => {
    expect(descripcionDeEstado('esperando_pago', 'comprador', 'servicio')).toBe('Pagá el trabajo. El monto en sats ya está fijado.');
    expect(descripcionDeEstado('esperando_pago', 'vendedor', 'servicio')).toBe('El cliente está pagando.');
    expect(descripcionDeEstado('entregada', 'comprador', 'servicio')).toBe('Pagaste. Podés dejar una reseña.');
    expect(descripcionDeEstado('entregada', 'vendedor', 'servicio')).toBe('Te pagaron. El trabajo quedó terminado.');
  });

  it('a job state without its own wording falls back to the product one', () => {
    expect(descripcionDeEstado('disputada', 'comprador', 'servicio')).toBe(DESCRIPCION_ESTADO.disputada.comprador);
  });

  it('products keep their wording', () => {
    for (const estado of Object.keys(DESCRIPCION_ESTADO) as EstadoOrden[]) {
      for (const rol of ['comprador', 'vendedor'] as const) {
        expect(descripcionDeEstado(estado, rol, 'productos')).toBe(DESCRIPCION_ESTADO[estado][rol]);
      }
    }
  });

  it('every job state has wording for both parties', () => {
    for (const estado of PASOS_SERVICIO.concat(['cancelada'])) {
      for (const rol of ['comprador', 'vendedor'] as const) {
        expect(descripcionDeEstado(estado, rol, 'servicio')).toBeTruthy();
      }
    }
  });
});

describe('dispute results', () => {
  it('product orders keep the three money results', () => {
    expect(resultadosPosibles(orden({ tipo: 'productos', pagada: true }))).toEqual([
      'reembolso_total',
      'reembolso_parcial',
      'sin_reembolso',
    ]);
    expect(resultadosPosibles(orden({ tipo: 'productos', pagada: false }))).toEqual([
      'reembolso_total',
      'reembolso_parcial',
      'sin_reembolso',
    ]);
  });

  it('an unpaid job only offers owed or not owed', () => {
    expect(resultadosPosibles(orden({ tipo: 'servicio', pagada: false }))).toEqual(['corresponde_pagar', 'no_corresponde_pagar']);
  });

  it('a paid job keeps the money results', () => {
    expect(resultadosPosibles(orden({ tipo: 'servicio', pagada: true }))).toEqual([
      'reembolso_total',
      'reembolso_parcial',
      'sin_reembolso',
    ]);
  });

  it('every result has a Spanish label, and the list covers all five', () => {
    expect(ETIQUETA_RESULTADO.corresponde_pagar).toBe('Corresponde pagar');
    expect(ETIQUETA_RESULTADO.no_corresponde_pagar).toBe('No corresponde pagar');
    expect(ETIQUETA_RESULTADO.reembolso_total).toBe('Reembolso total');
    expect(TODOS_LOS_RESULTADOS).toHaveLength(5);
    for (const r of TODOS_LOS_RESULTADOS) expect(ETIQUETA_RESULTADO[r]).toBeTruthy();
  });
});
