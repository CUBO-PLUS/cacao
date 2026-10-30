// Search text for the catalogue. Case and accents do not count: "limon" finds "Limón mandarina".

/** Lowercase, with accents and tildes removed ("Ñandú" becomes "nandu"). */
export function sinAcentos(texto: string): string {
  return texto.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

/** The words of a search, normalised. Empty words are dropped. */
export function palabrasBuscadas(texto: string): string[] {
  return sinAcentos(texto).split(' ').filter((p) => p.length > 0);
}

/**
 * ILIKE pattern that finds every accent spelling of the longest word. The database compares
 * accented letters as one character, so each vowel and each n (which also matches ñ) becomes "_".
 * It can match a little too much; coincideBusqueda decides the exact result.
 */
export function patronAmplio(texto: string): string {
  const palabras = palabrasBuscadas(texto).sort((a, b) => b.length - a.length);
  const mayor = palabras[0] ?? '';
  return `%${[...mayor].map((letra) => ('aeioun'.includes(letra) ? '_' : letra)).join('')}%`;
}

/** True when every word of the search appears, without accents, in one of the fields. */
export function coincideBusqueda(texto: string, campos: string[]): boolean {
  const palabras = palabrasBuscadas(texto);
  if (palabras.length === 0) return true;
  const todo = campos.map(sinAcentos).join(' ');
  return palabras.every((p) => todo.includes(p));
}
