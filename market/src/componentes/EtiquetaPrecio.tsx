import { formatoSats, formatoUsd } from '@/lib/dinero';

type Props = {
  usdCentavos: number;
  /** Null when no BTC price is available: the tag then shows USD only. */
  sats: number | null;
  tamano?: 'normal' | 'grande';
};

// The price tag: a Mazorca label with one end cut to a point and a punched hole. The hole is
// drawn in the ground it sits on (the card or the page), so the tag reads as a real tag.
// Dollars lead, because that is what a buyer reads first. Sats follow, smaller, when a quote exists.
export function EtiquetaPrecio({ usdCentavos, sats, tamano = 'normal' }: Props) {
  const clase = tamano === 'grande' ? 'etiqueta etiqueta--grande' : 'etiqueta';

  if (sats === null) {
    return (
      <p className={clase}>
        <span className="etiqueta__agujero" aria-hidden="true" />
        <span className="etiqueta__principal">
          <span className="etiqueta__num">{formatoUsd(usdCentavos)}</span>
        </span>
      </p>
    );
  }

  // "1,250 sats": the number is set after the dollars, and the unit is its own span.
  const texto = formatoSats(sats);
  const corte = texto.lastIndexOf(' ');
  const numero = corte > 0 ? texto.slice(0, corte) : texto;
  const unidad = corte > 0 ? texto.slice(corte + 1) : '';

  return (
    <p className={clase}>
      <span className="etiqueta__agujero" aria-hidden="true" />
      <span className="etiqueta__principal">
        <span className="etiqueta__num">{formatoUsd(usdCentavos)}</span>
      </span>
      <span className="etiqueta__secundario">
        o {numero}{' '}
        {unidad && <span className="etiqueta__unidad">{unidad}</span>}
      </span>
    </p>
  );
}
