import { URL_GRUPO } from "../../src/grupo.ts";

// The group bar: the same strip on every Cacao site, so a visitor always sees the whole group.
// Ledger is the current site, so its link carries aria-current; the others open in the same tab.
const SITIOS = [
  { nombre: "media", url: "https://cacao-media.vercel.app" },
  { nombre: "travel", url: "https://cacao-travel.vercel.app" },
  { nombre: "mercado", url: "https://cacao-market.vercel.app" },
  { nombre: "pay", url: "https://cacao-pay.vercel.app" },
  { nombre: "ledger", url: "https://cacao-cuentas.vercel.app", actual: true },
];

export function BarraGrupo() {
  return (
    <nav className="barra-grupo" aria-label="Grupo Cacao">
      <a href={URL_GRUPO}>
        <b>cacao</b>
      </a>
      {SITIOS.map((sitio) => (
        <a key={sitio.nombre} href={sitio.url} aria-current={sitio.actual ? "page" : undefined}>
          {sitio.nombre}
        </a>
      ))}
    </nav>
  );
}
