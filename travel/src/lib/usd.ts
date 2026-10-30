// Approximate US dollar value of a sats price, for the browser. The rate comes from /api/cotizacion/ once per page.
// Without a rate nothing is shown: the sats price stands alone, never a guessed or stale number.

let tasa: Promise<number | null> | null = null;

/** USD per BTC from the server. Null when the rate cannot be read. */
export function tasaUsdBtc(): Promise<number | null> {
  tasa ??= fetch('/api/cotizacion/', { headers: { accept: 'application/json' } })
    .then((r) => (r.ok ? r.json() : null))
    .then((j: { usdPorBtc?: unknown } | null) => {
      const n = Number(j?.usdPorBtc);
      return Number.isFinite(n) && n > 0 ? n : null;
    })
    .catch(() => null);
  return tasa;
}

/** "≈ US$45.00" for an amount in sats at the given rate. */
export function enUsd(sats: number, usdPorBtc: number): string {
  const usd = (sats * usdPorBtc) / 1e8;
  return `≈ US$${usd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Fills each [data-usd-sats] element with its dollar value and shows it. Without a rate they stay hidden. */
export async function pintarUsd(raiz: ParentNode = document): Promise<void> {
  const elementos = [...raiz.querySelectorAll<HTMLElement>('[data-usd-sats]')];
  if (elementos.length === 0) return;
  const usdPorBtc = await tasaUsdBtc();
  if (usdPorBtc === null) return;
  for (const el of elementos) {
    el.textContent = enUsd(Number(el.dataset.usdSats), usdPorBtc);
    el.hidden = false;
  }
}
