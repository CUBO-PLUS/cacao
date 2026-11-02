import { describe, expect, it } from 'vitest';

import { diaLargo } from './periodo';

describe('diaLargo', () => {
  it('escribe el día en español, sin fecha ISO', () => {
    expect(diaLargo('2026-10-03')).toBe('3 de octubre de 2026');
    expect(diaLargo('2026-11-01')).toBe('1 de noviembre de 2026');
  });
});
