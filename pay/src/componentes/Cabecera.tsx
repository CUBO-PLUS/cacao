import Link from 'next/link';
import { Suspense } from 'react';

import { ConmutadorModo } from './ConmutadorModo';
import { EnlaceCuenta, EnlaceCuentaCargando } from './EnlaceCuenta';
import { Logo } from './Logo';
import { NavegacionCabecera } from './NavegacionCabecera';
import { NavegacionPrincipal } from './NavegacionPrincipal';

// The header row: wordmark (home), the sections on wide screens, and the account link.
// The sections are hidden on phones (CSS), where the bottom bar carries them.
export function Cabecera() {
  return (
    <header className="cabecera">
      <div className="contenedor cabecera__fila">
        <Link href="/" className="logo-enlace" aria-label="CacaoPay, inicio">
          <Logo />
        </Link>
        <Suspense fallback={<NavegacionPrincipal variante="cabecera" />}>
          <NavegacionCabecera />
        </Suspense>
        <div className="cabecera__cuenta">
          <Suspense fallback={null}>
            <ConmutadorModo />
          </Suspense>
          <Suspense fallback={<EnlaceCuentaCargando />}>
            <EnlaceCuenta />
          </Suspense>
        </div>
      </div>
    </header>
  );
}
