import { matrizQr } from '@/lib/qr';

// A QR code drawn on the server as SVG: no script, and it prints in black on white. Two modules of quiet
// zone on each side, as the standard asks.
export function CodigoQr({ texto, titulo, tamano = 168 }: { texto: string; titulo: string; tamano?: number }) {
  const { tamano: modulos, d } = matrizQr(texto);
  const margen = 2;
  const total = modulos + margen * 2;

  return (
    <figure style={{ display: 'grid', justifyItems: 'start', gap: 6, margin: 0 }}>
      <svg
        viewBox={`0 0 ${total} ${total}`}
        width={tamano}
        height={tamano}
        role="img"
        aria-label={`Código QR para seguir el envío: ${texto}`}
        shapeRendering="crispEdges"
        style={{ display: 'block', background: '#fff', maxWidth: '100%', height: 'auto', aspectRatio: '1 / 1' }}
      >
        <rect width={total} height={total} fill="#fff" />
        <path transform={`translate(${margen} ${margen})`} d={d} fill="#000" />
      </svg>
      <figcaption style={{ fontSize: '0.875rem', fontWeight: 600 }}>{titulo}</figcaption>
    </figure>
  );
}
