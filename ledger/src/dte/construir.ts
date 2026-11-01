import { ErrorLedger } from "../errores.ts";
import { calcularTotales, enLetrasUsd, montoDte, type Totales } from "../dinero.ts";
import type { Pago } from "../pagos/tipos.ts";
import { modalidadDe, tipoDteDe, type Direccion, type Receptor, type Ticket } from "../ticket.ts";
import { fechaHoraSalvador } from "../tiempo.ts";
import { codigoGeneracionNuevo } from "../azar.ts";
import { CONFIG, GENERACION_POR_DEFECTO, type Generacion } from "../generacion.ts";
import { TIPO_ITEM_BIENES, TRIBUTO_IVA, UNIDAD_MEDIDA_UNIDAD } from "./catalogos.ts";
import { formaDePago, type FormaDePago } from "./forma-de-pago.ts";

// Documents are built for one generation at a time. The differences are listed in
// docs/hallazgos.md ("Dos generaciones de esquemas") and each one has a test.

export type Documento = { [clave: string]: unknown };

export interface Emisor {
  nit: string;
  nrc: string;
  nombre: string;
  nombreComercial: string | null;
  codActividad: string;
  descActividad: string;
  direccion: Direccion;
  telefono: string;
  correo: string;
  codEstable: string;
  codPuntoVenta: string;
  // CAT-009. Required by the caso schemas only.
  tipoEstablecimiento?: string;
}

export interface OpcionesDte {
  // "00" test, "01" production. Production needs confirmarProduccion as well.
  ambiente?: "00" | "01";
  confirmarProduccion?: boolean;
  ahora?: Date;
  // The 15-digit correlative used in numeroControl.
  correlativo: number;
  // Injected in tests. Must be an upper-case UUID.
  codigoGeneracion?: string;
  // Demonstration only: writes this code instead of the default.
  forzarCodigo?: string;
  generacion?: Generacion;
  // Simulated contingency: tipoOperacion 2 with tipoContingencia 1 and this motivo (the schemas require it as text).
  contingencia?: { motivo: string };
}

export interface ResultadoConstruccion {
  tipoDte: "01" | "03";
  generacion: Generacion;
  ambiente: "00" | "01";
  codigoGeneracion: string;
  numeroControl: string;
  formaPago: FormaDePago;
  totales: Totales;
  documento: Documento;
}

// Thresholds of the caso schemas (root allOf): from these amounts the receiver is
// required on 01 (USD 200) and the delivery data on 03 (USD 20,000).
const UMBRAL_RECEPTOR_01_CASO_CENTAVOS = 20_000;
const UMBRAL_EXTENSION_03_CASO_CENTAVOS = 2_000_000;

export function numeroControl(
  tipoDte: "01" | "03",
  codEstable: string,
  codPuntoVenta: string,
  correlativo: number,
  generacion: Generacion = GENERACION_POR_DEFECTO,
): string {
  const config = CONFIG[generacion];
  if (!config.codigoEstablecimiento.test(codEstable)) {
    throw new ErrorLedger(`El código de establecimiento "${codEstable}" no tiene la forma M001 (esquema ${generacion}).`);
  }
  if (!config.codigoPuntoVenta.test(codPuntoVenta)) {
    throw new ErrorLedger(`El código de punto de venta "${codPuntoVenta}" no tiene la forma P001 (esquema ${generacion}).`);
  }
  if (!Number.isSafeInteger(correlativo) || correlativo < 1 || correlativo > 999_999_999_999_999) {
    throw new ErrorLedger("El correlativo del documento debe ser un entero entre 1 y 999999999999999.");
  }
  // Three segments after the prefix: type, eight characters (establishment + point of sale), 15 digits.
  return `DTE-${tipoDte}-${codEstable}${codPuntoVenta}-${String(correlativo).padStart(15, "0")}`;
}

function direccionDto(d: Direccion, generacion: Generacion): Documento {
  // caso: no distrito in direccion (AP=false in both caso schemas).
  if (generacion === "caso") return { departamento: d.departamento, municipio: d.municipio, complemento: d.complemento };
  return { departamento: d.departamento, municipio: d.municipio, distrito: d.distrito, complemento: d.complemento };
}

function emisorDto(e: Emisor, generacion: Generacion): Documento {
  const dto: Documento = {
    nit: e.nit,
    nrc: e.nrc,
    nombre: e.nombre,
    codActividad: e.codActividad,
    descActividad: e.descActividad,
    nombreComercial: e.nombreComercial,
    direccion: direccionDto(e.direccion, generacion),
    telefono: e.telefono,
    correo: e.correo,
    codEstable: e.codEstable,
    codPuntoVenta: e.codPuntoVenta,
  };
  if (generacion === "caso") {
    if (!e.tipoEstablecimiento) {
      throw new ErrorLedger("El emisor necesita tipoEstablecimiento (CAT-009) para el esquema caso.");
    }
    dto.tipoEstablecimiento = e.tipoEstablecimiento;
    // Required by the caso 03 schema; the caso 01 schema accepts them as null.
    dto.codEstableMH = null;
    dto.codPuntoVentaMH = null;
  }
  return dto;
}

function receptorDto(r: Receptor, generacion: Generacion): Documento {
  return {
    nit: r.nit,
    nrc: r.nrc,
    nombre: r.nombre,
    codActividad: r.codActividad,
    descActividad: r.descActividad,
    nombreComercial: r.nombreComercial,
    direccion: direccionDto(r.direccion, generacion),
    telefono: r.telefono,
    correo: r.correo,
  };
}

// One DTE from one ticket and one settled payment. Customer type decides the type.
export function construirDte(
  tipoDte: "01" | "03",
  ticket: Ticket,
  pago: Pago,
  emisor: Emisor,
  opciones: OpcionesDte,
): ResultadoConstruccion {
  const generacion = opciones.generacion ?? GENERACION_POR_DEFECTO;
  if (tipoDteDe(ticket.cliente) !== tipoDte) {
    throw new ErrorLedger(
      `Un ticket de ${ticket.cliente} produce la factura ${tipoDteDe(ticket.cliente)}, no la ${tipoDte}.`,
    );
  }
  if (ticket.estado !== "pagado" || ticket.pago === null) {
    throw new ErrorLedger(`El ticket ${ticket.id} debe estar pagado antes de construir el documento.`);
  }
  if (tipoDte === "03" && ticket.receptor === null) {
    throw new ErrorLedger(`El ticket ${ticket.id} no tiene receptor; el comprobante de crédito fiscal lo exige.`);
  }
  const ambiente = opciones.ambiente ?? "00";
  if (ambiente === "01" && opciones.confirmarProduccion !== true) {
    throw new ErrorLedger(
      'El ambiente de producción ("01") requiere --confirmar-produccion; sin esa confirmación el documento es de prueba ("00").',
    );
  }
  const ahora = opciones.ahora ?? new Date();
  const fecha = fechaHoraSalvador(ahora);
  const numero = numeroControl(tipoDte, emisor.codEstable, emisor.codPuntoVenta, opciones.correlativo, generacion);
  const codigoGeneracion = opciones.codigoGeneracion ?? codigoGeneracionNuevo(`${ticket.id}|${numero}`);
  const forma = formaDePago(pago, tipoDte, opciones.forzarCodigo, generacion);

  const { lineas, totales } = calcularTotales(ticket.lineas, modalidadDe(ticket.cliente));
  const total = totales.totalCentavos;

  // The caso schemas make the receiver (01) or the delivery data (03) mandatory from a threshold.
  // The builder cannot invent those data, so it refuses early with the reason.
  if (generacion === "caso" && tipoDte === "01" && total >= UMBRAL_RECEPTOR_01_CASO_CENTAVOS) {
    throw new ErrorLedger(
      "El esquema caso exige datos del receptor en una factura de USD 200 o más. El ticket de consumidor no los tiene; usá el esquema 2026 o ver docs/hallazgos.md.",
    );
  }
  if (generacion === "caso" && tipoDte === "03" && total >= UMBRAL_EXTENSION_03_CASO_CENTAVOS) {
    throw new ErrorLedger(
      "El esquema caso exige datos de entrega (extensión) en un comprobante de USD 20,000 o más. CacaoLedger no captura esos datos todavía.",
    );
  }

  const cuerpo = lineas.map((l, i): Documento => {
    const base: Documento = {
      numItem: i + 1,
      tipoItem: TIPO_ITEM_BIENES,
      numeroDocumento: null,
      codigo: null,
      codTributo: null,
      descripcion: l.descripcion,
      cantidad: l.cantidad,
      uniMedida: UNIDAD_MEDIDA_UNIDAD,
      precioUni: montoDte(l.precioUnitarioCentavos),
      montoDescu: 0,
      ventaNoSuj: 0,
      ventaExenta: 0,
      ventaGravada: montoDte(l.ventaCentavos),
      psv: 0,
      noGravado: 0,
    };
    if (tipoDte === "01") {
      // 01: the price includes IVA, so the line carries the IVA it contains.
      return { ...base, tributos: null, ivaItem: montoDte(l.ivaCentavos) };
    }
    // 03: the line is net, and the IVA is reported in resumen.tributos. The item has no ivaItem.
    return { ...base, tributos: [TRIBUTO_IVA.codigo] };
  });

  const pagos = [{ codigo: forma.codigo, montoPago: montoDte(total), referencia: forma.referencia, periodo: null, plazo: null }];
  const letras = enLetrasUsd(total);

  let resumen: Documento;
  if (tipoDte === "01") {
    resumen = {
      totalNoSuj: 0,
      totalExenta: 0,
      totalGravada: montoDte(totales.gravadoCentavos),
      subTotalVentas: montoDte(totales.gravadoCentavos),
      descuNoSuj: 0,
      descuExenta: 0,
      descuGravada: 0,
      porcentajeDescuento: 0,
      totalDescu: 0,
      tributos: null,
      subTotal: montoDte(totales.gravadoCentavos),
      montoTotalOperacion: montoDte(total),
      totalNoGravado: 0,
      totalPagar: montoDte(total),
      totalLetras: letras,
      totalIva: montoDte(totales.ivaCentavos),
      saldoFavor: 0,
      // CAT-016 1 is cash (contado): every sale here is paid at the moment of sale.
      condicionOperacion: 1,
      pagos,
      numPagoElectronico: null,
    };
    if (generacion === "caso") {
      resumen.ivaRete1 = 0;
      resumen.reteRenta = 0;
    } else {
      resumen.ivaRete = 0;
      resumen.observaciones = null;
    }
  } else {
    const neto = montoDte(totales.gravadoCentavos);
    resumen = {
      totalNoSuj: 0,
      totalExenta: 0,
      totalGravada: neto,
      subTotalVentas: neto,
      descuNoSuj: 0,
      descuExenta: 0,
      descuGravada: 0,
      porcentajeDescuento: 0,
      totalDescu: 0,
      tributos: [{ codigo: TRIBUTO_IVA.codigo, descripcion: TRIBUTO_IVA.descripcion, valor: montoDte(totales.ivaCentavos) }],
      subTotal: neto,
      montoTotalOperacion: montoDte(total),
      totalNoGravado: 0,
      totalPagar: montoDte(total),
      totalLetras: letras,
      saldoFavor: 0,
      // CAT-016 1 is cash (contado): every sale here is paid at the moment of sale.
      condicionOperacion: 1,
      pagos,
      numPagoElectronico: null,
    };
    if (generacion === "caso") {
      resumen.ivaPerci1 = 0;
      resumen.ivaRete1 = 0;
      resumen.reteRenta = 0;
    } else {
      resumen.ivaPerci = 0;
      resumen.ivaRete = 0;
      resumen.observaciones = null;
    }
  }

  const identificacion: Documento = {
    version: CONFIG[generacion].version[tipoDte],
    ambiente,
    tipoDte,
    numeroControl: numero,
    codigoGeneracion,
    // CAT-003 1 is the pre-issue billing model; CAT-004 1 is a normal transmission.
    tipoModelo: 1,
    tipoOperacion: opciones.contingencia ? 2 : 1,
    tipoContingencia: opciones.contingencia ? 1 : null,
    motivoContin: opciones.contingencia ? opciones.contingencia.motivo : null,
    fecEmi: fecha.fecEmi,
    horEmi: fecha.horEmi,
    tipoMoneda: "USD",
  };

  const documento: Documento = {
    identificacion,
    documentoRelacionado: null,
    emisor: emisorDto(emisor, generacion),
    receptor: tipoDte === "01" || ticket.receptor === null ? null : receptorDto(ticket.receptor, generacion),
    otrosDocumentos: null,
    ventaTercero: null,
    cuerpoDocumento: cuerpo,
    resumen,
    apendice: null,
  };
  if (generacion === "caso") {
    // Required by the caso schemas. Every field is null: CacaoLedger does not capture delivery data.
    documento.extension =
      tipoDte === "01"
        ? { nombEntrega: null, docuEntrega: null, nombRecibe: null, docuRecibe: null }
        : { nombEntrega: null, docuEntrega: null, nombRecibe: null, docuRecibe: null, observaciones: null, placaVehiculo: null };
  }

  return {
    tipoDte,
    generacion,
    ambiente,
    codigoGeneracion,
    numeroControl: numero,
    formaPago: forma,
    totales,
    documento,
  };
}

export function construir01(ticket: Ticket, pago: Pago, emisor: Emisor, opciones: OpcionesDte): ResultadoConstruccion {
  return construirDte("01", ticket, pago, emisor, opciones);
}

export function construir03(ticket: Ticket, pago: Pago, emisor: Emisor, opciones: OpcionesDte): ResultadoConstruccion {
  return construirDte("03", ticket, pago, emisor, opciones);
}
