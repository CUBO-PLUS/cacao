// Shown while a page is read. A small cacao-coloured mark pulses; it stops for people who ask for less motion.
export default function Cargando() {
  return (
    <div className="cargando" role="status" aria-live="polite">
      <span className="cargando__marca" aria-hidden="true" />
      <p>Cargando CacaoPay…</p>
    </div>
  );
}
