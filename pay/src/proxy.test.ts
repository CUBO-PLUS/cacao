import { beforeEach, describe, expect, it, vi } from 'vitest';

// The lookups are replaced; the proxy decides the 404 and passes everything else to Clerk.
const { clerk, existeCobro, existeCodigo } = vi.hoisted(() => ({
  clerk: vi.fn(),
  existeCobro: vi.fn(),
  existeCodigo: vi.fn(),
}));

vi.mock('@clerk/nextjs/server', () => ({ clerkMiddleware: () => clerk }));
vi.mock('@/servidor/cobro', () => ({ existeCobro }));
vi.mock('@/servidor/transferencias', () => ({ existeCodigo }));

import proxy from './proxy';

function pedido(ruta: string) {
  return { nextUrl: { pathname: ruta } } as unknown as Parameters<typeof proxy>[0];
}

const EVENTO = {} as Parameters<typeof proxy>[1];
const TOKEN = 'a'.repeat(43);

beforeEach(() => {
  clerk.mockReset();
  clerk.mockReturnValue(undefined);
  existeCobro.mockReset();
  existeCodigo.mockReset();
});

describe('proxy: 404 de enlaces que no existen', () => {
  it('un código de envío que no existe responde 404 con el mensaje de rastreo', async () => {
    existeCodigo.mockResolvedValue(false);

    const r = (await proxy(pedido('/t/xx/'), EVENTO)) as Response;

    expect(r.status).toBe(404);
    expect(r.headers.get('x-robots-tag')).toBe('noindex, nofollow');
    expect(await r.text()).toContain('No encontramos un envío con ese código');
    expect(clerk).not.toHaveBeenCalled();
  });

  it('un código de envío que sí existe sigue hacia la página', async () => {
    existeCodigo.mockResolvedValue(true);

    const r = await proxy(pedido('/t/CP-2345-ABCD/'), EVENTO);

    expect(r).toBeUndefined();
    expect(clerk).toHaveBeenCalledTimes(1);
  });

  it('un enlace de cobro que no existe responde 404 con el mensaje de cobro', async () => {
    existeCobro.mockResolvedValue(false);

    const r = (await proxy(pedido(`/cobrar/${TOKEN}/`), EVENTO)) as Response;

    expect(r.status).toBe(404);
    expect(await r.text()).toContain('Este enlace de cobro no existe');
    expect(clerk).not.toHaveBeenCalled();
  });

  it('un enlace de cobro que sí existe sigue hacia la página', async () => {
    existeCobro.mockResolvedValue(true);

    await proxy(pedido(`/cobrar/${TOKEN}`), EVENTO);

    expect(existeCobro).toHaveBeenCalledWith(TOKEN);
    expect(clerk).toHaveBeenCalledTimes(1);
  });

  it('una falla al consultar no bloquea la página: la decide la página', async () => {
    existeCodigo.mockRejectedValue(new Error('sin red'));

    await proxy(pedido('/t/CP-2345-ABCD/'), EVENTO);

    expect(clerk).toHaveBeenCalledTimes(1);
  });

  it('las demás rutas no consultan nada y van a Clerk', async () => {
    await proxy(pedido('/rastrear/'), EVENTO);

    expect(existeCodigo).not.toHaveBeenCalled();
    expect(existeCobro).not.toHaveBeenCalled();
    expect(clerk).toHaveBeenCalledTimes(1);
  });
});
