import { describe, expect, it } from 'vitest';
import { satsParaFactura } from './lightning';

describe('satsParaFactura', () => {
  it('turns US cents into sats at the BTC price', () => {
    // $100.00 at $100,000 per BTC is 0.001 BTC.
    expect(satsParaFactura(10_000, 100_000)).toBe(100_000);
  });

  it('rounds up, so the invoice never asks for less than the amount', () => {
    // 1e8 / 97123.45 is between 1029 and 1030 sats.
    expect(satsParaFactura(100, 97_123.45)).toBe(1030);
  });

  it('does not add a sat when the amount is exact', () => {
    expect(satsParaFactura(10_000, 50_000)).toBe(200_000);
  });

  it('gives at least one sat for the smallest amount', () => {
    expect(satsParaFactura(1, 100_000)).toBe(10);
  });

  it('refuses amounts and prices that are not positive numbers', () => {
    expect(() => satsParaFactura(0, 100_000)).toThrow();
    expect(() => satsParaFactura(10.5, 100_000)).toThrow();
    expect(() => satsParaFactura(10_000, 0)).toThrow();
    expect(() => satsParaFactura(10_000, Number.NaN)).toThrow();
  });
});
