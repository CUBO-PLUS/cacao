// Shown while a page reads the ledger. Kept static so it appears at once.
export default function Cargando() {
  return (
    <div className="cargando" role="status" aria-live="polite" aria-busy="true">
      <p className="vacio">Cargando…</p>
    </div>
  );
}
