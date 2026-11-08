import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import datosBtcMap from '@/data/negocios.json';
import {
  AVISO_PEDIDO_DEMO,
  avisoDemo,
  CONTACTO_DEMO,
  modoDeEntrega,
  NEGOCIOS_DEMO,
  opcionesDeEntrega,
  proveedorEfectivo,
} from '@/lib/demo';

import { AvisoDemo, AvisoPedidoDemo, EstadoNegocio, EtiquetaCerrado, EtiquetaEjemplo, PieDemo } from './Demo';

// Plain text of a rendered fragment, with the HTML entities React writes decoded.
function texto(html: string): string {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"');
}

describe('aviso de demostración', () => {
  it('is present on the page whenever the seller has a btcmap_id', () => {
    for (const negocio of NEGOCIOS_DEMO) {
      const html = renderToStaticMarkup(createElement(AvisoDemo, { btcmapId: negocio.btcmapId, nombre: negocio.nombre }));
      expect(texto(html)).toContain(avisoDemo(negocio.nombre));
    }
  });

  it('keeps the exact wording of the notice', () => {
    const html = renderToStaticMarkup(createElement(AvisoDemo, { btcmapId: 23673, nombre: 'Alquimia Coffee' }));
    expect(texto(html)).toBe(
      'Alquimia Coffee, negocio real que acepta bitcoin (según BTC Map). Es un ejemplo para la demostración: no participa en CacaoMarket y sus productos y precios son de ejemplo.',
    );
  });

  it('is absent for a normal seller', () => {
    expect(renderToStaticMarkup(createElement(AvisoDemo, { btcmapId: null, nombre: 'Huerta La Ceiba' }))).toBe('');
  });

  it('is shown in the cart and at checkout whenever a demo seller is included', () => {
    const activo = renderToStaticMarkup(createElement(AvisoPedidoDemo, { activo: true }));
    expect(texto(activo)).toBe(
      'Pedido de demostración: se paga con bitcoin de prueba y este negocio no lo recibe.',
    );
    expect(AVISO_PEDIDO_DEMO).toBe(texto(activo));
    expect(renderToStaticMarkup(createElement(AvisoPedidoDemo, { activo: false }))).toBe('');
  });

  it('marks demo sellers with Ejemplo on cards', () => {
    expect(texto(renderToStaticMarkup(createElement(EtiquetaEjemplo, { activo: true })))).toBe('Ejemplo');
    expect(renderToStaticMarkup(createElement(EtiquetaEjemplo, { activo: false }))).toBe('');
  });

  it('gives the removal contact, the BTC Map entry and the attribution on a demo seller page', () => {
    const html = renderToStaticMarkup(createElement(PieDemo, { btcmapId: 18714 }));
    expect(texto(html)).toContain(CONTACTO_DEMO);
    expect(html).toContain('href="https://btcmap.org/merchant/18714"');
    expect(html).toContain('href="https://www.openstreetmap.org/copyright"');
    expect(html).toContain('href="https://aztecasv.com/"');
    expect(renderToStaticMarkup(createElement(PieDemo, { btcmapId: null }))).toBe('');
  });
});

describe('horario y entrega de un vendedor de demostración', () => {
  it('never shows open or closed status for a demo seller, open or not', () => {
    for (const negocio of NEGOCIOS_DEMO) {
      for (const abierto of [true, false]) {
        const estado = renderToStaticMarkup(
          createElement(EstadoNegocio, { btcmapId: negocio.btcmapId, abierto }),
        );
        const cerrado = renderToStaticMarkup(
          createElement(EtiquetaCerrado, { btcmapId: negocio.btcmapId, abierto, texto: 'Cerrado' }),
        );
        expect(estado).toBe('');
        expect(cerrado).toBe('');
      }
    }
  });

  it('still shows the status for a normal seller', () => {
    expect(texto(renderToStaticMarkup(createElement(EstadoNegocio, { btcmapId: null, abierto: true })))).toBe('Abierto ahora');
    expect(texto(renderToStaticMarkup(createElement(EstadoNegocio, { btcmapId: null, abierto: false })))).toBe(
      'Cerrado por ahora',
    );
    expect(texto(renderToStaticMarkup(createElement(EtiquetaCerrado, { btcmapId: null, abierto: false, texto: 'Cerrado' })))).toBe(
      'Cerrado',
    );
  });

  it('offers no delivery choice for a demo seller, so no hand-over is promised', () => {
    expect(opcionesDeEntrega(true)).toEqual([]);
    expect(opcionesDeEntrega(false)).toEqual(['recogida', 'entrega_vendedor']);
    expect(modoDeEntrega(true, 'entrega_vendedor')).toBe('recogida');
    expect(modoDeEntrega(false, 'entrega_vendedor')).toBe('entrega_vendedor');
  });
});

describe('lista de negocios de demostración', () => {
  const porId = new Map(datosBtcMap.lugares.map((l) => [l.id, l]));

  it('has six cafés, six food places and four services', () => {
    const cuenta = (c: string) => NEGOCIOS_DEMO.filter((n) => n.categoria === c).length;
    expect(cuenta('cafe')).toBe(6);
    expect(cuenta('comida')).toBe(6);
    expect(cuenta('servicios')).toBe(4);
  });

  it('matches BTC Map by id, name and type, with a website, checked since 2025', () => {
    const ids = new Set<number>();
    for (const n of NEGOCIOS_DEMO) {
      expect(ids.has(n.btcmapId)).toBe(false);
      ids.add(n.btcmapId);
      const fuente = porId.get(n.btcmapId);
      expect(fuente, `negocio ${n.btcmapId}`).toBeDefined();
      expect(fuente?.nombre).toBe(n.nombre);
      expect(fuente?.categoria).toBe(n.categoria);
      expect(fuente?.web).toBe(n.web);
      expect((fuente?.verificado ?? '') >= '2025-01-01').toBe(true);
    }
  });

  it('leaves out chains and big brands', () => {
    expect(NEGOCIOS_DEMO.some((n) => /selectos|dollar/i.test(n.nombre))).toBe(false);
  });
});

describe('demo sellers never charge a real provider', () => {
  it('uses the simulated provider for a demo seller, even one set to manual with no address', () => {
    expect(proveedorEfectivo('manual', 23673, null)).toBe('falso');
    expect(proveedorEfectivo('btcpay', 1, 'TiendaDePrueba123')).toBe('btcpay');
  });

  it('keeps the shop provider for a normal seller', () => {
    expect(proveedorEfectivo('manual', null, null)).toBe('manual');
    expect(proveedorEfectivo('btcpay', null, 'TiendaDePrueba123')).toBe('btcpay');
  });
});
