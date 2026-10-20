import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { leerJson } from "./datos.ts";
import { ErrorLedger } from "./errores.ts";
import { formatoUsd } from "./dinero.ts";
import { fechaHoraSalvador } from "./tiempo.ts";
import type { Ticket } from "./ticket.ts";

// Month-end figures, generated from the tickets and the documents they hold. Only documents
// with a seal count. The books record the document as it was emitted; the figures feed the
// monthly returns and are an aid for the accountant, not a filed return.

// Assumptions and limits of the figures, shown next to them on the web. Kept short and in one place.
export const SUPUESTOS: readonly string[] = [
  "La base del F-14 son los ingresos sin IVA: es un supuesto de cálculo. Confirmalo con tu contador.",
  "Las columnas de los anexos del F-07 todavía no están validadas contra la plantilla oficial.",
  "Los documentos llevan un sello de recepción simulado y no se transmiten al Ministerio de Hacienda.",
];

const NOTA_CIFRAS =
  "Estas cifras salen solo de los tickets de CacaoLedger: no incluyen compras, retenciones ni otros ingresos, " +
  "y son una ayuda para el contador, no una declaración presentada.";

// Pago a cuenta of F-14: 1.75 % of gross income. 175 ten-thousandths of the base.
const PAGO_A_CUENTA_DIEZMILESIMAS = 175;

export interface DocumentoMes {
  tipoDte: "01" | "03";
  fecha: string; // YYYY-MM-DD, date of emission in El Salvador
  numeroControl: string;
  codigoGeneracion: string;
  selloRecepcion?: string | null;
  ticket: string;
  receptorNombre: string | null;
  receptorNrc: string | null;
  receptorNit?: string | null;
  netoCentavos: number; // taxable sales without IVA
  ivaCentavos: number;
  totalCentavos: number; // 01: IVA included, as recorded; 03: net plus IVA
}

export interface NoIncluido {
  ticket: string;
  cliente: string;
  estado: string;
  fecha: string;
  motivo: string;
}

export interface FilaConsumidor {
  fecha: string;
  primerControl: string | null;
  ultimoControl: string | null;
  primerCodigoGeneracion?: string | null;
  ultimoCodigoGeneracion?: string | null;
  cantidad: number;
  ventasGravadasCentavos: number;
}

export interface FilaContribuyente {
  fecha: string;
  numeroControl: string;
  codigoGeneracion: string;
  selloRecepcion?: string;
  receptorNombre: string;
  receptorNrc: string;
  receptorNit?: string;
  netoCentavos: number;
  ivaCentavos: number;
  totalCentavos: number;
}

export interface Cifras {
  f07VentasConsumidorIvaIncluidoCentavos: number;
  f07VentasConsumidorNetoCentavos: number;
  f07DebitoConsumidorCentavos: number;
  f07VentasContribuyentesNetoCentavos: number;
  f07DebitoContribuyentesCentavos: number;
  f07BaseGravadaCentavos: number;
  f07DebitoIvaCentavos: number;
  f14IngresosBrutosCentavos: number;
  f14PagoACuentaCentavos: number;
}

export interface InformeMes {
  mes: string;
  consumidor: { filas: FilaConsumidor[]; cantidad: number; ventasGravadasCentavos: number };
  contribuyentes: { filas: FilaContribuyente[]; cantidad: number; netoCentavos: number; ivaCentavos: number; totalCentavos: number };
  cifras: Cifras;
  noIncluidos: NoIncluido[];
  nota: string;
}

// Half up to the cent: floor((base * 175 + 5000) / 10000) is base * 1.75 % rounded.
export function pagoACuentaCentavos(baseCentavos: number): number {
  return Math.floor((baseCentavos * PAGO_A_CUENTA_DIEZMILESIMAS + 5000) / 10000);
}

export function validarMes(texto: string): string {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(texto)) {
    throw new ErrorLedger(`El mes "${texto}" no tiene la forma YYYY-MM (por ejemplo 2026-10).`);
  }
  return texto;
}

function dolaresACentavos(v: unknown, campo: string): number {
  if (typeof v !== "number" || !Number.isFinite(v)) throw new ErrorLedger(`El documento no trae un monto válido en ${campo}.`);
  return Math.round(v * 100);
}

// Reads the figures a book needs from a stored document. Amounts are cents from here on.
export function documentoDesde(doc: unknown, ticket: string, selloRecepcion?: string | null): DocumentoMes {
  const d = doc as Record<string, any>;
  const ident = d.identificacion ?? {};
  const resumen = d.resumen ?? {};
  const tipo = ident.tipoDte;
  if (tipo !== "01" && tipo !== "03") throw new ErrorLedger(`El documento del ticket ${ticket} no es 01 ni 03.`);
  const fecha = String(ident.fecEmi ?? "");
  if (tipo === "01") {
    const iva = dolaresACentavos(resumen.totalIva, "resumen.totalIva");
    const gravadoIvaIncluido = dolaresACentavos(resumen.totalGravada, "resumen.totalGravada");
    return {
      tipoDte: "01",
      fecha,
      numeroControl: String(ident.numeroControl),
      codigoGeneracion: String(ident.codigoGeneracion),
      selloRecepcion: selloRecepcion ?? null,
      ticket,
      receptorNombre: null,
      receptorNrc: null,
      receptorNit: null,
      netoCentavos: gravadoIvaIncluido - iva,
      ivaCentavos: iva,
      totalCentavos: gravadoIvaIncluido,
    };
  }
  const neto = dolaresACentavos(resumen.totalGravada, "resumen.totalGravada");
  const iva = dolaresACentavos(resumen.tributos?.[0]?.valor, "resumen.tributos[0].valor");
  const total = dolaresACentavos(resumen.montoTotalOperacion, "resumen.montoTotalOperacion");
  return {
    tipoDte: "03",
    fecha,
    numeroControl: String(ident.numeroControl),
    codigoGeneracion: String(ident.codigoGeneracion),
    selloRecepcion: selloRecepcion ?? null,
    ticket,
    receptorNombre: String(d.receptor?.nombre ?? ""),
    receptorNrc: String(d.receptor?.nrc ?? ""),
    receptorNit: d.receptor?.nit ? String(d.receptor.nit) : null,
    netoCentavos: neto,
    ivaCentavos: iva,
    totalCentavos: total,
  };
}

// Reads the stored document of every emitted ticket. A missing file is an error, not a skip:
// a sealed sale without its document would otherwise vanish from the books.
export function leerDocumentosEmitidos(datos: string, tickets: Ticket[]): DocumentoMes[] {
  const documentos: DocumentoMes[] = [];
  for (const t of tickets) {
    if (t.estado !== "emitido" || !t.dte) continue;
    let doc: unknown;
    try {
      doc = leerJson(join(datos, t.dte.archivo));
    } catch {
      throw new ErrorLedger(`No se puede leer el documento del ticket ${t.id} (${t.dte.archivo}).`);
    }
    documentos.push(documentoDesde(doc, t.id, t.sello?.valor ?? null));
  }
  return documentos;
}

function diasDelMes(mes: string): string[] {
  const [anio, m] = mes.split("-").map(Number) as [number, number];
  const cuantos = new Date(Date.UTC(anio, m, 0)).getUTCDate();
  const dias: string[] = [];
  for (let d = 1; d <= cuantos; d++) dias.push(`${mes}-${String(d).padStart(2, "0")}`);
  return dias;
}

// Ordinal of a control number inside its series: the 15 digits at the end.
function correlativo(numeroControl: string): number {
  return Number(numeroControl.slice(-15));
}

// Tickets that hold money but no valid document, for the month of their payment (or creation).
function noIncluidosDelMes(mes: string, tickets: Ticket[]): NoIncluido[] {
  const salida: NoIncluido[] = [];
  for (const t of tickets) {
    if (t.estado === "emitido" || t.estado === "abierto") continue;
    const momento = t.pago?.momento ?? t.creado;
    const fecha = fechaHoraSalvador(new Date(momento)).fecEmi;
    if (fecha.slice(0, 7) !== mes) continue;
    let motivo: string;
    if (t.estado === "rechazado") {
      motivo = `rechazado por la recepción: ${t.rechazo?.observaciones[0] ?? "sin motivo"}`;
    } else if (t.dte) {
      motivo = "documento construido, sin transmitir";
    } else {
      motivo = "pagado y sin documento: nunca se construyó";
    }
    salida.push({ ticket: t.id, cliente: t.cliente, estado: t.estado, fecha, motivo });
  }
  return salida.sort((a, b) => a.fecha.localeCompare(b.fecha) || a.ticket.localeCompare(b.ticket));
}

// Pure: the books and figures of one month from the documents and tickets given.
export function informeMes(mes: string, documentos: DocumentoMes[], tickets: Ticket[]): InformeMes {
  validarMes(mes);
  const ticketsPorId = new Map(tickets.map((t) => [t.id, t]));
  const delMes = documentos.filter((d) => d.fecha.slice(0, 7) === mes);
  const porDia = new Map<string, DocumentoMes[]>();
  for (const d of delMes) {
    const lista = porDia.get(d.fecha) ?? [];
    lista.push(d);
    porDia.set(d.fecha, lista);
  }

  // One row per day of the month, including days without sales.
  const filas: FilaConsumidor[] = diasDelMes(mes).map((dia) => {
    const docs = (porDia.get(dia) ?? []).filter((d) => d.tipoDte === "01").sort((a, b) => correlativo(a.numeroControl) - correlativo(b.numeroControl));
    const primero = docs[0];
    const ultimo = docs[docs.length - 1];
    return {
      fecha: dia,
      primerControl: primero?.numeroControl ?? null,
      ultimoControl: ultimo?.numeroControl ?? null,
      primerCodigoGeneracion: primero?.codigoGeneracion ?? null,
      ultimoCodigoGeneracion: ultimo?.codigoGeneracion ?? null,
      cantidad: docs.length,
      ventasGravadasCentavos: docs.reduce((acc, d) => acc + d.totalCentavos, 0),
    };
  });

  const docs01 = delMes.filter((d) => d.tipoDte === "01");
  const docs03 = delMes
    .filter((d) => d.tipoDte === "03")
    .sort((a, b) => a.fecha.localeCompare(b.fecha) || correlativo(a.numeroControl) - correlativo(b.numeroControl));
  const contribuyentes: FilaContribuyente[] = docs03.map((d) => ({
    fecha: d.fecha,
    numeroControl: d.numeroControl,
    codigoGeneracion: d.codigoGeneracion,
    selloRecepcion: d.selloRecepcion ?? ticketsPorId.get(d.ticket)?.sello?.valor ?? "",
    receptorNombre: d.receptorNombre ?? "",
    receptorNrc: d.receptorNrc ?? "",
    receptorNit: d.receptorNit ?? "",
    netoCentavos: d.netoCentavos,
    ivaCentavos: d.ivaCentavos,
    totalCentavos: d.totalCentavos,
  }));

  const sumar = (docs: DocumentoMes[], f: (d: DocumentoMes) => number) => docs.reduce((acc, d) => acc + f(d), 0);
  const consumidorBruto = sumar(docs01, (d) => d.totalCentavos);
  const consumidorNeto = sumar(docs01, (d) => d.netoCentavos);
  const consumidorIva = sumar(docs01, (d) => d.ivaCentavos);
  const contribuyentesNeto = sumar(docs03, (d) => d.netoCentavos);
  const contribuyentesIva = sumar(docs03, (d) => d.ivaCentavos);
  const baseGravada = sumar(delMes, (d) => d.netoCentavos);
  const debitoIva = sumar(delMes, (d) => d.ivaCentavos);
  const pagoACuenta = pagoACuentaCentavos(baseGravada);

  return {
    mes,
    consumidor: {
      filas,
      cantidad: docs01.length,
      ventasGravadasCentavos: consumidorBruto,
    },
    contribuyentes: {
      filas: contribuyentes,
      cantidad: docs03.length,
      netoCentavos: contribuyentesNeto,
      ivaCentavos: contribuyentesIva,
      totalCentavos: sumar(docs03, (d) => d.totalCentavos),
    },
    cifras: {
      f07VentasConsumidorIvaIncluidoCentavos: consumidorBruto,
      f07VentasConsumidorNetoCentavos: consumidorNeto,
      f07DebitoConsumidorCentavos: consumidorIva,
      f07VentasContribuyentesNetoCentavos: contribuyentesNeto,
      f07DebitoContribuyentesCentavos: contribuyentesIva,
      f07BaseGravadaCentavos: baseGravada,
      f07DebitoIvaCentavos: debitoIva,
      f14IngresosBrutosCentavos: baseGravada,
      f14PagoACuentaCentavos: pagoACuenta,
    },
    noIncluidos: noIncluidosDelMes(mes, tickets),
    nota: NOTA_CIFRAS,
  };
}

// Display helpers. Day in DD/MM/YYYY, the form used in El Salvador.
function fechaCorta(iso: string): string {
  const [a, m, d] = iso.split("-");
  return `${d}/${m}/${a}`;
}

function cifraCsv(centavos: number): string {
  const signo = centavos < 0 ? "-" : "";
  const abs = Math.abs(centavos);
  return `${signo}${Math.floor(abs / 100)},${String(abs % 100).padStart(2, "0")}`;
}

// Decimal period (0.00). Whether the DGII template requires it is not confirmed.
function cifraPuntoCsv(centavos: number): string {
  const signo = centavos < 0 ? "-" : "";
  const abs = Math.abs(centavos);
  return `${signo}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

function sinGuiones(texto: string | null | undefined): string {
  return (texto ?? "").replace(/-/g, "");
}

// A cell that a spreadsheet would read as a formula (=, +, -, @, tab or CR at the start) gets a leading apostrophe.
// Plain numbers such as -1,50 keep their form: they are amounts, not formulas.
const FORMULA_CSV = /^[=+\-@\t\r]/;
const NUMERO_CSV = /^-?\d[\d.,]*$/;

export function celdaCsv(v: string | number | null): string {
  let texto = v === null ? "" : String(v);
  if (FORMULA_CSV.test(texto) && !NUMERO_CSV.test(texto)) texto = `'${texto}`;
  return /[;"\r\n]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto;
}

const BOM = "\uFEFF";

function csv(encabezados: string[], filas: (string | number | null)[][]): string {
  const lineas = [encabezados, ...filas].map((f) => f.map(celdaCsv).join(";"));
  return `${BOM}${lineas.join("\r\n")}\r\n`;
}

// Semicolon-separated, UTF-8 with BOM, decimal comma. A Salvadoran spreadsheet opens it as is.
export function libroConsumidorCsv(informe: InformeMes): string {
  const filas: (string | number | null)[][] = informe.consumidor.filas.map((f) => [
    fechaCorta(f.fecha),
    f.primerControl,
    f.ultimoControl,
    f.cantidad,
    cifraCsv(f.ventasGravadasCentavos),
  ]);
  filas.push(["Total del mes", null, null, informe.consumidor.cantidad, cifraCsv(informe.consumidor.ventasGravadasCentavos)]);
  return csv(["Fecha", "Primer número de control", "Último número de control", "Cantidad de documentos", "Ventas gravadas (IVA incluido)"], filas);
}

export function libroContribuyentesCsv(informe: InformeMes): string {
  const c = informe.contribuyentes;
  const filas: (string | number | null)[][] = c.filas.map((f) => [
    fechaCorta(f.fecha),
    f.numeroControl,
    f.codigoGeneracion,
    f.receptorNombre,
    f.receptorNrc,
    cifraCsv(f.netoCentavos),
    cifraCsv(f.ivaCentavos),
    cifraCsv(f.totalCentavos),
  ]);
  filas.push(["Total del mes", null, null, null, null, cifraCsv(c.netoCentavos), cifraCsv(c.ivaCentavos), cifraCsv(c.totalCentavos)]);
  return csv(
    ["Fecha", "Número de control", "Código de generación", "Nombre del receptor", "NRC del receptor", "Venta gravada neta", "IVA", "Total"],
    filas,
  );
}

// DGII 2021 template, Anexo 1: Detalle de Ventas a Contribuyentes (20 columns A-T). Header-less output is not confirmed.
export function anexoContribuyentesF07Csv(informe: InformeMes): string {
  const filas: (string | number | null)[][] = informe.contribuyentes.filas.map((f) => [
    fechaCorta(f.fecha), // A: Fecha de emisión (DD/MM/YYYY)
    "4", // B: Clase de documento (4 = DTE)
    "03", // C: Tipo de documento (03 = CCF)
    sinGuiones(f.numeroControl), // D: Número de resolución (numeroControl sin guiones)
    sinGuiones(f.selloRecepcion), // E: Serie de documento (selloRecepcion sin guiones)
    sinGuiones(f.codigoGeneracion), // F: Número de documento (codigoGeneracion sin guiones)
    "", // G: Número de control interno (vacío en DTE)
    sinGuiones(f.receptorNit || f.receptorNrc), // H: NIT o NRC del cliente
    f.receptorNombre, // I: Nombre o razón social
    "0.00", // J: Ventas exentas
    "0.00", // K: Ventas no sujetas
    cifraPuntoCsv(f.netoCentavos), // L: Ventas gravadas locales
    cifraPuntoCsv(f.ivaCentavos), // M: Débito fiscal (13 % IVA)
    "0.00", // N: Ventas a cuenta de terceros no domiciliados
    "0.00", // O: Débito fiscal por venta a cuenta de terceros
    cifraPuntoCsv(f.totalCentavos), // P: Total ventas
    "", // Q: DUI del cliente (vacío cuando hay NIT/NRC)
    "1", // R: Tipo de operación Renta (1 = Gravada; fixed value not confirmed)
    "3", // S: Tipo de ingreso Renta (3 = Comercial; fixed value not confirmed)
    "1", // T: Número de anexo (1)
  ]);
  const lineas = filas.map((f) => f.map(celdaCsv).join(";"));
  return lineas.length > 0 ? `${lineas.join("\r\n")}\r\n` : "";
}

// DGII 2021 template, Anexo 2: Detalle de Ventas a Consumidor Final (23 columns A-W). Header-less output is not confirmed.
// Only days with emitted 01 documents are uploaded to the DGII portal, grouped by day.
export function anexoConsumidorF07Csv(informe: InformeMes): string {
  const filas: (string | number | null)[][] = informe.consumidor.filas
    .filter((f) => f.cantidad > 0)
    .map((f) => [
      fechaCorta(f.fecha), // A: Fecha de emisión (DD/MM/YYYY)
      "4", // B: Clase de documento (4 = DTE)
      "01", // C: Tipo de documento (01 = Factura)
      "N/A", // D: Número de resolución
      "N/A", // E: Serie de documento
      "N/A", // F: Número de control interno (Del)
      "N/A", // G: Número de control interno (Al)
      sinGuiones(f.primerCodigoGeneracion ?? f.primerControl), // H: Número de documento (Del)
      sinGuiones(f.ultimoCodigoGeneracion ?? f.ultimoControl), // I: Número de documento (Al)
      "", // J: N° de máquina registradora
      "0.00", // K: Ventas exentas
      "0.00", // L: Ventas internas exentas no sujetas a proporcionalidad
      "0.00", // M: Ventas no sujetas
      cifraPuntoCsv(f.ventasGravadasCentavos), // N: Ventas gravadas locales (IVA incluido)
      "0.00", // O: Exportaciones dentro del área centroamericana
      "0.00", // P: Exportaciones fuera del área centroamericana
      "0.00", // Q: Exportaciones de servicios
      "0.00", // R: Ventas a zonas francas y DPA (tasa cero)
      "0.00", // S: Ventas a cuenta de terceros no domiciliados
      cifraPuntoCsv(f.ventasGravadasCentavos), // T: Total ventas (IVA incluido)
      "1", // U: Tipo de operación Renta (1 = Gravada; fixed value not confirmed)
      "3", // V: Tipo de ingreso Renta (3 = Comercial; fixed value not confirmed)
      "2", // W: Número de anexo (2)
    ]);
  const lineas = filas.map((f) => f.map(celdaCsv).join(";"));
  return lineas.length > 0 ? `${lineas.join("\r\n")}\r\n` : "";
}

export function nombresLibros(mes: string): {
  consumidor: string;
  contribuyentes: string;
  anexo1: string;
  anexo2: string;
} {
  return {
    consumidor: `libro-consumidor-final-01_${mes}.csv`,
    contribuyentes: `libro-contribuyentes-03_${mes}.csv`,
    anexo1: `anexo-1-contribuyentes-f07_${mes}.csv`,
    anexo2: `anexo-2-consumidor-final-f07_${mes}.csv`,
  };
}

export function escribirLibrosCsv(carpeta: string, informe: InformeMes): string[] {
  mkdirSync(carpeta, { recursive: true });
  const nombres = nombresLibros(informe.mes);
  const rutas = [
    join(carpeta, nombres.consumidor),
    join(carpeta, nombres.contribuyentes),
    join(carpeta, nombres.anexo1),
    join(carpeta, nombres.anexo2),
  ];
  writeFileSync(rutas[0] as string, libroConsumidorCsv(informe), "utf8");
  writeFileSync(rutas[1] as string, libroContribuyentesCsv(informe), "utf8");
  writeFileSync(rutas[2] as string, anexoContribuyentesF07Csv(informe), "utf8");
  writeFileSync(rutas[3] as string, anexoConsumidorF07Csv(informe), "utf8");
  return rutas;
}

function tabla(encabezados: string[], filas: string[][], alineacion: ("izq" | "der")[]): string[] {
  const todas = [encabezados, ...filas];
  const anchos = encabezados.map((_, i) => Math.max(...todas.map((f) => (f[i] ?? "").length)));
  const linea = (f: string[]) =>
    f
      .map((celda, i) => (alineacion[i] === "der" ? celda.padStart(anchos[i] ?? 0) : celda.padEnd(anchos[i] ?? 0)))
      .join("  ")
      .trimEnd();
  return [linea(encabezados), ...filas.map(linea)];
}

function plural(n: number): string {
  return `${n} ${n === 1 ? "documento" : "documentos"}`;
}

// Terminal view of the month: the two books, the figures with the form they feed, and what was left out.
export function lineasMes(informe: InformeMes): string[] {
  const lineas: string[] = [`Libros de IVA · ${informe.mes} (hora de El Salvador)`, ""];
  lineas.push("Libro de ventas a consumidor final (documentos 01)");
  const filasC = informe.consumidor.filas.map((f) => [
    fechaCorta(f.fecha),
    f.primerControl ?? "sin ventas",
    f.ultimoControl ?? "",
    String(f.cantidad),
    f.cantidad > 0 ? formatoUsd(f.ventasGravadasCentavos) : "",
  ]);
  lineas.push(...tabla(["Fecha", "Primer control", "Último control", "Docs", "Ventas gravadas (IVA incl.)"], filasC, ["izq", "izq", "izq", "der", "der"]));
  lineas.push(`Total del mes: ${plural(informe.consumidor.cantidad)}, ${formatoUsd(informe.consumidor.ventasGravadasCentavos)}`);
  lineas.push("");

  lineas.push("Libro de ventas a contribuyentes (documentos 03)");
  if (informe.contribuyentes.filas.length === 0) {
    lineas.push("  No hay comprobantes de crédito fiscal emitidos este mes.");
  } else {
    const filasK = informe.contribuyentes.filas.map((f) => [
      fechaCorta(f.fecha),
      f.numeroControl,
      f.codigoGeneracion,
      f.receptorNombre,
      f.receptorNrc,
      formatoUsd(f.netoCentavos),
      formatoUsd(f.ivaCentavos),
      formatoUsd(f.totalCentavos),
    ]);
    lineas.push(
      ...tabla(
        ["Fecha", "Número de control", "Código de generación", "Receptor", "NRC", "Neto", "IVA", "Total"],
        filasK,
        ["izq", "izq", "izq", "izq", "izq", "der", "der", "der"],
      ),
    );
  }
  lineas.push(
    `Total del mes: ${plural(informe.contribuyentes.cantidad)}, neto ${formatoUsd(informe.contribuyentes.netoCentavos)}, ` +
      `IVA ${formatoUsd(informe.contribuyentes.ivaCentavos)}, total ${formatoUsd(informe.contribuyentes.totalCentavos)}`,
  );
  lineas.push("");

  const c = informe.cifras;
  lineas.push("Cifras para las declaraciones (F-07 y F-14 v17)");
  lineas.push(
    ...tabla(
      ["Cifra", "Monto", "Formulario"],
      [
        ["Ventas a contribuyentes, sin IVA", formatoUsd(c.f07VentasContribuyentesNetoCentavos), "F-07, ventas gravadas a contribuyentes (Anexo 1)"],
        ["Ventas a consumidor final, sin IVA", formatoUsd(c.f07VentasConsumidorNetoCentavos), "F-07, ventas gravadas a consumidor final, neto (Anexo 2 / 1.13)"],
        ["Base gravada del mes, sin IVA", formatoUsd(c.f07BaseGravadaCentavos), "F-07, ventas gravadas (base total sin IVA)"],
        ["Débito fiscal de IVA del mes (13 %)", formatoUsd(c.f07DebitoIvaCentavos), "F-07, débito fiscal (por contribuyentes y por consumidor final)"],
        ["Ingresos brutos del mes, sin IVA", formatoUsd(c.f14IngresosBrutosCentavos), "F-14, base del pago a cuenta (Art. 151 CT, pago a cuenta, por confirmar; sin IVA es supuesto)"],
        ["Pago a cuenta de 1.75 %", formatoUsd(c.f14PagoACuentaCentavos), "F-14, pago a cuenta (1.75 % por rama económica)"],
      ],
      ["izq", "der", "izq"],
    ),
  );
  lineas.push(informe.nota);
  lineas.push(
    "F-07: dentro de los primeros 10 días hábiles del mes siguiente (por confirmar). F-14: pago a cuenta, Art. 151 CT (por confirmar). La versión 14 del F-07 figura como borrador en mh.gob.sv.",
  );
  lineas.push("");

  lineas.push("No incluidos: no tienen documento válido con sello (Art. 119-C CT)");
  if (informe.noIncluidos.length === 0) {
    lineas.push("  Ninguno este mes.");
  } else {
    for (const n of informe.noIncluidos) {
      lineas.push(`  ${n.ticket}  ${fechaCorta(n.fecha)}  ${n.cliente}  ${n.estado}  ${n.motivo}`);
    }
  }
  return lineas;
}
