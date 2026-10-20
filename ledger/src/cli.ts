#!/usr/bin/env node
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  adjuntarDte,
  adjuntarFirma,
  aceptarDte,
  crearTicket,
  guardarTicket,
  leerTicket,
  listarTickets,
  rechazarDte,
  registrarPago,
  ticketConHashDePago,
  totalDeTicket,
  validarEntrada,
  validarId,
  validarReceptor,
  type EntradaTicket,
  type FirmaDte,
  type LineaTicket,
  type Ticket,
} from "./ticket.ts";
import {
  claveMaestraDeEntorno,
  descifrarMaterialComercio,
  leerClavePrivadaPem,
  leerIndiceComercios,
  registrarComercio,
  resolverComercioActivo,
} from "./comercio/almacen.ts";
import { firmarDocumentoSvfe, resolverUrlFirmador } from "./firma/svfe-firmador.ts";
import { importarOrdenMarket } from "./market.ts";
import { importarFacturaBtcpay, leerFacturasArchivo } from "./btcpay.ts";
import { almacenArchivos } from "./almacen/archivos.ts";
import { correlativosArchivo, siguienteCorrelativo } from "./correlativos.ts";
import { configDesdeEntorno, ErrorBtcpay, facturasPagadas, type Factura } from "./pagos/btcpay-api.ts";
import { escribirLibrosCsv, informeMes, leerDocumentosEmitidos, lineasMes, validarMes } from "./mes.ts";
import { generarSitio } from "./web/generar.ts";
import { centavosDesdeTexto, formatoSats, formatoUsd } from "./dinero.ts";
import { dirDatos, escribirJson, leerJson, raizLedger } from "./datos.ts";
import { ErrorLedger } from "./errores.ts";
import { pagoDesdeBlink } from "./pagos/blink.ts";
import { pagoEfectivo } from "./pagos/efectivo.ts";
import type { Pago } from "./pagos/tipos.ts";
import { construirDte, type Emisor } from "./dte/construir.ts";
import { informeValidacion, vistaTicket } from "./presentar.ts";
import { validarDte } from "./validar.ts";
import { fechaHoraSalvador } from "./tiempo.ts";
import { ahora } from "./azar.ts";
import { resolverGeneracion, type Generacion } from "./generacion.ts";
import { recibir } from "./recepcion-simulada.ts";
import { atestacionesDeTicket, exportarCabeza, leerAtestaciones, registrarAtestacion, verificarCadena } from "./atestacion.ts";
import { AYUDA_CIERRE, clasificarCierre, lineasCierre } from "./cierre.ts";
import { ejecutarDemo } from "./demo.ts";

// Option names that take a value. Everything else starting with -- is a switch.
const CON_VALOR = new Set([
  "datos",
  "emisor",
  "desde",
  "linea",
  "cliente",
  "receptor",
  "blink",
  "forzar-codigo",
  "ambiente",
  "esquemas",
  "csv",
  "salida",
  "dia",
  "comercio",
  "nit",
  "password-pri",
  "clave-privada",
  "firmador-url",
  "archivo",
]);
const INTERRUPTORES = new Set(["json", "efectivo", "confirmar-produccion", "ayuda", "simulado"]);

interface Argumentos {
  posicionales: string[];
  valores: Map<string, string[]>;
  interruptores: Set<string>;
}

function leerArgumentos(args: string[]): Argumentos {
  const posicionales: string[] = [];
  const valores = new Map<string, string[]>();
  const interruptores = new Set<string>();
  for (let i = 0; i < args.length; i++) {
    const a = args[i] ?? "";
    if (!a.startsWith("--")) {
      posicionales.push(a);
      continue;
    }
    const nombre = a.slice(2);
    if (INTERRUPTORES.has(nombre)) {
      interruptores.add(nombre);
    } else if (CON_VALOR.has(nombre)) {
      const v = args[i + 1];
      if (v === undefined || v.startsWith("--")) throw new ErrorLedger(`La opción --${nombre} necesita un valor.`);
      valores.set(nombre, [...(valores.get(nombre) ?? []), v]);
      i++;
    } else {
      throw new ErrorLedger(`Opción desconocida: --${nombre}.`);
    }
  }
  return { posicionales, valores, interruptores };
}

function unico(a: Argumentos, nombre: string): string | undefined {
  const v = a.valores.get(nombre);
  return v?.[v.length - 1];
}

interface Resultado {
  datos: unknown;
  lineas: string[];
  // Shown as the last line when the command failed on a document check.
  fallo?: string;
}

// The emisor fixture depends on the generation: the caso schemas need tipoEstablecimiento
// and pre-reform municipio codes, so the caso run uses its own fixture.
function leerEmisor(a: Argumentos, generacion: Generacion): Emisor {
  const porDefecto = generacion === "caso" ? join("fixtures", "caso", "emisor.json") : join("fixtures", "emisor.json");
  const ruta = resolve(unico(a, "emisor") ?? join(raizLedger(), porDefecto));
  return leerJson(ruta) as Emisor;
}

function leerReceptorArchivo(ruta: string) {
  return validarReceptor(leerJson(resolve(ruta)));
}

// "Café|2|1.13" -> line. The last two fields are quantity and price; the rest is the description.
function lineaDesdeFlag(texto: string): LineaTicket {
  const partes = texto.split("|");
  if (partes.length < 3) throw new ErrorLedger(`La línea "${texto}" debe tener la forma descripción|cantidad|precio.`);
  const precio = partes[partes.length - 1] ?? "";
  const cantidadTexto = partes[partes.length - 2] ?? "";
  const descripcion = partes.slice(0, -2).join("|").trim();
  if (!/^\d+$/.test(cantidadTexto)) throw new ErrorLedger(`La cantidad de "${texto}" debe ser un entero.`);
  return { descripcion, cantidad: Number(cantidadTexto), precioCentavos: centavosDesdeTexto(precio) };
}

function entradaDesdeArgumentos(a: Argumentos): EntradaTicket {
  const desde = unico(a, "desde");
  if (desde) return validarEntrada(leerJson(resolve(desde)));
  const cliente = unico(a, "cliente");
  const lineas = (a.valores.get("linea") ?? []).map(lineaDesdeFlag);
  const receptorArchivo = unico(a, "receptor");
  if (cliente === "contribuyente" && !receptorArchivo) {
    throw new ErrorLedger("Un ticket de contribuyente necesita --receptor <archivo.json> con los datos fiscales del receptor.");
  }
  return validarEntrada({
    cliente,
    receptor: receptorArchivo ? leerReceptorArchivo(receptorArchivo) : undefined,
    lineas: lineas.map((l) => ({ descripcion: l.descripcion, cantidad: l.cantidad, precioCentavos: l.precioCentavos })),
  });
}

function cmdTicketNuevo(a: Argumentos, datos: string): Resultado {
  const entrada = entradaDesdeArgumentos(a);
  const ticket = crearTicket(entrada, ahora());
  guardarTicket(datos, ticket);
  return { datos: ticket, lineas: vistaTicket(ticket) };
}

function cmdTicketVer(id: string, datos: string): Resultado {
  const ticket = leerTicket(datos, id);
  return { datos: ticket, lineas: vistaTicket(ticket) };
}

function cmdTicketLista(datos: string): Resultado {
  const tickets = listarTickets(datos);
  const lineas = tickets.length === 0 ? ["No hay tickets todavía."] : tickets.map(
    (t) => `${t.id}  ${t.estado.padEnd(9)} ${t.cliente.padEnd(12)} ${formatoUsd(totalDeTicket(t).totalCentavos)}`,
  );
  return { datos: tickets, lineas };
}

function cmdPagar(id: string, a: Argumentos, datos: string): Resultado {
  const blink = unico(a, "blink");
  const efectivo = a.interruptores.has("efectivo");
  if ((blink === undefined) === !efectivo) {
    throw new ErrorLedger("Indicá el pago con --blink <archivo.json> o con --efectivo, no con ambos ni con ninguno.");
  }
  const ticket = leerTicket(datos, id);
  let pago: Pago;
  if (blink !== undefined) {
    pago = pagoDesdeBlink(leerJson(resolve(blink)));
    if (pago.rail === "lightning") {
      const otro = ticketConHashDePago(datos, pago.paymentHash, ticket.id);
      if (otro) throw new ErrorLedger(`Ese pago de Lightning ya cubre el ticket ${otro}; no se puede usar dos veces.`);
    }
  } else {
    pago = pagoEfectivo(totalDeTicket(ticket).totalCentavos, ahora());
  }
  const pagado = registrarPago(ticket, pago, ahora());
  guardarTicket(datos, pagado);
  const lineas = [
    `Pago registrado en ${pagado.id}: ${formatoUsd(pago.montoCentavos)}` +
      (pago.rail === "lightning" ? ` (${formatoSats(pago.sats)}) por Lightning` : " en efectivo"),
  ];
  if (pago.rail === "lightning") lineas.push(`Tasa: ${pago.tasaUsdPorBtc} USD/BTC. Hash ${pago.paymentHash}`);
  return { datos: pagado, lineas };
}

function nombreArchivoDte(tipo: string, codigo: string): string {
  return `${tipo}-${codigo}.json`;
}

function lineaGeneracion(generacion: Generacion, archivo: string | null, origen: string | null): string {
  return `Generación de esquemas: ${generacion} (${archivo ?? "sin esquema"}; ${origen ?? ""})`;
}

async function cmdDteConstruir(id: string, a: Argumentos, datos: string): Promise<Resultado> {
  const ticket = leerTicket(datos, id);
  if (ticket.estado !== "pagado" || ticket.pago === null) {
    throw new ErrorLedger(`El ticket ${id} está ${ticket.estado}; hay que pagarlo antes de construir el documento.`);
  }
  if (ticket.dte) throw new ErrorLedger(`El ticket ${id} ya tiene el documento ${ticket.dte.numeroControl}.`);
  const generacion = resolverGeneracion(unico(a, "esquemas"));
  const emisor = leerEmisor(a, generacion);
  const tipo = ticket.cliente === "consumidor" ? "01" : "03";
  const ambienteTexto = unico(a, "ambiente") ?? "00";
  if (ambienteTexto !== "00" && ambienteTexto !== "01") throw new ErrorLedger('El ambiente debe ser "00" (prueba) o "01" (producción).');
  const ambiente = ambienteTexto;
  const forzar = unico(a, "forzar-codigo");
  const claveSerie = `${tipo}-${emisor.codEstable}${emisor.codPuntoVenta}`;
  const correlativos = correlativosArchivo(datos);
  const siguiente = await siguienteCorrelativo(correlativos, claveSerie);
  const instante = ahora();
  const confirmarProduccion = a.interruptores.has("confirmar-produccion");

  const construido = construirDte(tipo, ticket, ticket.pago, emisor, {
    ambiente,
    confirmarProduccion,
    ahora: instante,
    correlativo: siguiente,
    forzarCodigo: forzar,
    generacion,
  });
  const nombre = nombreArchivoDte(tipo, construido.codigoGeneracion);
  const validacion = validarDte(construido.documento, { permitirProduccion: confirmarProduccion, generacion });

  if (!validacion.ok) {
    // Keep the rejected file for inspection. It never becomes the ticket's document.
    const ruta = join(datos, "dte", "rechazados", nombre);
    escribirJson(ruta, construido.documento);
    const lineas = informeValidacion(validacion, ruta);
    return {
      datos: { tipoDte: tipo, generacion, valido: false, esquema: validacion.esquema, reglas: validacion.reglas, avisos: validacion.avisos, archivo: ruta },
      lineas,
      fallo: `El documento ${tipo} no pasó la validación; el ticket ${id} sigue sin documento.`,
    };
  }

  const ruta = join(datos, "dte", nombre);
  escribirJson(ruta, construido.documento);
  await correlativos.guardar(claveSerie, siguiente);
  if (ticket.pago.rail === "lightning") {
    // The DTE has no field for the rate. The attestation keeps what it cannot hold.
    registrarAtestacion(datos, {
      ticket: ticket.id,
      codigoGeneracion: construido.codigoGeneracion,
      numeroControl: construido.numeroControl,
      tipoDte: tipo,
      generacion,
      momentoPago: ticket.pago.momento,
      sats: ticket.pago.sats,
      usdCentavos: ticket.pago.montoCentavos,
      tasaUsdPorBtc: ticket.pago.tasaUsdPorBtc,
      tasaFuente: ticket.pago.tasaFuente,
      paymentHash: ticket.pago.paymentHash,
      codigoFormaPago: construido.formaPago.codigo,
      referencia: construido.formaPago.referencia,
      registrada: instante.toISOString(),
    });
  }
  const ref = {
    tipoDte: tipo,
    codigoGeneracion: construido.codigoGeneracion,
    numeroControl: construido.numeroControl,
    ambiente,
    archivo: `dte/${nombre}`,
  } as const;
  const conDte = adjuntarDte(ticket, ref, instante);
  guardarTicket(datos, conDte);
  const totales = construido.totales;
  const fecha = fechaHoraSalvador(instante);
  const lineas = [
    `Documento ${tipo} creado y validado (ambiente ${ambiente === "00" ? "00, prueba" : "01, producción"}).`,
    lineaGeneracion(generacion, validacion.archivoEsquema, validacion.origenEsquema),
    `  Número de control: ${construido.numeroControl}`,
    `  Código de generación: ${construido.codigoGeneracion}`,
    `  Fecha de emisión: ${fecha.fecEmi} ${fecha.horEmi}`,
    `  Forma de pago: ${construido.formaPago.codigo}${construido.formaPago.referencia ? ` · ${construido.formaPago.referencia}` : ""}`,
    `  Total: ${formatoUsd(totales.totalCentavos)}` +
      (conDte.pago?.rail === "lightning" ? ` (${formatoSats(conDte.pago.sats)})` : ""),
    `  Archivo: ${ruta}`,
    ...validacion.avisos.map((t) => `AVISO: ${t}`),
    "Pendiente: transmisión real a Hacienda. Usá dte transmitir <id> --simulado para el ciclo de prueba.",
  ];
  return { datos: { ...ref, valido: true, generacion, archivo: ruta, totales: { ...totales }, avisos: validacion.avisos }, lineas };
}

function cmdDteValidar(objetivo: string, a: Argumentos, datos: string): Resultado {
  let ruta: string;
  if (existsSync(objetivo)) {
    ruta = resolve(objetivo);
  } else if (/^TK-\d{8}-[0-9A-F]{4}$/.test(objetivo)) {
    validarId(objetivo);
    const ticket = leerTicket(datos, objetivo);
    if (!ticket.dte) throw new ErrorLedger(`El ticket ${objetivo} todavía no tiene documento.`);
    ruta = join(datos, ticket.dte.archivo);
  } else {
    throw new ErrorLedger(`No existe el archivo "${objetivo}" y no es un identificador de ticket.`);
  }
  const doc = leerJson(ruta);
  const generacion = resolverGeneracion(unico(a, "esquemas"));
  const r = validarDte(doc, { permitirProduccion: a.interruptores.has("confirmar-produccion"), generacion });
  const lineas = informeValidacion(r, ruta);
  return {
    datos: { tipoDte: r.tipoDte, generacion, valido: r.ok, esquema: r.esquema, reglas: r.reglas, avisos: r.avisos, archivo: ruta },
    lineas,
    fallo: r.ok ? undefined : "El documento no es válido.",
  };
}

function cmdComercioRegistrar(id: string, a: Argumentos, datos: string): Resultado {
  const nit = needArg(unico(a, "nit"), "NIT de 14 dígitos (--nit)");
  const passwordPri = needArg(unico(a, "password-pri"), "contraseña de la clave privada (--password-pri)");
  const rutaClave = needArg(unico(a, "clave-privada"), "archivo PEM (--clave-privada)");
  const claveMaestra = claveMaestraDeEntorno();
  const pem = leerClavePrivadaPem(resolve(rutaClave));
  const registro = registrarComercio(
    datos,
    id,
    nit,
    { passwordPri, clavePrivadaPem: pem },
    claveMaestra,
    ahora(),
  );
  return {
    datos: { id: registro.id, nit: registro.nit, creado: registro.creado },
    lineas: [
      `Comercio "${registro.id}" registrado (NIT ${registro.nit}).`,
      "Las credenciales quedaron cifradas en datos/comercios/; la clave maestra no se guardó en disco.",
      "El firmador del Ministerio debe tener el .crt de ese NIT montado aparte; CacaoLedger no lo sube.",
    ],
  };
}

function cmdComercioLista(datos: string): Resultado {
  const indice = leerIndiceComercios(datos);
  const lineas =
    indice.comercios.length === 0
      ? ["No hay comercios registrados."]
      : [
          `Comercio activo: ${indice.comercioActivo ?? "(ninguno)"}`,
          ...indice.comercios.map((c) => `  ${c.id} · NIT ${c.nit} · ${c.creado}`),
        ];
  return { datos: indice, lineas };
}

async function cmdDteFirmar(id: string, a: Argumentos, datos: string): Promise<Resultado> {
  validarId(id);
  const ticket = leerTicket(datos, id);
  if (!ticket.dte) throw new ErrorLedger(`El ticket ${id} todavía no tiene documento; construilo con dte construir.`);
  if (ticket.firma) throw new ErrorLedger(`El ticket ${id} ya tiene firma JWS.`);
  const comercioId = resolverComercioActivo(datos, unico(a, "comercio"));
  const claveMaestra = claveMaestraDeEntorno();
  const material = descifrarMaterialComercio(datos, comercioId, claveMaestra);
  const nitComercio = leerIndiceComercios(datos).comercios.find((c) => c.id === comercioId)!.nit;
  const doc = leerJson(join(datos, ticket.dte.archivo));
  const url = resolverUrlFirmador(unico(a, "firmador-url"));
  const instante = ahora();
  const jws = await firmarDocumentoSvfe(url, {
    nit: nitComercio,
    passwordPri: material.passwordPri,
    dteJson: doc,
  });
  const nombre = `dte/firmas/${ticket.dte.codigoGeneracion}.jws.txt`;
  escribirJson(join(datos, nombre), { jws, comercioId, firmadorUrl: url, momento: instante.toISOString() });
  const firma: FirmaDte = {
    jws,
    momento: instante.toISOString(),
    firmadorUrl: url,
    comercioId,
    archivo: nombre,
  };
  guardarTicket(datos, adjuntarFirma(ticket, firma, instante));
  return {
    datos: { ticket: id, comercioId, firmadorUrl: url, jwsPrefijo: jws.slice(0, 32), archivo: join(datos, nombre) },
    lineas: [
      `Documento firmado con el firmador en ${url}.`,
      `JWS (inicio): ${jws.slice(0, 48)}…`,
      `Comercio: ${comercioId} (NIT ${nitComercio}).`,
      `Archivo: ${join(datos, nombre)}`,
      "Este JWS no se transmitió al Ministerio. Podés seguir con dte transmitir --simulado.",
    ],
  };
}

function cmdDteTransmitir(id: string, a: Argumentos, datos: string): Resultado {
  if (!a.interruptores.has("simulado")) {
    throw new ErrorLedger(
      "La transmisión real a Hacienda no está implementada. Para probar el ciclo completo usá: ledger dte transmitir <id> --simulado",
    );
  }
  validarId(id);
  const ticket = leerTicket(datos, id);
  if (!ticket.dte) throw new ErrorLedger(`El ticket ${id} todavía no tiene documento; construilo con dte construir.`);
  if (ticket.estado === "emitido") throw new ErrorLedger(`El ticket ${id} ya está emitido con sello simulado.`);
  if (ticket.estado !== "pagado" && ticket.estado !== "rechazado") {
    throw new ErrorLedger(`El ticket ${id} está ${ticket.estado}; no se puede transmitir.`);
  }
  const doc = leerJson(join(datos, ticket.dte.archivo));
  const instante = ahora();
  const respuesta = recibir(doc, instante);
  if (respuesta.aceptado && respuesta.sello) {
    const emitido = aceptarDte(ticket, { valor: respuesta.sello, momento: respuesta.momento, simulado: true }, instante);
    guardarTicket(datos, emitido);
    return {
      datos: { ticket: id, estado: "emitido", selloSimulado: respuesta.sello, recepcion: respuesta.momento, simulado: true },
      lineas: [
        "Recepción simulada: documento aceptado.",
        `Sello: sello simulado ${respuesta.sello}`,
        `Recibido: ${respuesta.momento} (UTC)`,
        `Ticket ${id} emitido. Ese sello es simulado: ningún servicio del Ministerio lo emitió.`,
      ],
    };
  }
  const rechazado = rechazarDte(ticket, respuesta.observaciones, instante);
  guardarTicket(datos, rechazado);
  return {
    datos: { ticket: id, estado: "rechazado", observaciones: respuesta.observaciones, momentoRechazo: respuesta.momento, simulado: true },
    lineas: [
      "Recepción simulada: documento rechazado.",
      ...respuesta.observaciones.map((o) => `  - ${o}`),
      `Ticket ${id} rechazado el ${respuesta.momento} (UTC). Tiene 24 horas (cifra por confirmar) para reenviarlo.`,
    ],
    fallo: `El documento fue rechazado; el ticket ${id} queda rechazado con 24 horas de plazo (cifra por confirmar).`,
  };
}

function cmdAtestacion(orden: string | undefined, resto: string[], a: Argumentos, datos: string): Resultado {
  if (orden === "ver") {
    const id = needArg(resto[0], "identificador del ticket");
    validarId(id);
    const registros = atestacionesDeTicket(datos, id);
    if (registros.length === 0) return { datos: [], lineas: [`No hay atestaciones para el ticket ${id}.`] };
    const lineas: string[] = [];
    for (const r of registros) {
      lineas.push(
        `Atestación de ${r.ticket} · ${r.numeroControl}`,
        `  Código de generación: ${r.codigoGeneracion}`,
        `  Pago: ${formatoUsd(r.usdCentavos)} (${formatoSats(r.sats)}) el ${r.momentoPago}`,
        `  Tasa: ${r.tasaUsdPorBtc} USD/BTC (${r.tasaFuente})`,
        `  Hash de pago: ${r.paymentHash}`,
        `  Forma de pago emitida: ${r.codigoFormaPago}${r.referencia ? ` · ${r.referencia}` : ""}`,
        `  Registro: ${r.hash}`,
      );
    }
    return { datos: registros, lineas };
  }
  if (orden === "verificar") {
    const v = verificarCadena(datos);
    const lineas = v.ok
      ? [`Cadena íntegra: ${v.registros} ${v.registros === 1 ? "registro" : "registros"}.`, `Cabeza: ${v.cabeza}`]
      : [`Cadena rota en la línea ${v.primerRoto?.linea}: ${v.primerRoto?.motivo}.`, `Registros antes del fallo: ${(v.primerRoto?.linea ?? 1) - 1}.`];
    return {
      datos: v,
      lineas,
      fallo: v.ok ? undefined : "La cadena de atestaciones no es íntegra.",
    };
  }
  if (orden === "exportar") {
    const e = exportarCabeza(datos);
    return { datos: e, lineas: [`Cabeza de la cadena: ${e.cabeza}`, `Registros: ${e.registros}`, "Guardá la cabeza fuera de esta carpeta para detectar borrados al final."] };
  }
  throw new ErrorLedger('Orden de atestación desconocida. Usá "atestacion ver <ticket>", "atestacion verificar" o "atestacion exportar".');
}

function cmdCierre(fechaTexto: string | undefined, a: Argumentos, datos: string): Resultado {
  const fecha = fechaTexto ?? fechaHoraSalvador(ahora()).fecEmi;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) throw new ErrorLedger(`La fecha "${fecha}" no tiene la forma YYYY-MM-DD.`);
  const tickets: Ticket[] = listarTickets(datos);
  const informe = clasificarCierre({ fecha, ahora: ahora(), tickets, atestaciones: leerAtestaciones(datos) });
  return {
    datos: informe,
    lineas: lineasCierre(informe),
    fallo: informe.todosConSello ? undefined : "Hay cobros sin documento válido; revisá la lista.",
  };
}

function cmdImportar(origen: string | undefined, archivo: string | undefined, datos: string): Resultado {
  if (origen !== "market") {
    throw new ErrorLedger('Origen de importación desconocido. Usá "importar market <archivo.json>" o "importar btcpay".');
  }
  const ruta = needArg(archivo, "archivo del pedido");
  const r = importarOrdenMarket(datos, leerJson(resolve(ruta)), ahora());
  const numero = r.ticket.origen?.numero ?? "";
  const cabecera = r.nueva
    ? `Pedido de CacaoMarket ${numero} importado como ticket ${r.ticket.id}.`
    : `El pedido ${numero} ya estaba importado como ${r.ticket.id}; no se creó otro ticket.`;
  return { datos: { ...r.ticket, nueva: r.nueva }, lineas: [cabecera, ...vistaTicket(r.ticket)] };
}

const CODIGO_CONFIGURACION = 2;
const VARIABLES_BTCPAY = ["LEDGER_BTCPAY_URL", "LEDGER_BTCPAY_API_KEY", "LEDGER_BTCPAY_TIENDAS"];

// importar btcpay: reads the settled invoices of the stores (or of --archivo) and prints one line each.
// Exit code 2 means the BTCPay settings are missing; nothing was read.
async function cmdImportarBtcpay(a: Argumentos, datos: string, json: boolean): Promise<number> {
  const archivo = unico(a, "archivo");
  const desde = unico(a, "desde");
  if (archivo !== undefined && desde !== undefined) {
    throw new ErrorLedger("--desde no se usa con --archivo: el archivo ya trae las facturas que se importan.");
  }
  if (desde !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(desde)) {
    throw new ErrorLedger(`La fecha "${desde}" no tiene la forma YYYY-MM-DD.`);
  }
  // Start of that day in El Salvador (UTC-6, no daylight saving).
  const inicio = desde === undefined ? undefined : new Date(`${desde}T00:00:00-06:00`);

  let facturas: Factura[];
  if (archivo !== undefined) {
    facturas = leerFacturasArchivo(leerJson(resolve(archivo)));
  } else {
    const faltan = VARIABLES_BTCPAY.filter((v) => (process.env[v] ?? "").trim() === "");
    if (faltan.length > 0) {
      process.stderr.write(`error: faltan variables de entorno para BTCPay: ${faltan.join(", ")}. Ver docs/importar-btcpay.md.
`);
      return CODIGO_CONFIGURACION;
    }
    const config = configDesdeEntorno({ BTCPAY_URL: process.env.LEDGER_BTCPAY_URL, BTCPAY_API_KEY: process.env.LEDGER_BTCPAY_API_KEY });
    if (config === null) {
      process.stderr.write("error: LEDGER_BTCPAY_URL debe ser la dirección completa de BTCPay (http o https).\n");
      return CODIGO_CONFIGURACION;
    }
    const tiendas = (process.env.LEDGER_BTCPAY_TIENDAS ?? "").split(",").map((s) => s.trim()).filter((s) => s.length > 0);
    facturas = [];
    for (const tienda of tiendas) {
      try {
        facturas.push(...(await facturasPagadas(config, tienda, inicio)));
      } catch (e) {
        if (e instanceof ErrorBtcpay) throw new ErrorLedger(`No se pudieron leer las facturas de la tienda ${tienda}: ${e.message}`);
        throw e;
      }
    }
  }

  const momento = ahora();
  const almacen = almacenArchivos(datos);
  const filas: { factura: string; resultado: "nueva" | "repetida" | "omitida"; motivo: string | null; ticket: string | null }[] = [];
  for (const factura of facturas) {
    const r = await importarFacturaBtcpay(almacen, factura, momento);
    if ("omitida" in r) filas.push({ factura: factura.id, resultado: "omitida", motivo: r.omitida, ticket: null });
    else filas.push({ factura: factura.id, resultado: r.nueva ? "nueva" : "repetida", motivo: null, ticket: r.ticket.id });
  }
  const cuenta = (tipo: string) => filas.filter((f) => f.resultado === tipo).length;
  const resumen = { nuevas: cuenta("nueva"), repetidas: cuenta("repetida"), omitidas: cuenta("omitida") };

  if (json) {
    process.stdout.write(`${JSON.stringify({ ...resumen, facturas: filas }, null, 2)}
`);
  } else {
    const lineas = filas.map((f) =>
      f.resultado === "omitida" ? `omitida: ${f.motivo} (factura ${f.factura})` : `${f.ticket} factura ${f.factura} ${f.resultado === "nueva" ? "nueva" : "ya importada"}`,
    );
    if (filas.length === 0) lineas.push("No hay facturas pagadas en las tiendas indicadas.");
    lineas.push(`Nuevas: ${resumen.nuevas}. Repetidas: ${resumen.repetidas}. Omitidas: ${resumen.omitidas}.`);
    process.stdout.write(`${lineas.join("\n")}\n`);
  }
  return 0;
}

function cmdMes(mesTexto: string | undefined, a: Argumentos, datos: string): Resultado {
  const mes = validarMes(needArg(mesTexto, "mes (YYYY-MM)"));
  const tickets = listarTickets(datos);
  const informe = informeMes(mes, leerDocumentosEmitidos(datos, tickets), tickets);
  const lineas = lineasMes(informe);
  const carpeta = unico(a, "csv");
  if (carpeta !== undefined) {
    const rutas = escribirLibrosCsv(resolve(carpeta), informe);
    lineas.push("", "Libros en CSV (separador punto y coma, decimales con coma, UTF-8 con BOM):", ...rutas.map((r) => `  ${r}`));
  }
  return { datos: informe, lineas };
}

function cmdWeb(a: Argumentos, datos: string): Resultado {
  const salida = resolve(unico(a, "salida") ?? join(raizLedger(), "sitio"));
  const dia = unico(a, "dia") ?? fechaHoraSalvador(ahora()).fecEmi;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dia)) throw new ErrorLedger(`La fecha "${dia}" no tiene la forma YYYY-MM-DD.`);
  const archivos = generarSitio({ datos, salida, dia, ahora: ahora() });
  return {
    datos: { salida, dia, archivos },
    lineas: [`Sitio del cierre del ${dia} escrito en ${salida} (${archivos.length} archivos).`, `Abrí ${join(salida, "index.html")} en el navegador.`],
  };
}

const AYUDA = `Uso: ledger <orden> [opciones]

  ticket nuevo --cliente consumidor|contribuyente --linea "desc|cant|precio" ...
               [--receptor <archivo.json>]
  ticket nuevo --desde <archivo.json>
  ticket ver <id>
  ticket lista
  pagar <id> --blink <archivo.json>
  pagar <id> --efectivo
  importar market <archivo.json>   pedido pagado exportado de CacaoMarket (docs/importar-market.md)
  importar btcpay [--desde YYYY-MM-DD] [--archivo <facturas.json>]   facturas pagadas de BTCPay (docs/importar-btcpay.md)
  dte construir <id> [--forzar-codigo <código>]
                     [--ambiente 01 --confirmar-produccion]
  dte validar <archivo o id> [--confirmar-produccion]
  dte firmar <id> [--comercio <id>] [--firmador-url <url>]
  dte transmitir <id> --simulado
  comercio registrar <id> --nit ... --password-pri ... --clave-privada <archivo.pem>
  comercio lista
  atestacion ver <id> | verificar | exportar
  cierre [YYYY-MM-DD] [--json]     (cierre --ayuda explica el plazo de 24 horas)
  mes <YYYY-MM> [--json] [--csv <carpeta>]   libros de IVA y cifras para F-07 y F-14
  web [--dia YYYY-MM-DD] [--salida <carpeta>] sitio estático del cierre (por defecto ledger/sitio)
  demo                             recorrido completo con datos de prueba

Opciones generales:
  --esquemas caso|2026  generación de esquemas (por defecto caso, o LEDGER_ESQUEMAS)
  --datos <carpeta>     carpeta de datos (por defecto ledger/datos, o LEDGER_DATOS)
  --emisor <archivo>    datos del emisor (por defecto fixtures/emisor.json o fixtures/caso/emisor.json)
  --firmador-url <url>  firmador SVFE (o LEDGER_FIRMADOR_URL)
  --comercio <id>       comercio para firmar (por defecto el activo en datos/comercios/indice.json)
  --json                salida en JSON

Variables (no van en datos/ ni en fixtures):
  LEDGER_CLAVE_MAESTRA  descifra credenciales por comercio
  LEDGER_FIRMADOR_URL   URL del SVFE-API-Firmador
  LEDGER_BTCPAY_URL     dirección de BTCPay Server (importar btcpay)
  LEDGER_BTCPAY_API_KEY clave de API de solo lectura (importar btcpay)
  LEDGER_BTCPAY_TIENDAS ids de las tiendas, separados por coma (importar btcpay)
`;

async function main(argv: string[]): Promise<number> {
  const a = leerArgumentos(argv);
  const [grupo, orden, ...resto] = a.posicionales;
  const json = a.interruptores.has("json");
  if (grupo === "cierre" && a.interruptores.has("ayuda")) {
    process.stdout.write(AYUDA_CIERRE);
    return 0;
  }
  if (a.interruptores.has("ayuda") || grupo === undefined || grupo === "ayuda") {
    process.stdout.write(AYUDA);
    return 0;
  }
  if (grupo === "demo") return ejecutarDemo(unico(a, "esquemas"));
  const datos = dirDatos(unico(a, "datos"));
  let r: Resultado;
  if (grupo === "comercio" && orden === "registrar") {
    r = cmdComercioRegistrar(needArg(resto[0], "identificador del comercio"), a, datos);
  } else if (grupo === "comercio" && orden === "lista") {
    r = cmdComercioLista(datos);
  } else if (grupo === "dte" && orden === "firmar") {
    return cmdDteFirmar(needArg(resto[0], "identificador del ticket"), a, datos).then((res) => {
      if (json) process.stdout.write(`${JSON.stringify(res.datos, null, 2)}\n`);
      else process.stdout.write(`${res.lineas.join("\n")}\n`);
      if (res.fallo) {
        process.stderr.write(`error: ${res.fallo}\n`);
        return 1;
      }
      return 0;
    });
  } else if (grupo === "importar" && orden === "btcpay") {
    return cmdImportarBtcpay(a, datos, json);
  } else if (grupo === "ticket" && orden === "nuevo") r = cmdTicketNuevo(a, datos);
  else if (grupo === "ticket" && orden === "ver") r = cmdTicketVer(needArg(resto[0], "identificador del ticket"), datos);
  else if (grupo === "ticket" && orden === "lista") r = cmdTicketLista(datos);
  else if (grupo === "pagar") r = cmdPagar(needArg(orden, "identificador del ticket"), a, datos);
  else if (grupo === "dte" && orden === "construir") r = await cmdDteConstruir(needArg(resto[0], "identificador del ticket"), a, datos);
  else if (grupo === "dte" && orden === "validar") r = cmdDteValidar(needArg(resto[0], "archivo o identificador"), a, datos);
  else if (grupo === "dte" && orden === "transmitir") r = cmdDteTransmitir(needArg(resto[0], "identificador del ticket"), a, datos);
  else if (grupo === "atestacion") r = cmdAtestacion(orden, resto, a, datos);
  else if (grupo === "cierre") r = cmdCierre(orden, a, datos);
  else if (grupo === "importar") r = cmdImportar(orden, resto[0], datos);
  else if (grupo === "mes") r = cmdMes(orden, a, datos);
  else if (grupo === "web") r = cmdWeb(a, datos);
  else throw new ErrorLedger(`Orden desconocida: "${[grupo, orden].filter(Boolean).join(" ")}". Usá "ledger ayuda".`);

  if (json) {
    process.stdout.write(`${JSON.stringify(r.datos, null, 2)}\n`);
  } else {
    process.stdout.write(`${r.lineas.join("\n")}\n`);
  }
  if (r.fallo) {
    process.stderr.write(`error: ${r.fallo}\n`);
    return 1;
  }
  return 0;
}

function needArg(v: string | undefined, nombre: string): string {
  if (!v) throw new ErrorLedger(`Falta el ${nombre}.`);
  return v;
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (err: unknown) => {
    const mensaje = err instanceof ErrorLedger ? err.message : `Error inesperado: ${err instanceof Error ? err.message : String(err)}`;
    process.stderr.write(`error: ${mensaje}\n`);
    process.exitCode = 1;
  },
);
