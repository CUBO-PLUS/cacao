import Link from 'next/link';

// Presentational only (no hooks), so it can be the Suspense fallback as well as the live nav.
// The bottom bar starts at home; the header starts at the sections, because the wordmark is home.
// The tab bar has room for short labels; the header spells out "Mis envíos".
const INICIO = { href: '/', texto: 'Inicio' };
const ENVIAR = { href: '/enviar', texto: 'Enviar' };
const ENVIOS_BARRA = { href: '/envios', texto: 'Envíos' };
const ENVIOS_CABECERA = { href: '/envios', texto: 'Mis envíos' };
const RECIBIDOS = { href: '/recibidos', texto: 'Recibidos' };
const MONITOR = { href: '/admin', texto: 'Monitor' };

// The two navs are never both announced: CSS hides the header nav on phones and the bar on
// wide screens. Each still has its own name, so the two are told apart when both are in the DOM.
const NOMBRE = {
  barra: 'Navegación inferior',
  cabecera: 'Navegación principal',
} as const;

function esActual(href: string, ruta: string | null | undefined): boolean {
  if (!ruta) return false;
  if (href === '/') return ruta === '/';
  return ruta === href || ruta.startsWith(`${href}/`);
}

export function NavegacionPrincipal({
  actual,
  variante,
  esAdmin = false,
}: {
  actual?: string | null;
  variante: 'barra' | 'cabecera';
  /** Administrators also get Monitor in the header. */
  esAdmin?: boolean;
}) {
  const enlaces =
    variante === 'barra'
      ? [INICIO, ENVIAR, ENVIOS_BARRA, RECIBIDOS]
      : [ENVIAR, ENVIOS_CABECERA, RECIBIDOS, ...(esAdmin ? [MONITOR] : [])];

  return (
    <nav aria-label={NOMBRE[variante]} className={`nav nav--${variante}`}>
      <ul>
        {enlaces.map((e) => {
          const activo = esActual(e.href, actual);
          return (
            <li key={e.href}>
              <Link href={e.href} aria-current={activo ? 'page' : undefined}>
                {e.texto}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
