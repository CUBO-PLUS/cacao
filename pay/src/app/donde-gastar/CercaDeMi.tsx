'use client';

import { useState } from 'react';

import { cercanos, formatoDistancia, type Lugar } from '@/lib/negocios';

import { FilaNegocio } from './FilaNegocio';
import estilos from './estilos.module.css';

type Estado =
  | { tipo: 'inicial' }
  | { tipo: 'buscando' }
  | { tipo: 'error'; texto: string }
  | { tipo: 'listo'; lista: Array<{ lugar: Lugar; km: number }> };

const CANTIDAD = 10;

// Asks for the position only when tapped. The position is read here, used to sort the list, and dropped:
// it is not sent to the server and not kept in state. Only the businesses and their distances are kept.
export function CercaDeMi() {
  const [estado, setEstado] = useState<Estado>({ tipo: 'inicial' });

  function buscar() {
    if (!navigator.geolocation) {
      setEstado({ tipo: 'error', texto: 'Este navegador no puede leer tu ubicación. Usá la búsqueda de abajo.' });
      return;
    }
    setEstado({ tipo: 'buscando' });
    navigator.geolocation.getCurrentPosition(
      async (posicion) => {
        const { latitude, longitude } = posicion.coords;
        try {
          const respuesta = await fetch('/api/negocios');
          if (!respuesta.ok) throw new Error(`HTTP ${respuesta.status}`);
          const lugares = (await respuesta.json()) as Lugar[];
          setEstado({ tipo: 'listo', lista: cercanos(lugares, latitude, longitude, CANTIDAD) });
        } catch {
          setEstado({ tipo: 'error', texto: 'No pudimos cargar los negocios. Probá de nuevo.' });
        }
      },
      () => {
        setEstado({ tipo: 'error', texto: 'No pudimos leer tu ubicación. Podés usar la búsqueda de abajo.' });
      },
      { timeout: 15000, maximumAge: 300000 },
    );
  }

  return (
    <section className={estilos.cercaDeMi} aria-labelledby="titulo-cerca">
      <h2 id="titulo-cerca">Negocios cerca de vos</h2>
      <p className={estilos.nota}>
        Pedimos tu ubicación solo cuando tocás el botón. No la guardamos ni la enviamos.
      </p>
      <div>
        <button type="button" className="boton boton--secundario" onClick={buscar} disabled={estado.tipo === 'buscando'}>
          Cerca de mí
        </button>
      </div>
      <p role="status" className={estilos.nota}>
        {estado.tipo === 'buscando' && 'Buscando tu ubicación…'}
        {estado.tipo === 'error' && estado.texto}
        {estado.tipo === 'listo' && `Los ${estado.lista.length} más cercanos a tu ubicación.`}
      </p>
      {estado.tipo === 'listo' && (
        <ol className={estilos.lugares}>
          {estado.lista.map(({ lugar, km }) => (
            <FilaNegocio key={lugar.id} lugar={lugar} distancia={formatoDistancia(km)} />
          ))}
        </ol>
      )}
    </section>
  );
}
