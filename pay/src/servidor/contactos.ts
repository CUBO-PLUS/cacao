import 'server-only';

import { distintosRecientes, type RecienteDestinatario } from '@/lib/recientes';

import { clienteServicio } from './supabase';

// The people a sender has already sent money to. Read on the server for the sender only, so the
// browser gets nothing it did not type itself.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Enough rows to find six different people, even when one person received many transfers.
const FILAS_LEIDAS = 60;

/**
 * Up to six distinct recipients of this sender, newest first, each with its latest delivery method.
 * A read error gives no chips: the form still works without them.
 */
export async function recientesDe(remitenteId: string): Promise<RecienteDestinatario[]> {
  if (!UUID.test(remitenteId)) return [];
  const { data, error } = await clienteServicio()
    .from('pay_transferencias')
    .select('destinatario_nombre, destinatario_contacto, entrega')
    .eq('remitente_id', remitenteId)
    .order('creada_en', { ascending: false })
    .order('id', { ascending: false })
    .limit(FILAS_LEIDAS);
  if (error) {
    console.error('Leer destinatarios recientes:', error.message);
    return [];
  }
  return distintosRecientes(
    (data ?? []).map((fila) => ({
      nombre: fila.destinatario_nombre,
      contacto: fila.destinatario_contacto,
      entrega: fila.entrega,
    })),
  );
}
