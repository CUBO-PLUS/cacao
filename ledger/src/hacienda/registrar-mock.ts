// Registers the public half of LEDGER_HACIENDA_CLAVE_FIRMA in the svfe-mock-api. Run it once after starting the mock,
// and again whenever the key changes. The real Ministry has no such endpoint: certificates are registered out of band.
//
//   npm run hacienda:registrar

import { configuracionHaciendaDeEntorno, registrarClaveDePrueba } from "./transmitir.ts";

const config = configuracionHaciendaDeEntorno();
if (config === null) {
  process.stderr.write(
    "Falta configurar LEDGER_HACIENDA_URL, LEDGER_HACIENDA_NIT, LEDGER_HACIENDA_CLAVE y LEDGER_HACIENDA_CLAVE_FIRMA.\n",
  );
  process.exit(1);
}

try {
  await registrarClaveDePrueba(config);
  process.stdout.write(`Clave pública registrada en ${config.url} para el NIT ${config.nit}.\n`);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
