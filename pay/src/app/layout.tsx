import { ClerkProvider } from '@clerk/nextjs';
import { esMX } from '@clerk/localizations/es-MX';
import type { Metadata, Viewport } from 'next';
import { Bricolage_Grotesque, JetBrains_Mono } from 'next/font/google';

import { BarraInferior } from '@/componentes/BarraInferior';
import { Cabecera } from '@/componentes/Cabecera';
import { GrupoCacao } from '@/componentes/GrupoCacao';

import './globals.css';

// Variable fonts: no weight list needed. Bricolage carries the text, JetBrains Mono the amounts and codes.
const bricolage = Bricolage_Grotesque({
  subsets: ['latin'],
  variable: '--font-bricolage',
  display: 'swap',
});

const mono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  display: 'swap',
});

// Clerk strings: the es-MX base, with the voseo lines of El Salvador on top.
const localizacion = {
  ...esMX,
  signIn: {
    ...esMX.signIn,
    start: {
      ...esMX.signIn?.start,
      title: 'Entrá a tu cuenta',
      titleCombined: 'Entrá a tu cuenta',
      actionText: '¿No tenés cuenta?',
      actionLink: 'Registrate',
    },
  },
  signUp: {
    ...esMX.signUp,
    start: {
      ...esMX.signUp?.start,
      title: 'Creá tu cuenta',
      titleCombined: 'Creá tu cuenta',
      actionText: '¿Ya tenés cuenta?',
      actionLink: 'Iniciá sesión',
    },
  },
};

// Same palette as globals.css: chocolate for buttons and links, tostado for text.
const apariencia = {
  variables: {
    colorPrimary: '#5a3221',
    colorText: '#2a1912',
    colorBackground: '#fffaf4',
    fontFamily: 'var(--font-bricolage), system-ui, sans-serif',
  },
  // The page shows its own title, so the card keeps only the step's instructions. A flat card with a thin
  // border matches the other cards of the site.
  elements: {
    rootBox: { width: '100%' },
    cardBox: { width: '100%', boxShadow: 'none', border: '1px solid rgba(42, 25, 18, 0.14)', borderRadius: '16px' },
    card: { boxShadow: 'none' },
    headerTitle: { display: 'none' },
  },
};

export const metadata: Metadata = {
  title: {
    default: 'CacaoPay',
    template: '%s · CacaoPay',
  },
  description:
    'Mandá dinero a El Salvador y mirá cada centavo. Una simulación: no mueve dinero real.',
  applicationName: 'CacaoPay',
  // Demo build: keep it out of search results.
  robots: { index: false },
  icons: {
    icon: [{ url: '/icono.svg', type: 'image/svg+xml' }],
  },
};

// viewportFit cover lets the bottom bar use the phone's safe area (env(safe-area-inset-bottom)).
export const viewport: Viewport = {
  themeColor: '#2A1912',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="es-SV" className={`${bricolage.variable} ${mono.variable}`}>
      <body>
        <ClerkProvider localization={localizacion} appearance={apariencia}>
          <a className="saltar" href="#contenido">
            Saltar al contenido
          </a>
          <div className="hoja">
            <Cabecera />
            <main id="contenido" tabIndex={-1} className="principal">
              <div className="contenedor">{children}</div>
            </main>
            <p className="pie-demo">
              Demo de Grupo Cacao · bitcoin de prueba (regtest), sin valor · tasas de demostración
            </p>
          </div>
          <div className="zona-grupo">
            <div className="contenedor">
              <p className="marca-gigante" aria-hidden="true">
                <b>cacao</b>pay
              </p>
            </div>
            <GrupoCacao actual="pay" />
          </div>
          <BarraInferior />
        </ClerkProvider>
      </body>
    </html>
  );
}
