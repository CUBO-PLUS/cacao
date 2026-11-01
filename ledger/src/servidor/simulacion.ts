import { ErrorLedger } from "../errores.ts";
import { createAlmacenAtestacionesSupabase, type AlmacenAtestaciones } from "../almacen/atestaciones.ts";
import type { OpcionesEmision } from "../emitir.ts";
import { supabaseDeEntorno, type ConfigSupabaseWeb } from "./configuracion.ts";

// The owner's demo control "Simular caída de Hacienda". It only changes how CacaoLedger issues documents: nothing
// reaches the Ministry, and every label that shows it says "simulada". The state is one row (ledger_simulacion).

export type EstadoSimulacion = { caida: boolean; desde: Date | null };

function cabeceras(config: ConfigSupabaseWeb): Record<string, string> {
  return { apikey: config.clave, authorization: `Bearer ${config.clave}`, accept: "application/json" };
}

function configOrThrow(): ConfigSupabaseWeb {
  const config = supabaseDeEntorno();
  if (config === null) throw new ErrorLedger("Falta la configuración de la base de datos en el servidor.");
  return config;
}

export async function leerSimulacion(config: ConfigSupabaseWeb = configOrThrow()): Promise<EstadoSimulacion> {
  const r = await fetch(`${config.url}/rest/v1/ledger_simulacion?select=caida,desde&id=eq.1`, {
    headers: cabeceras(config),
    cache: "no-store",
  });
  if (!r.ok) throw new ErrorLedger(`No se pudo leer la simulación (HTTP ${r.status}).`);
  const fila = ((await r.json()) as { caida: boolean; desde: string | null }[])[0];
  return { caida: fila?.caida === true, desde: fila?.desde ? new Date(fila.desde) : null };
}

// Turns the simulated outage on or off. Turning it on starts the 24-hour clock of the documents issued from now on.
export async function fijarSimulacion(caida: boolean, ahora: Date, config: ConfigSupabaseWeb = configOrThrow()): Promise<void> {
  const r = await fetch(`${config.url}/rest/v1/ledger_simulacion?id=eq.1`, {
    method: "PATCH",
    headers: { ...cabeceras(config), "content-type": "application/json", prefer: "return=minimal" },
    body: JSON.stringify({ caida, desde: caida ? ahora.toISOString() : null, actualizado_en: ahora.toISOString() }),
    cache: "no-store",
  });
  if (!r.ok) throw new ErrorLedger(`No se pudo cambiar la simulación (HTTP ${r.status}).`);
}

// Emission options for a web caller: the simulated outage and the attestation chain, from the database.
export async function opcionesDeEmision(ahora: Date): Promise<OpcionesEmision & { atestaciones: AlmacenAtestaciones }> {
  const config = configOrThrow();
  const sim = await leerSimulacion(config);
  return {
    ahora,
    contingencia: sim.caida ? { desde: sim.desde ?? ahora } : null,
    atestaciones: createAlmacenAtestacionesSupabase(config),
  };
}
