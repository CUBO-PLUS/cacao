import { entrar, crearCobro, respuestaDeError, respuestaJson, vistaCobro } from '@/servidor/api-cobros';

// Creates a charge. Idempotency-Key is required: a repeat of the same request returns the first charge (200), and
// never makes a second invoice. A new charge answers 201.
export async function POST(peticion: Request): Promise<Response> {
  const cliente = await entrar(peticion.headers.get('authorization'));
  if (!cliente.ok) return respuestaDeError(cliente);

  const cuerpo = await peticion.text();
  const creado = await crearCobro(cliente.dato, peticion.headers.get('idempotency-key'), cuerpo);
  if (!creado.ok) return respuestaDeError(creado);

  const { cobro, config, repetido } = creado.dato;
  return respuestaJson(repetido ? 200 : 201, vistaCobro(cobro, config), {
    'idempotent-replayed': repetido ? 'true' : 'false',
  });
}
