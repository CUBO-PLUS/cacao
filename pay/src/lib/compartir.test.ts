import { describe, expect, it } from 'vitest';

import { baseSitio, enlaceRastreo, enlaceWhatsapp, mensajeRastreo, SITIO_PREDETERMINADO } from './compartir';

describe('baseSitio', () => {
  it('usa la dirección pública cuando es válida', () => {
    expect(baseSitio('https://pay.cacao.sv/')).toBe('https://pay.cacao.sv');
  });

  it('usa la predeterminada cuando falta o está mal escrita', () => {
    expect(baseSitio(undefined)).toBe(SITIO_PREDETERMINADO);
    expect(baseSitio('pay.cacao.sv')).toBe(SITIO_PREDETERMINADO);
    expect(baseSitio('https://pay.cacao.sv/ruta')).toBe(SITIO_PREDETERMINADO);
  });
});

describe('enlaces para compartir', () => {
  it('el enlace de rastreo lleva al código', () => {
    expect(enlaceRastreo('CP-2345-ABCD', 'https://pay.cacao.sv')).toBe('https://pay.cacao.sv/t/CP-2345-ABCD');
  });

  it('el enlace de WhatsApp codifica el texto', () => {
    const enlace = enlaceWhatsapp('Seguí tu envío CP-2345-ABCD: https://x.test/t/CP-2345-ABCD');
    expect(enlace.startsWith('https://wa.me/?text=')).toBe(true);
    expect(enlace).not.toContain(' ');
    expect(decodeURIComponent(enlace.slice('https://wa.me/?text='.length))).toContain('CP-2345-ABCD');
  });

  it('el mensaje incluye el código y el enlace', () => {
    expect(mensajeRastreo('CP-2345-ABCD', 'https://x.test/t/CP-2345-ABCD')).toBe(
      'Seguí tu envío CP-2345-ABCD en CacaoPay: https://x.test/t/CP-2345-ABCD',
    );
  });
});
