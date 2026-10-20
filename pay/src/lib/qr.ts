import QRCode from 'qrcode';

// A QR code as one SVG path, computed on the server so the page needs no script. Pure: the same text
// always gives the same modules.

export type MatrizQr = {
  /** Modules per side, without the quiet zone. */
  tamano: number;
  /** One path with a square for each dark module. */
  d: string;
};

/** The modules of a QR code for the text, with medium error correction. */
export function matrizQr(texto: string): MatrizQr {
  const qr = QRCode.create(texto, { errorCorrectionLevel: 'M' });
  const tamano = qr.modules.size;
  let d = '';
  for (let fila = 0; fila < tamano; fila++) {
    for (let columna = 0; columna < tamano; columna++) {
      if (qr.modules.get(fila, columna)) d += `M${columna} ${fila}h1v1h-1z`;
    }
  }
  return { tamano, d };
}
