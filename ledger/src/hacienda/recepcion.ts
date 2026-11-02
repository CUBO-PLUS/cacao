import { firmarDteLocal } from "../firma/firma-local.ts";
import type { Generacion } from "../generacion.ts";
import { recibir } from "../recepcion-simulada.ts";
import type { FuenteSello } from "../ticket.ts";
import { clienteDeConfig, configuracionHaciendaDeEntorno, type ClienteHacienda, type ConfigHacienda } from "./transmitir.ts";

// One reception: takes the unsigned document and returns the answer of the service that received it.
// The emitter and the CLI take this function, so the same steps run with the simulator or with the test mock.

export type RespuestaRecepcion =
  | { estado: "aceptado"; sello: string; momento: string; fuente: FuenteSello }
  | { estado: "rechazado"; observaciones: string[]; momento: string; fuente: FuenteSello }
  | { estado: "sin-respuesta"; motivo: string; momento: string };

// The generation is only the simulator's schema choice; the test service takes the document as it is.
export type Recepcion = (documento: unknown, ahora: Date, generacion?: Generacion) => Promise<RespuestaRecepcion>;

// The local simulator (recibir). Used when the test service is not configured.
export const recepcionSimulada: Recepcion = async (documento, ahora, generacion) => {
  const respuesta = recibir(documento, ahora, { generacion });
  if (respuesta.aceptado && respuesta.sello) {
    return { estado: "aceptado", sello: respuesta.sello, momento: respuesta.momento, fuente: "simulador-local" };
  }
  return { estado: "rechazado", observaciones: respuesta.observaciones, momento: respuesta.momento, fuente: "simulador-local" };
};

// The test mock: signs the document with the configured key (RS512 JWS), sends it, and returns the seal it gave back.
export function recepcionDePrueba(config: ConfigHacienda, cliente: ClienteHacienda = clienteDeConfig(config)): Recepcion {
  return async (documento, ahora) => {
    const jws = firmarDteLocal(documento, config.clavePrivadaFirma);
    const respuesta = await cliente.transmitir(documento as { identificacion: Record<string, unknown> }, jws, ahora);
    if (respuesta.estado === "aceptado") {
      return { estado: "aceptado", sello: respuesta.sello, momento: respuesta.momento, fuente: "mock-svfe" };
    }
    if (respuesta.estado === "rechazado") {
      return { estado: "rechazado", observaciones: respuesta.observaciones, momento: respuesta.momento, fuente: "mock-svfe" };
    }
    return respuesta;
  };
}

// Chooses the reception from the environment: the test mock when LEDGER_HACIENDA_* is configured, else the simulator.
export function recepcionDeEntorno(entorno: Record<string, string | undefined> = process.env): Recepcion {
  const config = configuracionHaciendaDeEntorno(entorno);
  return config === null ? recepcionSimulada : recepcionDePrueba(config);
}
