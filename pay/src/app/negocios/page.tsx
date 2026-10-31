import type { Metadata } from 'next';
import Link from 'next/link';
import { connection } from 'next/server';
import { Suspense } from 'react';

import { Boton } from '@/componentes/Boton';
import { etiquetaTipo } from '@/lib/cobro-negocio';
import { negocioDeCuenta } from '@/servidor/negocios';
import { sesionActual } from '@/servidor/sesion';

import { FormularioActivar } from './FormularioActivar';
import estilos from './estilos.module.css';

export const metadata: Metadata = {
  title: 'CacaoPay para negocios',
};

// Whether the visitor has a business is read per request, from the session.
export default function PaginaNegocios() {
  return (
    <Suspense fallback={<p role="status">Cargando…</p>}>
      <Contenido />
    </Suspense>
  );
}

async function Contenido() {
  await connection();
  const sesion = await sesionActual();

  if (!sesion) {
    return (
      <div className={estilos.pagina}>
        <header className="encabezado">
          <h1>CacaoPay para negocios</h1>
          <p>
            Cobrá en el mostrador con bitcoin. Escribís el monto en dólares, el cliente escanea un código QR con su
            billetera y ves el pago en segundos.
          </p>
          <p className="aviso">
            Esto es una demo: los cobros son con bitcoin de prueba, que no tiene valor. No se pide ningún dato fiscal.
          </p>
        </header>
        <div className={estilos.acciones}>
          <Boton href="/entrar?volver=%2Fnegocios">Cobrar con mi negocio</Boton>
        </div>
      </div>
    );
  }

  const negocio = await negocioDeCuenta(sesion.usuario.id);

  if (!negocio || !negocio.activo) {
    return (
      <div className={estilos.pagina}>
        <header className="encabezado">
          <h1>{negocio ? `Cobrar con ${negocio.nombre}` : 'Cobrar con mi negocio'}</h1>
          <p>
            {negocio
              ? 'Falta un dato para activar CacaoPay en tu negocio. Con eso ya podés cobrar en caja.'
              : 'Activá CacaoPay para tu negocio. Usamos el nombre y el lugar que nos des, y creamos el cobro en bitcoin de prueba.'}
          </p>
          <p className="aviso">Demo con bitcoin de prueba, sin valor. No se piden datos fiscales.</p>
        </header>
        <FormularioActivar
          nombre={negocio?.nombre ?? ''}
          ubicacion={negocio?.ubicacion ?? ''}
          tipo={negocio?.tipo ?? ''}
          pideDatos={!negocio}
          pideTipo={!negocio?.tipo}
        />
      </div>
    );
  }

  return (
    <div className={estilos.pagina}>
      <header className="encabezado">
        <h1>{negocio.nombre}</h1>
        <p>
          {etiquetaTipo(negocio.tipo)} · {negocio.ubicacion}
        </p>
        <p className="aviso">Cobros de prueba con bitcoin: no tienen valor.</p>
      </header>

      <nav aria-label="Herramientas del negocio" className={estilos.lista}>
        <Link href="/negocios/cobrar" className={estilos.enlaceTarjeta}>
          <strong>Cobrar en caja</strong>
          <span>Escribís el monto y mostrás el código QR al cliente.</span>
        </Link>
        <Link href="/negocios/qr" className={estilos.enlaceTarjeta}>
          <strong>Código QR del mostrador</strong>
          <span>Para imprimir y poner en la mesa: el cliente escribe el monto.</span>
        </Link>
        <Link href="/negocios/panel" className={estilos.enlaceTarjeta}>
          <strong>Ventas</strong>
          <span>Lo que cobraste hoy, este mes y los últimos cobros.</span>
        </Link>
      </nav>
    </div>
  );
}
