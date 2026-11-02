// Plain-text views for the terminal. Lines stay within 80 columns.
import { formatoSats, formatoUsd } from "./dinero.ts";
import type { Fallo, ResultadoValidacion } from "./validar.ts";
import { descripcionSello, totalDeTicket, type Ticket } from "./ticket.ts";
import { fechaHoraSalvador } from "./tiempo.ts";

const ANCHO = 80;

function recortar(s: string, ancho: number): string {
  return s.length <= ancho ? s : `${s.slice(0, ancho - 1)}…`;
}

function rellenarIzq(s: string, ancho: number): string {
  return s.padStart(ancho);
}

export function vistaTicket(ticket: Ticket): string[] {
  const fecha = fechaHoraSalvador(new Date(ticket.creado));
  const cliente = ticket.cliente === "consumidor" ? "consumidor final (01)" : "contribuyente (03)";
  const total = totalDeTicket(ticket);
  const lineas: string[] = [
    `Ticket ${ticket.id}`,
    `Estado:  ${ticket.estado}`,
    `Cliente: ${cliente}`,
    `Creado:  ${fecha.fecEmi} ${fecha.horEmi} (hora de El Salvador)`,
  ];
  if (ticket.receptor) {
    lineas.push(`Receptor: ${recortar(ticket.receptor.nombre, ANCHO - 10)} (NIT ${ticket.receptor.nit})`);
  }
  lineas.push("", "Descripción                     Cant.   Precio    Importe");
  for (const l of ticket.lineas) {
    const importe = l.precioCentavos * l.cantidad;
    lineas.push(
      `${recortar(l.descripcion, 29).padEnd(29)} ${rellenarIzq(String(l.cantidad), 5)}  ${rellenarIzq(formatoUsd(l.precioCentavos), 8)}  ${rellenarIzq(formatoUsd(importe), 9)}`,
    );
  }
  lineas.push("");
  if (ticket.cliente === "consumidor") {
    lineas.push(`Total con IVA incluido: ${formatoUsd(total.totalCentavos)}`);
    lineas.push(`IVA contenido (13/113): ${formatoUsd(total.ivaCentavos)}   Neto: ${formatoUsd(total.netoCentavos)}`);
  } else {
    lineas.push(`Subtotal sin IVA: ${formatoUsd(total.gravadoCentavos)}   IVA 13%: ${formatoUsd(total.ivaCentavos)}`);
    lineas.push(`Total a pagar: ${formatoUsd(total.totalCentavos)}`);
  }
  if (ticket.pago) {
    if (ticket.pago.rail === "lightning") {
      lineas.push(
        `Pago: Lightning ${formatoUsd(ticket.pago.montoCentavos)} (${formatoSats(ticket.pago.sats)})`,
        `      tasa ${ticket.pago.tasaUsdPorBtc} USD/BTC, hash ${ticket.pago.paymentHash.slice(0, 12)}...`,
      );
    } else {
      lineas.push(`Pago: efectivo ${formatoUsd(ticket.pago.montoCentavos)}`);
    }
  } else {
    lineas.push("Pago: pendiente");
  }
  if (ticket.dte) {
    lineas.push(`Documento: ${ticket.dte.tipoDte} ${ticket.dte.numeroControl}`);
  }
  if (ticket.firma) {
    const prefijo = ticket.firma.jws.slice(0, 24);
    const prueba = ticket.firma.firmaDePrueba ? " · clave de prueba, no válida ante Hacienda" : "";
    lineas.push(`Firma JWS: ${prefijo}… (${ticket.firma.comercioId}, ${ticket.firma.momento})${prueba}`);
  }
  if (ticket.sello) {
    lineas.push(`Sello: ${descripcionSello(ticket.sello)} ${ticket.sello.valor} (recibido ${ticket.sello.momento})`);
  }
  if (ticket.rechazo) {
    lineas.push(`Rechazo: sello simulado no emitido; ${ticket.rechazo.observaciones.length} observación(es) el ${ticket.rechazo.momento}`);
  }
  return lineas;
}

// The layer names say what was checked; the generation line says where each schema came from.
export function informeValidacion(r: ResultadoValidacion, archivo: string): string[] {
  const lineas: string[] = [];
  lineas.push(`Documento tipo ${r.tipoDte ?? "?"}: ${archivo}`);
  lineas.push(`Generación de esquemas: ${r.generacion} (${r.archivoEsquema ?? "sin esquema"}; ${r.origenEsquema ?? ""})`);
  lineas.push(`Esquema${r.archivoEsquema ? ` (${r.archivoEsquema})` : ""}: ${r.esquema.length} fallo(s)`);
  for (const f of r.esquema) lineas.push(...lineaFallo(f));
  lineas.push(`Regla adicional de CacaoLedger: ${r.reglas.length} fallo(s)`);
  for (const f of r.reglas) lineas.push(...lineaFallo(f));
  for (const aviso of r.avisos) lineas.push(`AVISO: ${aviso}`);
  lineas.push(r.ok ? "RESULTADO: VÁLIDO" : "RESULTADO: NO VÁLIDO");
  return lineas;
}

// One failure per line when it fits; the value and rule follow after " | ".
function lineaFallo(f: Fallo): string[] {
  const cuerpo = `  - ${f.ruta}: ${f.mensaje}`;
  const cola = ` | valor ${f.valor} | regla ${f.regla}`;
  const unida = cuerpo + cola;
  if (unida.length <= ANCHO) return [unida];
  return [cuerpo, `    valor ${f.valor} | regla ${f.regla}`];
}

