import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { firmaValida, leerAviso } from './btcpay';

const SECRETO = 'secreto-de-prueba';
const CUERPO = JSON.stringify({ type: 'InvoiceSettled', invoiceId: 'FacturaPrueba01', storeId: 'TiendaDePrueba123' });
const firma = (cuerpo: string, secreto = SECRETO) =>
  'sha256=' + createHmac('sha256', secreto).update(cuerpo, 'utf8').digest('hex');

describe('firmaValida', () => {
  it('accepts the HMAC of the raw body', () => {
    expect(firmaValida(CUERPO, firma(CUERPO), SECRETO)).toBe(true);
  });

  it('refuses a missing header, a missing secret and a wrong secret', () => {
    expect(firmaValida(CUERPO, null, SECRETO)).toBe(false);
    expect(firmaValida(CUERPO, firma(CUERPO), '')).toBe(false);
    expect(firmaValida(CUERPO, firma(CUERPO, 'otro'), SECRETO)).toBe(false);
  });

  it('refuses a body changed after signing', () => {
    const cambiado = CUERPO.replace('FacturaPrueba01', 'FacturaPrueba02');
    expect(firmaValida(cambiado, firma(CUERPO), SECRETO)).toBe(false);
  });
});

describe('leerAviso', () => {
  it('reads the fields Cacao uses', () => {
    expect(leerAviso(CUERPO)).toEqual({ tipo: 'InvoiceSettled', facturaId: 'FacturaPrueba01', storeId: 'TiendaDePrueba123' });
  });

  it('refuses a body that is not the expected shape', () => {
    expect(leerAviso('no es json')).toBeNull();
    expect(leerAviso(JSON.stringify({ type: 'InvoiceSettled', invoiceId: 'corto', storeId: 'TiendaDePrueba123' }))).toBeNull();
  });
});
