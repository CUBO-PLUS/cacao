import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque, JetBrains_Mono } from "next/font/google";
import Link from "next/link";

import "./globals.css";

// Variable fonts: no weight list needed. Bricolage carries the text, JetBrains Mono the amounts and codes.
const bricolage = Bricolage_Grotesque({ subsets: ["latin"], variable: "--font-bricolage", display: "swap" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono", display: "swap" });

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

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="es-SV" className={`${bricolage.variable} ${mono.variable}`}>
      <body>
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
              <Link href="/tickets">Tickets</Link>
              <Link href="/mes">Mes</Link>
            </nav>
          </header>
          <main id="contenido" tabIndex={-1} className="contenido">
            {children}
          </main>
          <footer className="pie">
            <p>Demo de Grupo Cacao. Sellos de Hacienda simulados; pagos en bitcoin de prueba.</p>
          </footer>
        </div>
      </body>
    </html>
  );
}
