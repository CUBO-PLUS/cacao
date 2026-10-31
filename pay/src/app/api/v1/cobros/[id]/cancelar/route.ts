import { cancelarCobro, entrar, respuestaDeError, respuestaJson, vistaCobro } from '@/servidor/api-cobros';

// Cancels a pending charge. A paid charge cannot be cancelled (409). Cancelling a cancelled charge answers the same.
export async function POST(peticion: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const cliente = await entrar(peticion.headers.get('authorization'));
  if (!cliente.ok) return respuestaDeError(cliente);

  const { id } = await params;
  const cancelado = await cancelarCobro(cliente.dato, id);
  if (!cancelado.ok) return respuestaDeError(cancelado);
  return respuestaJson(200, vistaCobro(cancelado.dato.cobro, cancelado.dato.config));
}
