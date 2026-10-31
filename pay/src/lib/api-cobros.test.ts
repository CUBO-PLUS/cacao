import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  claveCoincide,
  esIpPrivada,
  firmarAviso,
  hashClave,
  huellaCobro,
  leerBearer,
  prefijoDeClave,
  validarClaveIdempotencia,
  validarCuerpoCobro,
  validarUrlAviso,
  verificarFirmaAviso,
} from './api-cobros';

const CLAVE = 'cp_' + 'a'.repeat(32);
const PRODUCCION = { desarrollo: false };
const DESARROLLO = { desarrollo: true };

function cuerpoValido(cambios: Record<string, unknown> = {}) {
  return {
    monto: 1500,
    moneda: 'USD',
    descripcion: 'Pupusas para la mesa 4',
    referencia: 'pedido-1042',
    ...cambios,
  };
}

describe('leerBearer y prefijo', () => {
  it('lee la clave de un encabezado Bearer bien formado', () => {
    expect(leerBearer(`Bearer ${CLAVE}`)).toBe(CLAVE);
    expect(leerBearer(`bearer ${CLAVE}`)).toBe(CLAVE);
  });

  it('rechaza el encabezado ausente, de otro esquema o con una clave mal formada', () => {
    expect(leerBearer(null)).toBeNull();
    expect(leerBearer(`Basic ${CLAVE}`)).toBeNull();
    expect(leerBearer('Bearer cp_corta')).toBeNull();
    expect(leerBearer(`Bearer ${CLAVE} extra`)).toBeNull();
    expect(leerBearer(`Bearer sk_${'a'.repeat(32)}`)).toBeNull();
  });

  it('el prefijo son los primeros once caracteres', () => {
    expect(prefijoDeClave(CLAVE)).toBe('cp_aaaaaaaa');
  });
});

describe('claveCoincide', () => {
  it('acepta la clave que produjo el hash y rechaza cualquier otra', () => {
    const hash = hashClave(CLAVE);
    expect(hash).toBe(createHash('sha256').update(CLAVE).digest('hex'));
    expect(claveCoincide(CLAVE, hash)).toBe(true);
    expect(claveCoincide(CLAVE + 'x', hash)).toBe(false);
    expect(claveCoincide(`cp_${'b'.repeat(32)}`, hash)).toBe(false);
  });

  it('rechaza un hash guardado que no tiene el formato del hash', () => {
    expect(claveCoincide(CLAVE, 'no-es-un-hash')).toBe(false);
    expect(claveCoincide(CLAVE, '0'.repeat(64))).toBe(false);
  });
});

describe('validarCuerpoCobro', () => {
  it('acepta un cobro en USD con los valores por defecto', () => {
    const r = validarCuerpoCobro(cuerpoValido(), PRODUCCION);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.dato.vence_en_segundos).toBe(3600);
      expect(r.dato.tienda).toBeNull();
      expect(r.dato.aviso_url).toBeNull();
    }
  });

  it('acepta un cobro en sats con su tienda y su plazo', () => {
    const r = validarCuerpoCobro(
      cuerpoValido({ moneda: 'SATS', monto: 50_000, tienda: 'ABCDEFGHIJ1234', vence_en_segundos: 900 }),
      PRODUCCION,
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.dato.tienda).toBe('ABCDEFGHIJ1234');
      expect(r.dato.vence_en_segundos).toBe(900);
    }
  });

  it('rechaza un campo que la API no conoce, para que un error de escritura no cambie el cobro', () => {
    const r = validarCuerpoCobro(cuerpoValido({ montoo: 5 }), PRODUCCION);
    expect(r.ok).toBe(false);
  });

  it('rechaza montos fuera de rango, decimales y monedas no soportadas', () => {
    expect(validarCuerpoCobro(cuerpoValido({ monto: 99 }), PRODUCCION).ok).toBe(false);
    expect(validarCuerpoCobro(cuerpoValido({ monto: 1_000_001 }), PRODUCCION).ok).toBe(false);
    expect(validarCuerpoCobro(cuerpoValido({ monto: 12.5 }), PRODUCCION).ok).toBe(false);
    expect(validarCuerpoCobro(cuerpoValido({ monto: '1500' }), PRODUCCION).ok).toBe(false);
    expect(validarCuerpoCobro(cuerpoValido({ moneda: 'EUR' }), PRODUCCION).ok).toBe(false);
    expect(validarCuerpoCobro(cuerpoValido({ moneda: 'SATS', monto: 0 }), PRODUCCION).ok).toBe(false);
  });

  it('rechaza textos vacíos o demasiado largos', () => {
    expect(validarCuerpoCobro(cuerpoValido({ descripcion: '   ' }), PRODUCCION).ok).toBe(false);
    expect(validarCuerpoCobro(cuerpoValido({ descripcion: 'x'.repeat(201) }), PRODUCCION).ok).toBe(false);
    expect(validarCuerpoCobro(cuerpoValido({ referencia: 'x'.repeat(121) }), PRODUCCION).ok).toBe(false);
  });

  it('no acepta un producto en el cuerpo: el producto lo fija el cliente, no la petición', () => {
    for (const producto of ['market', 'negocios', 'tienda']) {
      const resultado = validarCuerpoCobro(cuerpoValido({ producto }), PRODUCCION);
      expect(resultado.ok).toBe(false);
      if (!resultado.ok) expect(resultado.mensaje).toContain('"producto"');
    }
  });

  it('rechaza un plazo fuera de 5 minutos a 24 horas', () => {
    expect(validarCuerpoCobro(cuerpoValido({ vence_en_segundos: 299 }), PRODUCCION).ok).toBe(false);
    expect(validarCuerpoCobro(cuerpoValido({ vence_en_segundos: 86401 }), PRODUCCION).ok).toBe(false);
    expect(validarCuerpoCobro(cuerpoValido({ vence_en_segundos: 300 }), PRODUCCION).ok).toBe(true);
  });

  it('rechaza un cuerpo que no es un objeto', () => {
    expect(validarCuerpoCobro([], PRODUCCION).ok).toBe(false);
    expect(validarCuerpoCobro('texto', PRODUCCION).ok).toBe(false);
    expect(validarCuerpoCobro(null, PRODUCCION).ok).toBe(false);
  });

  it('rechaza una tienda con formato raro', () => {
    expect(validarCuerpoCobro(cuerpoValido({ tienda: 'corta' }), PRODUCCION).ok).toBe(false);
    expect(validarCuerpoCobro(cuerpoValido({ tienda: 'con espacios 1234' }), PRODUCCION).ok).toBe(false);
  });
});

describe('validarClaveIdempotencia', () => {
  it('acepta de 8 a 128 caracteres seguros y rechaza el resto', () => {
    expect(validarClaveIdempotencia('abcd-1234_XY').ok).toBe(true);
    expect(validarClaveIdempotencia('corta').ok).toBe(false);
    expect(validarClaveIdempotencia('con espacios!!').ok).toBe(false);
    expect(validarClaveIdempotencia('a'.repeat(129)).ok).toBe(false);
    expect(validarClaveIdempotencia(null).ok).toBe(false);
  });
});

describe('validarUrlAviso', () => {
  it('acepta https con nombre público', () => {
    const r = validarUrlAviso('https://market.ejemplo.com/cacao/avisos', PRODUCCION);
    expect(r.ok && r.dato).toBe('https://market.ejemplo.com/cacao/avisos');
  });

  it('en producción rechaza http, incluso hacia localhost', () => {
    expect(validarUrlAviso('http://market.ejemplo.com/avisos', PRODUCCION).ok).toBe(false);
    expect(validarUrlAviso('http://localhost:3000/avisos', PRODUCCION).ok).toBe(false);
    expect(validarUrlAviso('https://localhost/avisos', PRODUCCION).ok).toBe(false);
  });

  it('en desarrollo permite http solo hacia localhost', () => {
    expect(validarUrlAviso('http://localhost:3000/avisos', DESARROLLO).ok).toBe(true);
    expect(validarUrlAviso('http://127.0.0.1:3000/avisos', DESARROLLO).ok).toBe(true);
    expect(validarUrlAviso('http://market.ejemplo.com/avisos', DESARROLLO).ok).toBe(false);
  });

  it('rechaza direcciones privadas, internas y de metadatos', () => {
    const malas = [
      'https://10.0.0.5/avisos',
      'https://192.168.1.10/avisos',
      'https://172.20.0.3/avisos',
      'https://169.254.169.254/latest/meta-data',
      'https://[::1]/avisos',
      'https://[fd00::1]/avisos',
      'https://metadata.google.internal/computeMetadata',
      'https://servicio.local/avisos',
      'https://intranet/avisos',
      'https://[::ffff:10.1.2.3]/avisos',
    ];
    for (const url of malas) {
      expect(validarUrlAviso(url, PRODUCCION).ok, url).toBe(false);
    }
  });

  it('rechaza usuario, clave, otros esquemas y direcciones que no son URL', () => {
    expect(validarUrlAviso('https://usuario:clave@market.ejemplo.com/avisos', PRODUCCION).ok).toBe(false);
    expect(validarUrlAviso('ftp://market.ejemplo.com/avisos', PRODUCCION).ok).toBe(false);
    expect(validarUrlAviso('no es una url', PRODUCCION).ok).toBe(false);
    expect(validarUrlAviso('https://market.ejemplo.com/' + 'x'.repeat(500), PRODUCCION).ok).toBe(false);
  });
});

describe('esIpPrivada', () => {
  it('reconoce rangos privados, compartidos y reservados', () => {
    for (const ip of ['10.0.0.1', '127.0.0.1', '100.64.0.1', '169.254.1.1', '172.31.255.255', '192.168.0.1', '198.18.0.1', '224.0.0.1', '0.0.0.0']) {
      expect(esIpPrivada(ip), ip).toBe(true);
    }
  });

  it('deja pasar direcciones públicas cercanas a los rangos privados', () => {
    for (const ip of ['8.8.8.8', '172.15.0.1', '172.32.0.1', '100.63.0.1', '11.0.0.1', '1.1.1.1']) {
      expect(esIpPrivada(ip), ip).toBe(false);
    }
  });
});

describe('firma de los avisos (Cacao-Firma)', () => {
  const SECRETO = 'a'.repeat(64);
  const CUERPO = JSON.stringify({ aviso: 'x', tipo: 'cobro.estado', id: 'y', estado: 'pagado' });
  const AHORA = 1_800_000_000;

  it('una firma recién hecha se verifica con el mismo secreto y cuerpo', () => {
    const cabecera = firmarAviso(SECRETO, CUERPO, AHORA);
    expect(cabecera).toMatch(/^t=1800000000,v1=[0-9a-f]{64}$/);
    expect(verificarFirmaAviso(cabecera, CUERPO, SECRETO, AHORA)).toBe(true);
  });

  it('rechaza un cuerpo alterado, otro secreto o una firma sin el formato', () => {
    const cabecera = firmarAviso(SECRETO, CUERPO, AHORA);
    expect(verificarFirmaAviso(cabecera, CUERPO.replace('pagado', 'cancelado'), SECRETO, AHORA)).toBe(false);
    expect(verificarFirmaAviso(cabecera, CUERPO, 'b'.repeat(64), AHORA)).toBe(false);
    expect(verificarFirmaAviso('t=1800000000', CUERPO, SECRETO, AHORA)).toBe(false);
    expect(verificarFirmaAviso(null, CUERPO, SECRETO, AHORA)).toBe(false);
    expect(verificarFirmaAviso(cabecera, CUERPO, '', AHORA)).toBe(false);
  });

  it('rechaza un aviso repetido fuera de la tolerancia (replay)', () => {
    const cabecera = firmarAviso(SECRETO, CUERPO, AHORA);
    expect(verificarFirmaAviso(cabecera, CUERPO, SECRETO, AHORA + 300)).toBe(true);
    expect(verificarFirmaAviso(cabecera, CUERPO, SECRETO, AHORA + 301)).toBe(false);
    expect(verificarFirmaAviso(cabecera, CUERPO, SECRETO, AHORA - 301)).toBe(false);
  });

  it('no se puede cambiar la hora sin cambiar la firma', () => {
    const cabecera = firmarAviso(SECRETO, CUERPO, AHORA);
    const movida = cabecera.replace(`t=${AHORA}`, `t=${AHORA + 10}`);
    expect(verificarFirmaAviso(movida, CUERPO, SECRETO, AHORA + 10)).toBe(false);
  });
});

describe('huellaCobro', () => {
  it('es la misma para el mismo cobro y cambia con cualquier campo que se cobra', () => {
    const base = validarCuerpoCobro(cuerpoValido(), PRODUCCION);
    if (!base.ok) throw new Error('cuerpo de prueba inválido');
    const h = huellaCobro(base.dato, 'ABCDEFGHIJ1234');
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(huellaCobro(base.dato, 'ABCDEFGHIJ1234')).toBe(h);
    expect(huellaCobro({ ...base.dato, monto: 1501 }, 'ABCDEFGHIJ1234')).not.toBe(h);
    expect(huellaCobro(base.dato, 'OTRATIENDA1234')).not.toBe(h);
  });

  it('los datos entran en la huella: otros datos cambian la huella, y el orden de sus claves no', () => {
    const sinDatos = validarCuerpoCobro(cuerpoValido(), PRODUCCION);
    const conA = validarCuerpoCobro(cuerpoValido({ datos: { a: 1, b: 'x' } }), PRODUCCION);
    const conB = validarCuerpoCobro(cuerpoValido({ datos: { b: 'x', a: 1 } }), PRODUCCION);
    const conOtros = validarCuerpoCobro(cuerpoValido({ datos: { a: 2, b: 'x' } }), PRODUCCION);
    if (!sinDatos.ok || !conA.ok || !conB.ok || !conOtros.ok) throw new Error('cuerpo de prueba inválido');
    const h = huellaCobro(conA.dato, 'ABCDEFGHIJ1234');
    expect(huellaCobro(conB.dato, 'ABCDEFGHIJ1234')).toBe(h);
    expect(huellaCobro(conOtros.dato, 'ABCDEFGHIJ1234')).not.toBe(h);
    expect(huellaCobro(sinDatos.dato, 'ABCDEFGHIJ1234')).not.toBe(h);
  });

  it('sin datos la huella es la de siempre, para que una clave en curso siga coincidiendo', () => {
    const base = validarCuerpoCobro(cuerpoValido(), PRODUCCION);
    if (!base.ok) throw new Error('cuerpo de prueba inválido');
    const antigua = createHash('sha256')
      .update(JSON.stringify([1500, 'USD', 'Pupusas para la mesa 4', 'pedido-1042', 'ABCDEFGHIJ1234', 3600, null]), 'utf8')
      .digest('hex');
    expect(huellaCobro(base.dato, 'ABCDEFGHIJ1234')).toBe(antigua);
  });
});

describe('datos de un cobro', () => {
  it('se aceptan como objeto y se guardan con las claves ordenadas', () => {
    const r = validarCuerpoCobro(cuerpoValido({ datos: { zeta: 1, alfa: { y: true, x: [2, 1] } } }), PRODUCCION);
    expect(r.ok && r.dato.datos).toBe('{"alfa":{"x":[2,1],"y":true},"zeta":1}');
  });

  it('sin datos el campo es null', () => {
    const r = validarCuerpoCobro(cuerpoValido(), PRODUCCION);
    expect(r.ok && r.dato.datos).toBe(null);
  });

  it('se refusan los que no son un objeto, y los de más de 2000 bytes', () => {
    for (const malo of [[1, 2], 'texto', 5]) {
      const r = validarCuerpoCobro(cuerpoValido({ datos: malo }), PRODUCCION);
      expect(r.ok).toBe(false);
    }
    const grande = validarCuerpoCobro(cuerpoValido({ datos: { texto: 'a'.repeat(2000) } }), PRODUCCION);
    expect(grande.ok).toBe(false);
    if (!grande.ok) expect(grande.codigo).toBe('DATOS_INVALIDOS');
    const justo = validarCuerpoCobro(cuerpoValido({ datos: { texto: 'a'.repeat(1978) } }), PRODUCCION);
    expect(justo.ok).toBe(true);
  });
});
