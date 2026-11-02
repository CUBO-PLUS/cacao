import type { Metadata } from 'next';
import { Suspense } from 'react';

import { exigirAdmin } from '@/servidor/sesion';

import { NavegacionMonitor } from './NavegacionMonitor';
import { NavegacionMonitorActual } from './NavegacionMonitorActual';
import estilos from './estilos.module.css';

export const metadata: Metadata = {
  title: 'Monitor',
  robots: { index: false, follow: false },
};

// Blocking: the admin check runs before anything streams. A visitor who is not an admin gets the
// plain not-found page, with no admin text in it. Signed-out visitors go to sign-in first.
export const instant = false;

// Layouts do not run again between sections, so each page checks the administrator flag too.
export default async function LayoutMonitor({ children }: { children: React.ReactNode }) {
  await exigirAdmin('/admin');

  return (
    <div className={estilos.marco}>
      <h1>Monitor de envíos</h1>
      {/* usePathname suspends under Cache Components, so the list without the current mark is the fallback. */}
      <Suspense fallback={<NavegacionMonitor />}>
        <NavegacionMonitorActual />
      </Suspense>
      <div className={estilos.marco}>{children}</div>
    </div>
  );
}
