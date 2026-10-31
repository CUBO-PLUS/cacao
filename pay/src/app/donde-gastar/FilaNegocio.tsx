import { enlaceDeLugar, tipoDe, type Lugar } from '@/lib/negocios';

import estilos from './estilos.module.css';

// One business: the name, its plain type, and one link (the website, or the BTC Map page).
export function FilaNegocio({ lugar, distancia }: { lugar: Lugar; distancia?: string }) {
  const enlace = enlaceDeLugar(lugar);
  return (
    <li className={estilos.fila}>
      <p className={estilos.nombre}>{lugar.nombre}</p>
      <p className={estilos.tipo}>
        {tipoDe(lugar.categoria)}
        {distancia ? ` · ${distancia}` : null}
      </p>
      <a href={enlace.href} className={estilos.enlace} rel="noopener noreferrer">
        {enlace.etiqueta}
        <span className="solo-lectores"> de {lugar.nombre}</span>
      </a>
    </li>
  );
}
