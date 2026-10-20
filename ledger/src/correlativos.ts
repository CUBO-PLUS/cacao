import { existsSync } from "node:fs";
import { join } from "node:path";
import { escribirJson, leerJson } from "./datos.ts";

// Last control-number sequence used per serie (for example "01-M001P001"). The CLI keeps it in
// correlativos.json; the web app can pass its own implementation (ledger_correlativos in Supabase).
// A number is only recorded after the document passes validation, so a rejected document does not
// consume one.
export interface FuenteCorrelativos {
  // Last number issued for the serie, 0 when there is none.
  ultimo(serie: string): Promise<number>;
  // Records the number as issued.
  guardar(serie: string, numero: number): Promise<void>;
}

// The number the next document of the serie gets.
export async function siguienteCorrelativo(fuente: FuenteCorrelativos, serie: string): Promise<number> {
  return (await fuente.ultimo(serie)) + 1;
}

// Today's behaviour: correlativos.json inside the data directory, rewritten on every save.
export function correlativosArchivo(datos: string): FuenteCorrelativos {
  const ruta = join(datos, "correlativos.json");
  const leer = (): Record<string, number> => (existsSync(ruta) ? (leerJson(ruta) as Record<string, number>) : {});
  return {
    async ultimo(serie: string): Promise<number> {
      return leer()[serie] ?? 0;
    },
    async guardar(serie: string, numero: number): Promise<void> {
      escribirJson(ruta, { ...leer(), [serie]: numero });
    },
  };
}
