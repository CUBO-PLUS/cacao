import { entrar, leerCobro, respuestaDeError, respuestaJson, vistaCobro } from '@/servidor/api-cobros';

// Reads a charge and its live state: BTCPay is asked when the charge is not paid yet. Another client's charge is
// not found (404), the same as a charge that does not exist.
export async function GET(peticion: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const cliente = await entrar(peticion.headers.get('authorization'));
  if (!cliente.ok) return respuestaDeError(cliente);

  const { id } = await params;
  const leido = await leerCobro(cliente.dato, id);
  if (!leido.ok) return respuestaDeError(leido);
  return respuestaJson(200, vistaCobro(leido.dato.cobro, leido.dato.config));
}
