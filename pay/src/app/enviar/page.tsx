import type { Metadata } from 'next';
import { connection } from 'next/server';
import { Suspense } from 'react';

import type { Entrega } from '@/lib/cotizacion';
import { idDeRepetir, montoTextoDesdeCentavos } from '@/lib/repetir';
import { cotizacionUsdBtc } from '@/lib/precio/fuente';
import { exigirSesion } from '@/servidor/sesion';
import { recientesDe } from '@/servidor/contactos';
import { tarifasDetalle } from '@/servidor/tasas';
import { envioPara } from '@/servidor/transferencias';

import { AsistenteEnvio, type PrefillEnvio } from './AsistenteEnvio';

export const metadata: Metadata = {
  title: 'Enviar dinero',
};

// The sender's three steps. The session and the fees are read per request, so the form waits
// behind a boundary.
export default function PaginaEnviar(props: PageProps<'/enviar'>) {
  return (
    <Suspense fallback={<p role="status">Cargando el envío…</p>}>
      <Asistente busqueda={props.searchParams} />
    </Suspense>
  );
}

async function Asistente({ busqueda }: { busqueda: PageProps<'/enviar'>['searchParams'] }) {
  await connection();
  const params = await busqueda;
  const sesion = await exigirSesion('/enviar');
  const [tarifas, precioDisponible, recientes, prefill] = await Promise.all([
    tarifasDetalle(),
    precioBtcDisponible(),
    recientesDe(sesion.usuario.id),
    prefillDeRepetir(sesion.usuario, params.repetir),
  ]);
  return (
    <AsistenteEnvio
      tarifas={tarifas}
      precioDisponible={precioDisponible}
      recientes={recientes}
      prefill={prefill}
    />
  );
}

// "Repetir envío": the amount, currency, delivery and recipient of one of the sender's own transfers.
// Anything else (another person's transfer, an unknown id) gives no prefill, without saying why.
async function prefillDeRepetir(
  usuario: { id: string; esAdmin: boolean },
  valor: string | string[] | undefined,
): Promise<PrefillEnvio | null> {
  const id = idDeRepetir(valor);
  if (!id) return null;
  const envio = await envioPara(usuario, id);
  if (!envio || envio.rol !== 'remitente') return null;
  return {
    monedaOrigen: envio.monedaOrigen,
    montoTexto: montoTextoDesdeCentavos(envio.montoOrigenCentavos),
    entrega: envio.entrega as Entrega,
    nombre: envio.destinatarioNombre,
    contacto: envio.destinatarioContacto ?? '',
  };
}

// Lightning needs the BTC price. Its absence only switches Lightning off; cash and bank still work.
async function precioBtcDisponible(): Promise<boolean> {
  try {
    await cotizacionUsdBtc();
    return true;
  } catch (error) {
    console.error('Precio de bitcoin:', error instanceof Error ? error.message : error);
    return false;
  }
}
