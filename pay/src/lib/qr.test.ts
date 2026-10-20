import { describe, expect, it } from 'vitest';

import { matrizQr } from './qr';

describe('matrizQr', () => {
  it('da un lado válido de código QR, con módulos oscuros', () => {
    const { tamano, d } = matrizQr('https://cacao-pay.vercel.app/t/CP-2345-ABCD');
    // QR codes have sides of 21 + 4 * (version - 1) modules.
    expect(tamano).toBeGreaterThanOrEqual(21);
    expect((tamano - 21) % 4).toBe(0);
    expect(d.startsWith('M')).toBe(true);
  });

  it('es determinista: el mismo texto da la misma matriz', () => {
    expect(matrizQr('CP-2345-ABCD')).toEqual(matrizQr('CP-2345-ABCD'));
  });

  it('un texto distinto cambia la matriz', () => {
    expect(matrizQr('CP-2345-ABCD').d).not.toBe(matrizQr('CP-2345-ABCE').d);
  });
});
