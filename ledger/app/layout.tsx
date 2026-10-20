import { esMX } from "@clerk/localizations/es-MX";
import { ClerkProvider, UserButton } from "@clerk/nextjs";
import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque, JetBrains_Mono } from "next/font/google";
import Link from "next/link";
import { Suspense } from "react";

import { sesionActual } from "../src/servidor/sesion.ts";

import "./globals.css";

// Variable fonts: no weight list needed. Bricolage carries the text, JetBrains Mono the amounts and codes.
const bricolage = Bricolage_Grotesque({ subsets: ["latin"], variable: "--font-bricolage", display: "swap" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono", display: "swap" });

// Clerk strings: the es-MX base, with the voseo lines of El Salvador on top (same as pay/).
const localizacion = {
  ...esMX,
  signIn: {
    ...esMX.signIn,
    start: {
      ...esMX.signIn?.start,
      title: "Entrá a tu cuenta",
      titleCombined: "Entrá a tu cuenta",
      actionText: "¿No tenés cuenta?",
      actionLink: "Registrate",
    },
  },
  signUp: {
    ...esMX.signUp,
    start: {
      ...esMX.signUp?.start,
      title: "Creá tu cuenta",
      titleCombined: "Creá tu cuenta",
      actionText: "¿Ya tenés cuenta?",
      actionLink: "Iniciá sesión",
    },
  },
};

// Same palette as globals.css: chocolate for buttons and links, tostado for text.
const apariencia = {
  variables: {
    colorPrimary: "#5a3221",
    colorText: "#2a1912",
    colorBackground: "#fffaf4",
    fontFamily: "var(--font-bricolage), system-ui, sans-serif",
  },
  // The page shows its own title, so the card keeps only the step's instructions.
  elements: {
    rootBox: { width: "100%" },
    cardBox: { width: "100%", boxShadow: "none", border: "1px solid rgba(42, 25, 18, 0.14)", borderRadius: "16px" },
    card: { boxShadow: "none" },
    headerTitle: { display: "none" },
  },
};

export const metadata: Metadata = {
  title: {
    default: "cacaoledger",
    template: "%s · cacaoledger",
  },
  description: "Ventas, documentos y libros de IVA de Grupo Cacao. Demo.",
  applicationName: "cacaoledger",
  // Demo company: keep it out of search results.
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f5ede3" },
    { media: "(prefers-color-scheme: dark)", color: "#2a1912" },
  ],
  width: "device-width",
  initialScale: 1,
};

// The owner's links and the account button. Read inside a Suspense boundary, so the static shell of the layout still
// prerenders. A failed session read must not break the public pages: it falls back to "Entrar".
async function NavegacionSesion() {
  let dueno = false;
  try {
    dueno = (await sesionActual())?.usuario.esAdmin === true;
  } catch (e) {
    console.error("La sesión no pudo leerse:", e);
  }
  if (!dueno) {
    return (
      <Link href="/entrar" className="nav-entrar">
        Entrar
      </Link>
    );
  }
  return (
    <>
      <Link href="/tickets">Tickets</Link>
      <Link href="/mes">Mes</Link>
      <span className="nav-usuario">
        <UserButton />
      </span>
    </>
  );
}

export default async function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="es-SV" className={`${bricolage.variable} ${mono.variable}`}>
      <body>
        <ClerkProvider localization={localizacion} appearance={apariencia}>
          <a className="saltar" href="#contenido">
            Saltar al contenido
          </a>
          <div className="hoja">
            <header className="cabecera">
              <p className="marca">
                <Link href="/">
                  cacao<span>ledger</span>
                </Link>
              </p>
              <p className="lema">Cobrar y declarar</p>
              <nav className="nav" aria-label="Secciones">
                <Link href="/">Tablero</Link>
                <Suspense fallback={<Link href="/entrar" className="nav-entrar">Entrar</Link>}>
                  <NavegacionSesion />
                </Suspense>
              </nav>
            </header>
            <main id="contenido" tabIndex={-1} className="contenido">
              {children}
            </main>
            <footer className="pie">
              <p>Demo de Grupo Cacao. Sellos de Hacienda simulados; pagos en bitcoin de prueba.</p>
            </footer>
          </div>
        </ClerkProvider>
      </body>
    </html>
  );
}
