'use client';

import { usePathname } from 'next/navigation';

import { NavegacionMonitor } from './NavegacionMonitor';

// Marks the current monitor section. Client only because it reads the pathname.
export function NavegacionMonitorActual() {
  const ruta = usePathname();
  return <NavegacionMonitor actual={ruta} />;
}
