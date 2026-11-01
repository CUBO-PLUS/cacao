import Link from 'next/link';

import estilos from './estilos.module.css';

// Presentational only (no hooks), so it can be the Suspense fallback as well as the live nav.
const ENLACES = [
  { href: '/admin', texto: 'Resumen' },
  { href: '/admin/negocios', texto: 'Negocios' },
  { href: '/admin/servicios', texto: 'Servicios' },
  { href: '/admin/ordenes', texto: 'Órdenes' },
  { href: '/admin/inventario', texto: 'Inventario' },
  { href: '/admin/disputas', texto: 'Disputas' },
  { href: '/admin/embudo', texto: 'Embudo' },
  { href: '/admin/auditoria', texto: 'Auditoría' },
];

// /admin is current only on itself. The other sections also cover their detail pages.
function esActual(href: string, ruta: string | null | undefined): boolean {
  if (!ruta) return false;
  if (href === '/admin') return ruta === '/admin';
  return ruta === href || ruta.startsWith(`${href}/`);
}

export function NavegacionAdmin({ actual }: { actual?: string | null }) {
  return (
    <nav aria-label="Secciones de administración" className={estilos.subnav}>
      <ul className={estilos.subnavLista}>
        {ENLACES.map((e) => (
          <li key={e.href}>
            <Link
              href={e.href}
              className={estilos.subnavEnlace}
              aria-current={esActual(e.href, actual) ? 'page' : undefined}
            >
              {e.texto}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
