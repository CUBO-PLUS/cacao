// Links that the sender and the recipient share: the public tracker and WhatsApp. Pure, except that
// the default base reads the public site address from the environment.

export const SITIO_PREDETERMINADO = 'https://cacao-pay.vercel.app';

/** The public address of the product, or the default when the setting is missing or malformed. */
export function baseSitio(valor: string | undefined): string {
  const base = (valor ?? '').trim().replace(/\/+$/, '');
  return /^https?:\/\/[^/\s]+$/.test(base) ? base : SITIO_PREDETERMINADO;
}

/** The public tracker link for a transfer code: https://.../t/CP-XXXX-XXXX. */
export function enlaceRastreo(codigo: string, base: string = baseSitio(process.env.NEXT_PUBLIC_SITIO_URL)): string {
  return `${base}/t/${codigo}`;
}

/** A wa.me link with the text already written. */
export function enlaceWhatsapp(texto: string): string {
  return `https://wa.me/?text=${encodeURIComponent(texto)}`;
}

/** The sentence sent with the tracker link. */
export function mensajeRastreo(codigo: string, enlace: string): string {
  return `Seguí tu envío ${codigo} en CacaoPay: ${enlace}`;
}
