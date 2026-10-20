// The countdown of a quote: how long it stays valid, in minutes and seconds, for the sender's screens.
// Pure, so the same rule runs in the form and in its tests.

/** Milliseconds left until the instant, never negative. */
export function restanteMs(validaHasta: string, ahora: number): number {
  const hasta = Date.parse(validaHasta);
  if (!Number.isFinite(hasta)) return 0;
  return Math.max(0, hasta - ahora);
}

/** "4:59" for 299,400 ms. Seconds are rounded up, so a quote never shows 0:00 while still valid. */
export function formatoCuenta(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const minutos = Math.floor(total / 60);
  return `${minutos}:${String(total % 60).padStart(2, '0')}`;
}
