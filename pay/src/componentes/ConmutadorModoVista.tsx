'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import estilos from './ConmutadorModo.module.css';

// "Personal" and "Mi negocio". The business side is the /negocios pages; the rest of the site is personal.
export function ConmutadorModoVista() {
  const ruta = usePathname();
  const enNegocio = ruta === '/negocios' || ruta.startsWith('/negocios/') || ruta.startsWith('/pagar/');

  return (
    <nav aria-label="Elegir personal o mi negocio" className={estilos.conmutador}>
      <Link href="/" className={estilos.opcion} aria-current={enNegocio ? undefined : 'page'}>
        Personal
      </Link>
      <Link href="/negocios" className={estilos.opcion} aria-current={enNegocio ? 'page' : undefined}>
        Mi negocio
      </Link>
    </nav>
  );
}
