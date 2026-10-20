import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  accionesPosibles,
  aUsdCentavos,
  descripcionDeEstado,
  enmascararContacto,
  ETIQUETA_ENTREGA,
  ETIQUETA_ESTADO,
  ETIQUETA_MONEDA,
  esCodigo,
  indicePaso,
  normalizarCodigo,
  normalizarContacto,
  PASOS,
  type EstadoEnvio,
} from './transferencias';

const ORIGINAL_DEMO = process.env.NEXT_PUBLIC_DEMO;

function demo(valor: string | undefined) {
  if (valor === undefined) delete process.env.NEXT_PUBLIC_DEMO;
  else process.env.NEXT_PUBLIC_DEMO = valor;
}

beforeEach(() => demo(undefined));

afterEach(() => {
  demo(ORIGINAL_DEMO);
});

describe('textos de estado', () => {
  it('una etiqueta corta para cada estado', () => {
    expect(ETIQUETA_ESTADO).toEqual({
      creada: 'Sin enviar',
      procesando: 'En camino',
      completada: 'Entregado',
      fallida: 'No se pudo entregar',
      cancelada: 'Cancelado',
    });
  });

  it('la frase para quien envió dice lo que pasa, sin jerga', () => {
    expect(descripcionDeEstado('creada', 'remitente')).toBe('Recibimos tu envío. Todavía no sale.');
    expect(descripcionDeEstado('procesando', 'remitente')).toBe('El dinero va en camino.');
    expect(descripcionDeEstado('completada', 'remitente')).toBe('Tu destinatario ya recibió el dinero.');
  });

  it('la frase para quien recibe habla de ella, no de quien envió', () => {
    expect(descripcionDeEstado('completada', 'destinatario')).toBe('Ya recibiste el dinero.');
    expect(descripcionDeEstado('creada', 'destinatario')).toBe('Alguien te va a mandar dinero. Todavía no sale.');
  });

  it('cada estado tiene una frase para cada rol, sin signos de exclamación ni guiones largos', () => {
    const estados: EstadoEnvio[] = ['creada', 'procesando', 'completada', 'fallida', 'cancelada'];
    for (const estado of estados) {
      for (const rol of ['remitente', 'destinatario'] as const) {
        const frase = descripcionDeEstado(estado, rol);
        expect(frase.length).toBeGreaterThan(10);
        expect(frase).not.toMatch(/[!¡—–]/);
      }
    }
  });

  it('las etiquetas de entrega y de moneda están en español de El Salvador', () => {
    expect(ETIQUETA_ENTREGA.efectivo).toBe('Efectivo en un punto de pago');
    expect(ETIQUETA_ENTREGA.cuenta).toBe('Depósito a cuenta bancaria');
    expect(ETIQUETA_MONEDA.USD).toBe('Dólares');
  });
});

describe('línea de tiempo', () => {
  it('tres pasos en orden', () => {
    expect(PASOS.map((p) => p.estado)).toEqual(['creada', 'procesando', 'completada']);
  });

  it('un envío fallido o cancelado no está en la línea de tiempo', () => {
    expect(indicePaso('creada')).toBe(0);
    expect(indicePaso('procesando')).toBe(1);
    expect(indicePaso('completada')).toBe(2);
    expect(indicePaso('fallida')).toBe(-1);
    expect(indicePaso('cancelada')).toBe(-1);
  });
});

describe('acciones por rol y estado', () => {
  it('quien envía confirma o cancela antes de que salga', () => {
    expect(accionesPosibles('creada', 'remitente')).toEqual(['procesar', 'cancelar']);
    expect(accionesPosibles('procesando', 'remitente')).toEqual([]);
    expect(accionesPosibles('completada', 'remitente')).toEqual([]);
  });

  it('quien recibe nunca actúa sobre el envío', () => {
    const estados: EstadoEnvio[] = ['creada', 'procesando', 'completada', 'fallida', 'cancelada'];
    for (const estado of estados) {
      expect(accionesPosibles(estado, 'destinatario')).toEqual([]);
    }
  });

  it('el administrador mueve el envío y lo completa o lo falla', () => {
    expect(accionesPosibles('creada', 'admin')).toEqual(['procesar', 'fallar']);
    expect(accionesPosibles('procesando', 'admin')).toEqual(['completar', 'fallar']);
    expect(accionesPosibles('fallida', 'admin')).toEqual([]);
    expect(accionesPosibles('cancelada', 'admin')).toEqual([]);
  });

  it('el simulador agrega completar y fallar para quien envía, solo en la demo', () => {
    demo('1');
    expect(accionesPosibles('creada', 'remitente')).toEqual(['procesar', 'cancelar', 'fallar']);
    expect(accionesPosibles('procesando', 'remitente')).toEqual(['completar', 'fallar']);
    demo('0');
    expect(accionesPosibles('procesando', 'remitente')).toEqual([]);
  });
});

describe('códigos de envío', () => {
  it('acepta minúsculas, espacios y guiones que faltan', () => {
    expect(normalizarCodigo('cp2345abcd')).toBe('CP-2345-ABCD');
    expect(normalizarCodigo(' cp 2345-abcd ')).toBe('CP-2345-ABCD');
    expect(normalizarCodigo('CP-2345-ABCD')).toBe('CP-2345-ABCD');
  });

  it('reconoce un código bien escrito y rechaza los que no', () => {
    expect(esCodigo('CP-2345-ABCD')).toBe(true);
    expect(esCodigo('cp23 45ab cd')).toBe(true);
    // Look-alikes (0, 1, I, O) never appear in a code.
    expect(esCodigo('CP-0OI1-2345')).toBe(false);
    expect(esCodigo('CP-2345-ABC')).toBe(false);
    expect(esCodigo('XX-2345-ABCD')).toBe(false);
    expect(esCodigo('')).toBe(false);
  });
});

describe('contactos', () => {
  it('un celular de 8 dígitos, con o sin +503, queda como +503 xxxx xxxx', () => {
    expect(normalizarContacto('7000 0002')).toEqual({ tipo: 'telefono', valor: '+503 7000 0002' });
    expect(normalizarContacto('+503 7000-0002')).toEqual({ tipo: 'telefono', valor: '+503 7000 0002' });
    expect(normalizarContacto('50370000002')).toEqual({ tipo: 'telefono', valor: '+503 7000 0002' });
  });

  it('un correo queda en minúsculas', () => {
    expect(normalizarContacto(' Marta@Gmail.com ')).toEqual({ tipo: 'correo', valor: 'marta@gmail.com' });
  });

  it('rechaza números que no son de El Salvador y correos sin forma de correo', () => {
    expect(normalizarContacto('700002')).toBeNull();
    expect(normalizarContacto('+1 555 123 4567')).toBeNull();
    expect(normalizarContacto('marta@gmail')).toBeNull();
    expect(normalizarContacto('abc')).toBeNull();
  });

  it('enmascara el teléfono y el correo', () => {
    expect(enmascararContacto('+503 7000 0007')).toBe('•••• ••07');
    expect(enmascararContacto('marta@gmail.com')).toBe('ma•••@gmail.com');
    expect(enmascararContacto('m@x.sv')).toBe('m•••@x.sv');
  });
});

describe('cancelar un envío', () => {
  it('se puede cancelar mientras no hay factura vigente ni pago', () => {
    expect(accionesPosibles('creada', 'remitente', 'lightning', { pagada: false, facturaViva: false })).toEqual([
      'procesar',
      'cancelar',
    ]);
  });

  it('no se ofrece con una factura Lightning vigente o con el pago hecho', () => {
    expect(accionesPosibles('creada', 'remitente', 'lightning', { facturaViva: true })).toEqual(['procesar']);
    expect(accionesPosibles('creada', 'remitente', 'lightning', { pagada: true })).toEqual(['procesar']);
  });

  it('un envío por Lightning nunca ofrece completar a mano, ni en la demo', () => {
    expect(accionesPosibles('procesando', 'remitente', 'lightning')).toEqual([]);
    expect(accionesPosibles('procesando', 'admin', 'lightning')).toEqual(['fallar']);
  });
});

describe('montos en dólares', () => {
  it('un monto en dólares no cambia', () => {
    expect(aUsdCentavos(9_999, 'USD', 1.08)).toBe(9_999);
  });

  it('un monto en euros se pasa a centavos de dólar, redondeado hacia abajo', () => {
    expect(aUsdCentavos(10_000, 'EUR', 1.08)).toBe(10_800);
    expect(aUsdCentavos(9_259, 'EUR', 1.08)).toBe(9_999);
  });
});
