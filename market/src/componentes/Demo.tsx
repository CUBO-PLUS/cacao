import {
  AVISO_PEDIDO_DEMO,
  avisoDemo,
  CONTACTO_DEMO,
  datosDemo,
  enlacesBtcMap,
  esDemo,
  mostrarCerrado,
  mostrarEstadoNegocio,
} from '@/lib/demo';

// The notice at the top of a demo seller's page, product page and service page. Renders nothing for
// a seller without a btcmap_id, so the normal flow is unchanged.
export function AvisoDemo({ btcmapId, nombre }: { btcmapId: number | null; nombre: string }) {
  if (!esDemo(btcmapId)) return null;
  return (
    <p className="aviso-demo" role="note">
      {avisoDemo(nombre)}
    </p>
  );
}

// The footer of a demo seller's page: how to remove it, the BTC Map entry, and the real website.
export function PieDemo({ btcmapId }: { btcmapId: number | null }) {
  const datos = datosDemo(btcmapId);
  if (btcmapId === null || !datos) return null;
  const enlaces = enlacesBtcMap(btcmapId);
  return (
    <aside className="pie-demo" aria-label="Sobre este negocio">
      <p>{CONTACTO_DEMO}</p>
      <p>
        Sitio del negocio: <a href={datos.web} rel="noopener noreferrer" target="_blank">{datos.web}</a>
      </p>
      <p>
        Datos de <a href={enlaces.negocio} rel="noopener noreferrer" target="_blank">BTC Map</a>, con mapas de{' '}
        <a href={enlaces.licencia} rel="noopener noreferrer" target="_blank">OpenStreetMap</a> (ODbL).
      </p>
    </aside>
  );
}

// The notice about the order itself, in the cart, at checkout and on the order and receipt pages.
export function AvisoPedidoDemo({ activo }: { activo: boolean }) {
  if (!activo) return null;
  return (
    <p className="aviso-demo aviso-demo--pedido" role="note">
      {AVISO_PEDIDO_DEMO}
    </p>
  );
}

// Open or closed for a shop. A demo seller shows nothing here.
export function EstadoNegocio({ btcmapId, abierto }: { btcmapId: number | null; abierto: boolean }) {
  if (!mostrarEstadoNegocio(btcmapId)) return null;
  return abierto ? (
    <span className="marca marca--abierto">Abierto ahora</span>
  ) : (
    <span className="marca marca--cerrado">Cerrado por ahora</span>
  );
}

// The closed marker on cards and on product and service pages. Demo sellers never show it.
export function EtiquetaCerrado({
  btcmapId,
  abierto,
  texto,
}: {
  btcmapId: number | null;
  abierto: boolean;
  texto: string;
}) {
  if (!mostrarCerrado(btcmapId, abierto)) return null;
  return <span className="marca marca--cerrado">{texto}</span>;
}

// A small marker beside the seller's name on product and service cards.
export function EtiquetaEjemplo({ activo }: { activo: boolean }) {
  if (!activo) return null;
  return <span className="marca marca--ejemplo">Ejemplo</span>;
}
