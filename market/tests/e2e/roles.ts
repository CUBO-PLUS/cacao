import { type Browser, type Page } from '@playwright/test';

import { CAFETAL, contextoComo, idDeCuenta, type Cuenta } from './clerk';
import { servicio } from './ayuda';

// The old specs named people (lucia, rosa, ana...) who signed in with phone numbers. Sign-in is Clerk now and
// only two test accounts exist (see CUENTAS in clerk.ts), so each name maps to one of them:
//   - buyers are the buyer account;
//   - sellers and service providers are the admin account, which owns the Cafetal shop while a test needs one
//     (see cafetalDeAdmin);
//   - ana, the admin, is the admin account.
// Two people who must be different users in one test cannot be mapped this way; those tests are skipped.
export const CUENTA_DE = {
  lucia: 'comprador',
  diego: 'comprador',
  ana: 'admin',
  rosa: 'admin',
  andres: 'admin',
  sofia: 'admin',
  tomas: 'admin',
  mario: 'comprador',
  elena: 'admin',
} as const satisfies Record<string, Cuenta>;

export type Persona = keyof typeof CUENTA_DE;

/** The usuarios id of the account a name maps to. */
export async function idDe(persona: Persona): Promise<string> {
  return idDeCuenta(CUENTA_DE[persona]);
}

/** A page signed in as the account a name maps to. Close it with `pagina.context().close()`. */
export async function paginaComo(browser: Browser, persona: Persona): Promise<Page> {
  const { pagina } = await contextoComo(browser, CUENTA_DE[persona]);
  return pagina;
}

/**
 * Makes the admin test account the owner of the Cafetal shop, for a test whose seller side needs a shop.
 * Returns the function that gives the shop back to its original owner.
 */
export async function cafetalDeAdmin(): Promise<() => Promise<void>> {
  const { data, error } = await servicio().from('negocios').select('usuario_id').eq('id', CAFETAL).single();
  if (error) throw error;
  const duenoOriginal = data.usuario_id as string;
  const { error: errorCambio } = await servicio()
    .from('negocios')
    .update({ usuario_id: await idDeCuenta('admin') })
    .eq('id', CAFETAL);
  if (errorCambio) throw errorCambio;
  return async () => {
    const { error: errorVuelta } = await servicio().from('negocios').update({ usuario_id: duenoOriginal }).eq('id', CAFETAL);
    if (errorVuelta) throw new Error(`No pude devolver el negocio Cafetal: ${errorVuelta.message}`);
  };
}
