import { createHash } from "node:crypto";
import type { Atestacion } from "../atestacion.ts";
import { GRUPOS, ETIQUETAS, montoFila, textoPlazo, type FilaCierre, type Grupo, type InformeCierre } from "../cierre.ts";
import { formatoSats, formatoUsd } from "../dinero.ts";
import { CONFIG, GENERACIONES, type Generacion } from "../generacion.ts";
import { documentoDesde, informeMes, nombresLibros, type InformeMes } from "../mes.ts";
import { fechaHoraSalvador } from "../tiempo.ts";
import { totalDeTicket, type Ticket } from "../ticket.ts";
import type { ResultadoValidacion } from "../validar.ts";
import { escapar } from "./escapar.ts";

// Pages of the static site. Pure: the generator reads the files and passes the data in.
// Every value that comes from a ticket or a document is escaped before it reaches the HTML.

export const OTROS_PRODUCTOS = [
  { nombre: "cacao", url: "https://cacao-grupo.vercel.app" },
  { nombre: "cacaomedia", url: "https://cacao-media.vercel.app" },
  { nombre: "cacaotravel", url: "https://cacao-travel.vercel.app" },
  { nombre: "cacaomarket", url: "https://cacao-market.vercel.app" },
  { nombre: "cacaopay", url: "https://cacao-pay.vercel.app" },
] as const;

export interface DocumentoSitio {
  // The stored document, as written by the builder.
  documento: Record<string, any>;
  generacion: Generacion;
  validacion: ResultadoValidacion;
}

export interface DatosSitio {
  dia: string;
  informe: InformeCierre;
  informeMes?: InformeMes;
  // Every ticket that appears in the close, by id.
  tickets: Map<string, Ticket>;
  // The whole chain in file order: the position of a record is its place in the chain.
  atestaciones: Atestacion[];
  // Stored documents, by ticket id, for the tickets that have one.
  documentos: Map<string, DocumentoSitio>;
}

const RUTA_TICKET = (id: string) => `tickets/${id}.html`;

function fechaCorta(iso: string): string {
  const [a, m, d] = iso.split("-");
  return `${d}/${m}/${a}`;
}

function dl(filas: [string, string][]): string {
  return `<dl class="datos">${filas.map(([t, v]) => `<div><dt>${escapar(t)}</dt><dd>${v}</dd></div>`).join("")}</dl>`;
}

// Text for the text values: escapes. Use for anything that is not already HTML.
function t(texto: string): string {
  return escapar(texto);
}

// Monospace span for numbers, codes and hashes. The value is escaped.
function cod(texto: string, clase = "num"): string {
  return `<span class="${clase}">${escapar(texto)}</span>`;
}

function pagina(titulo: string, prefijo: string, cuerpo: string): string {
  const enlaces = OTROS_PRODUCTOS.map((p) => `<li><a href="${p.url}">${escapar(p.nombre)}</a></li>`).join("");
  return `<!doctype html>
<html lang="es-SV">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapar(titulo)} · cacaoledger</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,400;12..96,800&family=JetBrains+Mono:wght@500&display=swap" rel="stylesheet">
<link rel="stylesheet" href="${prefijo}estilo.css">
</head>
<body>
<div class="hoja">
<header class="cabecera">
<p class="marca"><a href="${prefijo}index.html">cacao<span>ledger</span></a></p>
<p class="lema">Cobrar y declarar</p>
<nav class="nav" aria-label="Secciones">
<a href="${prefijo}index.html">Cierre del día</a>
<a href="${prefijo}mes.html">Libros y F-07 / F-14</a>
<a href="${prefijo}hacienda.html">Hacienda y ley</a>
<a href="${prefijo}esquemas.html">Esquemas</a>
</nav>
</header>
<p class="cinta">Demostración: sello y transmisión simulados</p>
<main class="contenido">
${cuerpo}
</main>
</div>
<footer class="pie">
<p class="pie__gigante" aria-hidden="true"><b>cacao</b>ledger</p>
<p>Cacao, la empresa, y los otros productos</p>
<ul>${enlaces}</ul>
</footer>
</body>
</html>
`;
}

function filaDelCierre(f: FilaCierre): string {
  const plazo = textoPlazo(f);
  const partes = [
    plazo !== null ? `<span class="plazo">${t(plazo)}</span>` : "",
    `<a class="ticket" href="${RUTA_TICKET(f.ticket)}">${t(f.ticket)}</a>`,
    `<span class="fecha">${t(f.fecha)}</span>`,
    `<span class="monto">${t(montoFila(f))}</span>`,
    `<span class="motivo">${t(f.motivo)}</span>`,
  ];
  return `<li class="fila">${partes.filter((p) => p !== "").join(" ")}</li>`;
}

function seccionGrupo(g: Grupo, informe: InformeCierre): string {
  const tot = informe.totales[g];
  const cabecera = `${ETIQUETAS[g]}: <span class="num">${tot.cantidad}</span>${tot.cantidad > 0 ? ` <span class="num">${t(formatoUsd(tot.usdCentavos))}</span>` : ""}`;
  const filas = informe.grupos[g];
  const cuerpo = filas.length === 0 ? `<p class="vacio">Ninguno.</p>` : `<ul class="filas">${filas.map(filaDelCierre).join("")}</ul>`;
  return `<section class="grupo" aria-labelledby="grupo-${g}"><h2 id="grupo-${g}">${cabecera}</h2>${cuerpo}</section>`;
}

export function paginaIndice(d: DatosSitio): string {
  const i = d.informe;
  const cuerpo = `
<h1>Cierre del ${t(fechaCorta(i.fecha))}</h1>
<p class="nota">Cada ticket del día en un solo grupo. Hora de El Salvador.</p>
${GRUPOS.map((g) => seccionGrupo(g, i)).join("\n")}
<p class="respuesta" role="status">${t(i.respuesta)}</p>`;
  return pagina("Cierre del día", "", cuerpo);
}

// The reason a payment code was chosen, in words. Written for the merchant, not the schema.
export function razonFormaDePago(tipo: string, rail: "lightning" | "efectivo", codigo: string): string {
  if (rail === "efectivo") return "Pago en efectivo: billetes y monedas (01).";
  if (tipo === "03") return "Bitcoin (11): el comprobante de crédito fiscal lo admite en las dos generaciones.";
  if (codigo === "99") {
    return "Otros (99), con la referencia BTC-LN: el esquema caso no admite el 11 en la factura 01.";
  }
  if (codigo === "11") {
    return "Bitcoin (11): el esquema 2026 lo admite. La recepción del Ministerio no fue probada con este código.";
  }
  return `Código ${codigo} de CAT-017, tomado del medio de pago.`;
}

function lineasDelTicket(ticket: Ticket): string {
  return ticket.lineas
    .map((l) => {
      const importe = l.precioCentavos * l.cantidad;
      return `<li class="linea"><span class="desc">${t(l.descripcion)}</span> <span class="num">${l.cantidad} × ${formatoUsd(l.precioCentavos)} = ${formatoUsd(importe)}</span></li>`;
    })
    .join("");
}

function seccionPago(ticket: Ticket): string {
  const p = ticket.pago;
  if (!p) return `<section class="bloque"><h2>Pago</h2><p>Pendiente. El ticket todavía no tiene cobro.</p></section>`;
  const filas: [string, string][] = [
    ["Medio", p.rail === "lightning" ? "Lightning" : "Efectivo"],
    ["Monto", cod(formatoUsd(p.montoCentavos))],
    ["Momento", t(fechaHoraSalvador(new Date(p.momento)).fecEmi + " " + fechaHoraSalvador(new Date(p.momento)).horEmi)],
  ];
  if (p.rail === "lightning") {
    filas.splice(2, 0, ["Sats recibidos", cod(formatoSats(p.sats))]);
    filas.push(["Tasa", cod(`${p.tasaUsdPorBtc} USD/BTC`)]);
    filas.push(["Fuente de la tasa", t(p.tasaFuente)]);
    filas.push(["Hash del pago", cod(p.paymentHash, "hash")]);
  }
  return `<section class="bloque"><h2>Pago</h2>${dl(filas)}</section>`;
}

// Deterministic 21x21 SVG matrix from the MH consultation URL, with finder patterns on the three corners.
function seccionVersionLegible(ticket: Ticket, doc: DocumentoSitio | undefined): string {
  if (!ticket.dte || !doc || !ticket.sello) return "";
  const d = doc.documento;
  const ident = d.identificacion ?? {};
  const emisor = d.emisor ?? {};
  const ambiente = String(ident.ambiente ?? "00");
  const codGen = String(ident.codigoGeneracion ?? "");
  const fecEmi = String(ident.fecEmi ?? "");
  const tipo = String(ident.tipoDte ?? "01");
  // The link opens the public query without parameters: the reader types the code, the date and the environment.
  const urlConsulta = "https://admin.factura.gob.sv/consultaPublica";
  const tituloDte =
    tipo === "01"
      ? "DOCUMENTO TRIBUTARIO ELECTRÓNICO · FACTURA (01)"
      : "DOCUMENTO TRIBUTARIO ELECTRÓNICO · COMPROBANTE DE CRÉDITO FISCAL (03)";
  return `<section class="legible" aria-labelledby="legible-titulo">
<div class="legible-cabecera">
<div>
<h2 id="legible-titulo">${t(tituloDte)}</h2>
<p class="nota">Versión legible para el receptor. Por regla general, el DTE se considera emitido al recibir el sello de recepción; la contingencia tiene reglas propias.</p>
</div>
<div class="qr-caja">
<a href="${escapar(urlConsulta)}">Consultar en Hacienda</a>
</div>
</div>
${dl([
    ["Emisor", t(`${String(emisor.nombre ?? "")} (${String(emisor.nombreComercial ?? "")})`)],
    ["NIT y NRC del emisor", cod(`NIT ${String(emisor.nit ?? "")} · NRC ${String(emisor.nrc ?? "")}`)],
    ["Actividad económica", t(`${String(emisor.codActividad ?? "")} · ${String(emisor.descActividad ?? "")}`)],
    ["Código de generación", cod(codGen)],
    ["Número de control", cod(String(ident.numeroControl ?? ""))],
    ["Sello de recepción", cod(ticket.sello.valor)],
    ["Modelo y transmisión", t("Modelo 1 (Previo) · Transmisión 1 (Normal) · Moneda USD")],
    ["Verificación en Hacienda", `<a href="${escapar(urlConsulta)}">${t(urlConsulta)}</a><br>En la consulta se escriben el código de generación, la fecha de emisión y el ambiente (00 prueba o 01 producción): ${cod(codGen)} · ${t(fecEmi)} · ${cod(ambiente)}`],
  ])}
</section>`;
}

function seccionDocumento(ticket: Ticket, doc: DocumentoSitio | undefined): string {
  if (!ticket.dte || !doc) {
    const motivo =
      ticket.estado === "rechazado"
        ? "El documento fue rechazado y no tiene sello."
        : ticket.estado === "pagado"
          ? "Todavía no hay documento construido para este cobro."
          : "No hay documento: el ticket no está pagado.";
    return `<section class="bloque"><h2>Documento</h2><p>${t(motivo)}</p></section>`;
  }
  const d = doc.documento;
  const ident = d.identificacion ?? {};
  const pagoEmitido = (d.resumen?.pagos?.[0] ?? {}) as { codigo?: string; referencia?: string | null };
  const codigo = pagoEmitido.codigo ?? "";
  const tipo = String(ident.tipoDte ?? "");
  const rail = ticket.pago?.rail ?? "efectivo";
  const etiquetaTipo = tipo === "01" ? "01, factura de consumidor final" : "03, comprobante de crédito fiscal";
  const filas: [string, string][] = [
    ["Tipo", t(etiquetaTipo)],
    ["Número de control", cod(String(ident.numeroControl ?? ""))],
    ["Código de generación", cod(String(ident.codigoGeneracion ?? ""))],
    ["Ambiente", t(ident.ambiente === "01" ? "01, producción" : "00, prueba")],
    ["Emisión", t(`${String(ident.fecEmi ?? "")} ${String(ident.horEmi ?? "")}`)],
    ["Forma de pago emitida", cod(`${codigo}${pagoEmitido.referencia ? ` · ${pagoEmitido.referencia}` : ""}`)],
    ["Por qué", t(razonFormaDePago(tipo, rail, codigo))],
  ];
  let sello = "";
  if (ticket.sello) {
    sello = `<p class="sello"><span class="chip chip-simulado">sello simulado</span> ${cod(ticket.sello.valor)}</p>`;
  } else if (ticket.rechazo) {
    sello = `<p class="rechazo">Rechazado el ${t(fechaHoraSalvador(new Date(ticket.rechazo.momento)).fecEmi)}. Observaciones:</p><ul>${ticket.rechazo.observaciones.map((o) => `<li>${t(o)}</li>`).join("")}</ul>`;
  }
  return `<section class="bloque"><h2>Documento</h2>${dl(filas)}${sello}</section>`;
}

function seccionAtestacion(ticket: Ticket, atestaciones: Atestacion[]): string {
  if (ticket.pago?.rail !== "lightning") return "";
  const indice = atestaciones.findIndex((a) => a.ticket === ticket.id);
  if (indice < 0) {
    return `<section class="bloque"><h2>Atestación de tasa</h2><p>Sin atestación: el documento no se ha construido. Mientras tanto, los sats son los del pago.</p></section>`;
  }
  const a = atestaciones[indice] as Atestacion;
  const anterior = a.anterior === "0".repeat(64) ? "inicio de la cadena (64 ceros)" : a.anterior;
  const filas: [string, string][] = [
    ["Registro", cod(a.hash, "hash")],
    ["Hash del registro anterior", cod(anterior, "hash")],
    ["Posición en la cadena", t(`registro ${indice + 1} de ${atestaciones.length}`)],
    ["Sats", cod(formatoSats(a.sats))],
    ["Monto en dólares", cod(formatoUsd(a.usdCentavos))],
    ["Tasa", cod(`${a.tasaUsdPorBtc} USD/BTC`)],
    ["Fuente de la tasa", t(a.tasaFuente)],
    ["Momento del pago", t(a.momentoPago)],
  ];
  return `<section class="bloque"><h2>Atestación de tasa</h2>${dl(filas)}<p class="nota">Cada registro lleva el hash del anterior. Si uno cambia, la cadena se rompe en ese punto.</p></section>`;
}

function seccionValidacion(doc: DocumentoSitio | undefined): string {
  if (!doc) return "";
  const v = doc.validacion;
  const fallos = [...v.esquema, ...v.reglas];
  const lista = fallos.length === 0 ? "" : `<ul>${fallos.map((f) => `<li>${t(f.ruta)}: ${t(f.mensaje)} <span class="num">(${t(f.valor)})</span></li>`).join("")}</ul>`;
  const avisos = v.avisos.map((a) => `<p class="aviso">${t(a)}</p>`).join("");
  return `<section class="bloque"><h2>Validación</h2>
${dl([
    ["Generación de esquemas", t(doc.generacion)],
    ["Esquema usado", cod(v.archivoEsquema ?? "sin esquema")],
    ["Origen del esquema", t(v.origenEsquema ?? "")],
    ["Resultado", t(v.ok ? "VÁLIDO" : "NO VÁLIDO")],
  ])}
${lista}${avisos}
<p class="nota">Validación de la copia guardada, con las mismas reglas que usa la recepción simulada.</p>
</section>`;
}

export function paginaTicket(ticket: Ticket, d: DatosSitio): string {
  const total = totalDeTicket(ticket);
  const fecha = fechaHoraSalvador(new Date(ticket.creado));
  const cliente = ticket.cliente === "consumidor" ? "consumidor final (01)" : "contribuyente (03)";
  const filasCliente: [string, string][] = [
    ["Cliente", t(cliente)],
    ["Creado", t(`${fecha.fecEmi} ${fecha.horEmi}`)],
    ["Estado", `<span class="chip chip-${ticket.estado}">${t(ticket.estado)}</span>`],
  ];
  if (ticket.origen?.plataforma === "btcpay") {
    filasCliente.push(["Factura de BTCPay", cod(ticket.origen.numero)], ["Producto", t(ticket.origen.producto)]);
  } else if (ticket.origen) {
    filasCliente.push(["Pedido de CacaoMarket", cod(ticket.origen.numero)]);
  }
  if (ticket.receptor) {
    filasCliente.push(["Receptor", t(ticket.receptor.nombre)], ["NIT del receptor", cod(ticket.receptor.nit)], ["NRC del receptor", cod(ticket.receptor.nrc)]);
  }
  const bloqueTotales =
    ticket.cliente === "consumidor"
      ? dl([
          ["Total con IVA incluido", cod(formatoUsd(total.totalCentavos))],
          ["IVA contenido (13/113)", cod(formatoUsd(total.ivaCentavos))],
          ["Neto", cod(formatoUsd(total.netoCentavos))],
        ])
      : dl([
          ["Subtotal sin IVA", cod(formatoUsd(total.gravadoCentavos))],
          ["IVA 13 %", cod(formatoUsd(total.ivaCentavos))],
          ["Total a pagar", cod(formatoUsd(total.totalCentavos))],
        ]);
  const doc = d.documentos.get(ticket.id);
  const cuerpo = `
<p class="volver"><a href="../index.html">Volver al cierre del día</a></p>
<h1>Ticket <span class="num">${t(ticket.id)}</span></h1>
${seccionVersionLegible(ticket, doc)}
<section class="bloque"><h2>Datos</h2>${dl(filasCliente)}</section>
<section class="bloque"><h2>Líneas</h2><ul class="lineas">${lineasDelTicket(ticket)}</ul>${bloqueTotales}</section>
${seccionPago(ticket)}
${seccionDocumento(ticket, doc)}
${seccionAtestacion(ticket, d.atestaciones)}
${seccionValidacion(doc)}`;
  return pagina(`Ticket ${ticket.id}`, "../", cuerpo);
}

function resolverInformeMes(d: DatosSitio): InformeMes {
  if (d.informeMes) return d.informeMes;
  const mes = d.dia.slice(0, 7);
  const tickets = [...d.tickets.values()];
  const docs = tickets
    .filter((tk) => tk.estado === "emitido" && d.documentos.has(tk.id))
    .map((tk) => documentoDesde(d.documentos.get(tk.id)!.documento, tk.id, tk.sello?.valor ?? null));
  return informeMes(mes, docs, tickets);
}

export function paginaMes(d: DatosSitio): string {
  const m = resolverInformeMes(d);
  const c = m.cifras;
  const archivos = nombresLibros(m.mes);
  const diasConVentas = m.consumidor.filas.filter((f) => f.cantidad > 0);
  const filasConsumidorHtml =
    diasConVentas.length === 0
      ? `<tr><td colspan="5">Sin facturas de consumidor final selladas en este mes.</td></tr>`
      : diasConVentas
          .map(
            (f) =>
              `<tr><td class="num">${t(fechaCorta(f.fecha))}</td><td class="num">${t(f.primerControl ?? "")}</td><td class="num">${t(f.ultimoControl ?? "")}</td><td class="der">${f.cantidad}</td><td class="der">${t(formatoUsd(f.ventasGravadasCentavos))}</td></tr>`,
          )
          .join("");
  const filasContribuyentesHtml =
    m.contribuyentes.filas.length === 0
      ? `<tr><td colspan="7">Sin comprobantes de crédito fiscal (03) sellados en este mes.</td></tr>`
      : m.contribuyentes.filas
          .map(
            (f) =>
              `<tr><td class="num">${t(fechaCorta(f.fecha))}</td><td class="num">${t(f.numeroControl)}</td><td class="num">${t(f.codigoGeneracion)}</td><td>${t(f.receptorNombre)} (${cod(f.receptorNrc)})</td><td class="der">${t(formatoUsd(f.netoCentavos))}</td><td class="der">${t(formatoUsd(f.ivaCentavos))}</td><td class="der">${t(formatoUsd(f.totalCentavos))}</td></tr>`,
          )
          .join("");
  const noIncluidosHtml =
    m.noIncluidos.length === 0
      ? `<p class="vacio">Ninguno en este período.</p>`
      : `<ul class="filas">${m.noIncluidos
          .map(
            (n) =>
              `<li class="fila"><a class="ticket" href="${RUTA_TICKET(n.ticket)}">${t(n.ticket)}</a> <span class="fecha">${t(fechaCorta(n.fecha))}</span> <span class="chip chip-${t(n.estado)}">${t(n.estado)}</span> <span class="motivo">${t(n.motivo)}</span></li>`,
          )
          .join("")}</ul>`;

  const cuerpo = `
<h1>Libros de IVA y declaraciones · <span class="num">${t(m.mes)}</span></h1>
<p class="nota">Solo entran los documentos con sello de recepción (Art. 119-C del Código Tributario). Los libros de IVA no pueden atrasarse más de 15 días calendario (Art. 242 numeral 1, subnumeral 2 del Código Tributario). El F-07 se presenta dentro de los primeros 10 días hábiles del mes siguiente (por confirmar). El pago a cuenta del F-14 se rige por el Art. 151 del Código Tributario, pago a cuenta (por confirmar).</p>

<section class="bloque">
<h2>Cifras para Formulario F-07 (IVA) y Formulario F-14 v17 (Pago a Cuenta)</h2>
<div class="tabla-wrap">
<table class="tabla">
<thead><tr><th>Concepto</th><th>Formulario y base legal</th><th class="der">Monto</th></tr></thead>
<tbody>
<tr><td>Ventas internas gravadas con contribuyentes (neto sin IVA)</td><td>F-07 · Ventas gravadas a contribuyentes (Anexo 1)</td><td class="der">${t(formatoUsd(c.f07VentasContribuyentesNetoCentavos))}</td></tr>
<tr><td>Ventas internas gravadas a consumidor final (con IVA incluido)</td><td>Anexo 2 columna N y T (total bruto facturado en DTE 01)</td><td class="der">${t(formatoUsd(c.f07VentasConsumidorIvaIncluidoCentavos))}</td></tr>
<tr><td>Ventas internas gravadas a consumidor final (neto sin IVA)</td><td>F-07 · Ventas gravadas a consumidor final (total dividido entre 1.13)</td><td class="der">${t(formatoUsd(c.f07VentasConsumidorNetoCentavos))}</td></tr>
<tr><td>Base imponible gravada total del mes (sin IVA)</td><td>F-07 · Suma de ventas gravadas netas</td><td class="der">${t(formatoUsd(c.f07BaseGravadaCentavos))}</td></tr>
<tr><td>Débito fiscal por ventas a contribuyentes (13 %)</td><td>F-07 · Débito fiscal por contribuyentes (13 % sobre CCF 03)</td><td class="der">${t(formatoUsd(c.f07DebitoContribuyentesCentavos))}</td></tr>
<tr><td>Débito fiscal por ventas a consumidor final (13 %)</td><td>F-07 · Débito fiscal por consumidor final (IVA contenido en Factura 01)</td><td class="der">${t(formatoUsd(c.f07DebitoConsumidorCentavos))}</td></tr>
<tr><td>Total débito fiscal de IVA del mes (13 %)</td><td>F-07 · Débito fiscal total del período</td><td class="der">${t(formatoUsd(c.f07DebitoIvaCentavos))}</td></tr>
<tr><td>Ingresos brutos mensuales (sin IVA)</td><td>F-14 v17 · Base del pago a cuenta por rama económica (Art. 151 CT, pago a cuenta, por confirmar). Sin IVA es un supuesto de cálculo, no una norma</td><td class="der">${t(formatoUsd(c.f14IngresosBrutosCentavos))}</td></tr>
<tr><td>Entero de Pago a Cuenta del ISR (1.75 %)</td><td>F-14 v17 · 1.75 % de los ingresos brutos por rama económica (Art. 151 CT, pago a cuenta, por confirmar; reforma por el Decreto 958)</td><td class="der">${t(formatoUsd(c.f14PagoACuentaCentavos))}</td></tr>
</tbody>
</table>
</div>
<p class="nota">${t(m.nota)}</p>
<p class="nota">La versión 14 del F-07 figura como borrador en mh.gob.sv; su vigencia no está confirmada. El F-14 vigente según la lista de formularios de mh.gob.sv es la versión 17 (junio de 2026). Cada cifra se describe por concepto, sin número de casilla.</p>
</section>

<section class="bloque">
<h2>Archivos CSV generados (libros y anexos DGII F-07)</h2>
<p>Los dos primeros archivos tienen formato de hoja de cálculo salvadoreña (UTF-8 con BOM, punto y coma, coma decimal y fila de total). Los dos anexos F-07 siguen la plantilla de la DGII de 2021 (20 columnas en el Anexo 1 y 23 en el Anexo 2). No están confirmados: que los anexos no lleven encabezado, que se separen con punto y coma, que la plantilla sea la versión 14 y los valores fijos de las columnas R, S, U y V:</p>
<ul class="enlaces-csv">
<li><a href="csv/${t(archivos.consumidor)}"><span class="num">${t(archivos.consumidor)}</span></a> · Libro de ventas a consumidor final (31 días del mes)</li>
<li><a href="csv/${t(archivos.contribuyentes)}"><span class="num">${t(archivos.contribuyentes)}</span></a> · Libro de ventas a contribuyentes (detalle por CCF 03)</li>
<li><a href="csv/${t(archivos.anexo1)}"><span class="num">${t(archivos.anexo1)}</span></a> · Anexo 1 de la plantilla DGII de 2021 (ventas a contribuyentes, 20 columnas A a T)</li>
<li><a href="csv/${t(archivos.anexo2)}"><span class="num">${t(archivos.anexo2)}</span></a> · Anexo 2 de la plantilla DGII de 2021 (ventas a consumidor final, 23 columnas A a W)</li>
</ul>
</section>

<section class="bloque">
<h2>Libro de ventas a consumidor final (DTE 01 · días con movimiento)</h2>
<p class="nota">El CSV completo incluye los 31 días del mes, incluidos los días sin ventas en cero. Aquí se muestran los días con emisión sellada:</p>
<div class="tabla-wrap">
<table class="tabla">
<thead><tr><th>Fecha</th><th>Primer control</th><th>Último control</th><th class="der">Docs</th><th class="der">Ventas gravadas (IVA incl.)</th></tr></thead>
<tbody>${filasConsumidorHtml}</tbody>
<tfoot><tr><td colspan="3">Total del mes (31 días en CSV)</td><td class="der">${m.consumidor.cantidad}</td><td class="der">${t(formatoUsd(m.consumidor.ventasGravadasCentavos))}</td></tr></tfoot>
</table>
</div>
</section>

<section class="bloque">
<h2>Libro de ventas a contribuyentes (DTE 03 · Crédito Fiscal)</h2>
<div class="tabla-wrap">
<table class="tabla">
<thead><tr><th>Fecha</th><th>Número de control</th><th>Código de generación</th><th>Receptor y NRC</th><th class="der">Neto</th><th class="der">IVA (13 %)</th><th class="der">Total</th></tr></thead>
<tbody>${filasContribuyentesHtml}</tbody>
<tfoot><tr><td colspan="4">Total del mes (${m.contribuyentes.cantidad} documento${m.contribuyentes.cantidad === 1 ? "" : "s"})</td><td class="der">${t(formatoUsd(m.contribuyentes.netoCentavos))}</td><td class="der">${t(formatoUsd(m.contribuyentes.ivaCentavos))}</td><td class="der">${t(formatoUsd(m.contribuyentes.totalCentavos))}</td></tr></tfoot>
</table>
</div>
</section>

<section class="bloque">
<h2>Especificación de columnas de los Anexos F-07 (plantilla DGII de 2021)</h2>
<p>Los identificadores se escriben sin guiones (Clase <span class="num">4</span>, DTE). Los valores fijos de las columnas R, S, U y V no están confirmados:</p>
${dl([
    ["Anexo 1 · Ventas a contribuyentes (20 columnas A a T)", t("A: Fecha (DD/MM/YYYY) · B: Clase (4=DTE) · C: Tipo (03=CCF) · D: Número de resolución (numeroControl sin guiones) · E: Serie (selloRecepcion) · F: Número de documento (codigoGeneracion sin guiones) · G: Control interno (vacío) · H: NIT o NRC · I: Nombre · J: Exentas · K: No sujetas · L: Gravadas locales (neto) · M: Débito fiscal (13 %) · N: Terceros · O: Débito terceros · P: Total ventas · Q: DUI · R: Tipo de operación Renta (1=Gravada) · S: Tipo de ingreso Renta (3=Comercial) · T: Anexo (1).")],
    ["Anexo 2 · Ventas a consumidor final (23 columnas A a W)", t("A: Fecha (DD/MM/YYYY) · B: Clase (4=DTE) · C: Tipo (01=Factura) · D a G: N/A en DTE · H: Número de documento Del (primer codigoGeneracion del día sin guiones) · I: Número de documento Al (último codigoGeneracion del día sin guiones) · J: Máquina registradora (vacío) · K a M: Exentas y no sujetas · N: Ventas gravadas locales (IVA incluido) · O a S: Exportaciones y zonas francas · T: Total ventas · U: Tipo de operación Renta (1=Gravada) · V: Tipo de ingreso Renta (3=Comercial) · W: Anexo (2).")],
  ])}
</section>

<section class="bloque">
<h2>No incluidos en libros ni declaraciones (sin sello de recepción)</h2>
<p class="nota">Cobros recibidos cuyo documento fue rechazado o aún no se ha transmitido. Permanecen fuera del F-07 y F-14 hasta que obtienen su sello:</p>
${noIncluidosHtml}
</section>`;
  return pagina("Libros y F-07 / F-14", "", cuerpo);
}

export function paginaHacienda(): string {
  const cuerpo = `
<h1>Marco tributario y de Hacienda en El Salvador</h1>
<p class="nota">Reglas de la Dirección General de Impuestos Internos (DGII · Ministerio de Hacienda), Código Tributario, Ley de IVA, Ley Bitcoin y Consejo de Vigilancia de la Profesión de Contaduría Pública y Auditoría (CVPCPA) aplicadas en CacaoLedger. Revisión del 19 de octubre de 2026: lo que no quedó confirmado se marca como tal.</p>

<section class="bloque">
<h2>1. Carácter constitutivo del sello de recepción (Arts. 119-B y 119-C CT)</h2>
<p>El Código Tributario regula los Documentos Tributarios Electrónicos (DTE). Según el <strong>Art. 119-B</strong>, el DTE es el documento generado, firmado y transmitido electrónicamente a la Administración Tributaria, que cuenta con sello de recepción. <strong>Por regla general (Art. 119-C), el DTE se considera emitido al recibir el sello de recepción</strong> (<span class="num">selloRecepcion</span>). La contingencia tiene reglas propias (<strong>Art. 119-F</strong>). Fuera de contingencia, un archivo JSON firmado con JWS (<span class="num">RS512</span>) por el emisor es un documento candidato hasta que recibe ese sello.</p>
<p>Por esa razón, CacaoLedger separa de forma estricta los tickets en estado <span class="num">pagado</span> (dinero recibido en caja o Lightning sin documento sellado) y <span class="num">rechazado</span> (con plazo de subsanación de 24 horas, cifra no verificada, corriendo) de los tickets en estado <span class="num">emitido</span> (con sello de recepción y aptos para entrar a los Libros de IVA).</p>
</section>

<section class="bloque">
<h2>2. Régimen sancionatorio (Art. 239-A y Art. 242 del Código Tributario)</h2>
<div class="tabla-wrap">
<table class="tabla">
<thead><tr><th>Infracción</th><th>Base legal</th><th>Sanción legal</th><th class="der">Piso o cantidad fija</th></tr></thead>
<tbody>
<tr><td>No emitir el DTE</td><td>Art. 239-A lit. a) CT</td><td>Multa del 50 % del monto de la operación, por documento</td><td class="der">$817.60 (2 salarios mínimos)</td></tr>
<tr><td>Emitir sin cumplir el Art. 119-G, o transmitir sin cumplir requisitos, estructura o reglas de sello</td><td>Art. 239-A lit. b) CT</td><td>Multa del 30 %</td><td class="der">$817.60 (2 salarios mínimos)</td></tr>
<tr><td>Omitir transmitir el DTE a la plataforma</td><td>Art. 239-A lit. c) CT</td><td>Multa del 100 % del monto de cada operación</td><td class="der">$3,679.20 (9 salarios mínimos)</td></tr>
<tr><td>Omitir transmitir un evento de contingencia o una invalidación, o transmitirlo fuera de plazo</td><td>Art. 239-A lit. d) CT</td><td>Nueve salarios mínimos mensuales, cantidad fija</td><td class="der">$3,679.20 (9 salarios mínimos)</td></tr>
<tr><td>Atraso en anotar los libros de IVA (más de 15 días calendario)</td><td>Art. 242 numeral 1, subnumeral 2 CT (IVA)</td><td>Multa en colones según el texto de 2015: 4,970 colones más 490 colones por cada día de atraso; moneda aplicable no verificada</td><td class="der">Tope de nueve salarios mínimos</td></tr>
<tr><td>Presentar la declaración fuera de plazo</td><td>Art. 238 lit. b) núms. 1 a 4 CT</td><td>Multa del 5 % al 20 % (solo por presentar fuera de plazo)</td><td class="der">$817.60 (2 salarios mínimos)</td></tr>
</tbody>
</table>
</div>
<p class="nota">Cálculo sobre el salario mínimo mensual del sector comercio y servicios (<span class="num">$408.80</span>), vigente desde el 1 de junio de 2025; no se halló reforma posterior a la fecha de revisión (19 de octubre de 2026). El rango de 5 % a 20 % corresponde solo a presentar la declaración fuera de plazo; no aplica a las demás infracciones.</p>
</section>

<section class="bloque">
<h2>3. Umbral de inscripción a IVA y tipos de documento (Art. 28 Ley de IVA)</h2>
${dl([
    ["Umbral de contribuyente", t("Art. 28 de la Ley de IVA: son contribuyentes quienes superen 50,000 colones de transferencias en doce meses o 20,000 colones de activo. Los montos están en colones y no se han reajustado desde el Decreto 296 de 1992. Quien queda por debajo de ambos límites queda excluido.")],
    ["Comerciante no inscrito en IVA", t("No posee NRC, no traslada el 13 % de IVA ni emite DTE 01 ni 03.")],
    ["Factura de Consumidor Final (DTE 01)", t("Emitida por contribuyentes inscritos a consumidores finales. El precio unitario y la venta gravada llevan el 13 % de IVA incluido (IVA contenido = total × 13 / 113). Cuando la venta es igual o superior a $200.00, o cuando el comprador lo pide, se consigna el nombre y DUI/NIT del receptor (umbral y artículo no verificados en esta revisión).")],
    ["Comprobante de Crédito Fiscal (DTE 03)", t("Emitido únicamente entre contribuyentes inscritos con NRC. El precio unitario y el subtotal son netos (sin IVA), y el 13 % se desglosa en resumen.tributos con código 20 (Impuesto al Valor Agregado 13 %).")],
  ])}
</section>

<section class="bloque">
<h2>4. Cobros en Bitcoin y Lightning: Ley Bitcoin (D.L. 199 de 2025) y CVPCPA (Res. 1003)</h2>
${dl([
    ["Reforma de la Ley Bitcoin (D.L. 199, enero 2025)", t("Decreto Legislativo 199 del 29 de enero de 2025, publicado el 30 de enero de 2025 y vigente desde el 30 de abril de 2025. Derogó los artículos 4, 8 y 9 de la Ley Bitcoin y reformó el artículo 7, que dejó de obligar a aceptar bitcoin.")],
    ["Registros en dólares", t("Los asientos se llevan en moneda de curso legal (Art. 139 CT). El dólar sigue como moneda de referencia (Art. 6 de la Ley Bitcoin, no reformado por el D.L. 199). Los DTE se emiten con identificación tipoMoneda = USD.")],
    ["Resolución 1003 del CVPCPA", t("Vigente desde el 7 de septiembre de 2021. Medir el bitcoin a costo de adquisición, con el tipo de cambio con referencia al dólar establecido por los mercados internacionales, indicado en la billetera que se utilice.")],
    ["Cadena de atestación de CacaoLedger", t("Cada cobro Lightning validado por Blink genera un registro en atestaciones.jsonl con sats, usdCentavos, tasaUsdPorBtc, tasaFuente, paymentHash y el hash SHA-256 del registro anterior, además de estampar BTC-LN|<sats>sat|<tasa>|<hash12> en resumen.pagos[0].referencia del DTE.")],
  ])}
</section>

<section class="bloque">
<h2>5. Reforma municipal (D.L. 762 · 44 municipios) y custodia de llaves (MTIST 2.0)</h2>
${dl([
    ["Reestructuración municipal (D.L. 762, mayo 2024; no verificado en esta revisión)", t("Redujo los 262 municipios a 44 municipios (agrupados como Norte, Centro, Sur, Este u Oeste de cada departamento) y convirtió los antiguos municipios en distritos. En los esquemas de la generación caso se exige la lista histórica de CAT-013 (por ejemplo 14 en San Salvador), mientras que el catálogo actualizado incorpora los nuevos códigos de municipio.")],
    ["Custodia de llaves (MTIST 2.0 §6.4)", t("La Normativa de Cumplimiento de los Documentos Tributarios Electrónicos y el Manual Técnico de Integración (MTIST 2.0) prohíben compartir certificados de firma con terceros no autorizados. En CacaoLedger la llave privada RSA-4096 permanece en el servidor del propio comercio.")],
    ["Límite ante la CNAD (Ley de Emisión de Activos Digitales)", t("CacaoLedger es software contable y de facturación: no recibe, custodia ni transfiere satoshis ni dólares de terceros. El comercio conecta su propia cuenta de Blink con permiso de solo lectura y cobro (READ + RECEIVE, nunca WRITE), por lo que CacaoLedger no requiere registro como Proveedor de Servicios de Activos Digitales (PSAD) ante la CNAD.")],
  ])}
</section>

<section class="bloque">
<h2>6. Consultas ante la DGII</h2>
<p>Resumen de los cuatro puntos técnicos preparados para consulta formal ante la Dirección General de Impuestos Internos:</p>
<ol>
<li><strong>Código CAT-017 en Factura 01 cobrada por Lightning</strong>: confirmación del uso de <span class="num">99</span> (Otros) con referencia estructurada <span class="num">BTC-LN|...|...</span> mientras el validador de recepción mantenga la expresión regular que excluye <span class="num">11</span> en DTE 01, o habilitación oficial del código <span class="num">11</span> (Bitcoin) conforme al esquema 2026.</li>
<li><strong>Validez probatoria de la atestación de tasa en el DTE</strong>: confirmación de que consignar los satoshis, tasa USD/BTC y hash de pago en <span class="num">resumen.pagos[0].referencia</span> y en la cadena local de atestaciones satisface el requisito de respaldo documental de la contabilidad y la Resolución 1003 del CVPCPA.</li>
<li><strong>Cómputo del plazo de 24 horas en contingencia y rechazo (cifra no verificada)</strong>: confirmación de si las 24 horas para transmitir tras contingencia o corregir un rechazo corren como horas reloj continuas o se suspenden en horas inhábiles de cierre del sistema de recepción.</li>
<li><strong>Tabla CAT-013 de municipios tras el D.L. 762</strong>: confirmación del cronograma de retiro de los códigos antiguos (<span class="num">01</span> a <span class="num">22</span>) frente a los códigos de los 44 nuevos municipios en los esquemas de validación de Hacienda.</li>
</ol>
</section>`;
  return pagina("Hacienda y ley", "", cuerpo);
}

export function paginaEsquemas(): string {
  const filas = GENERACIONES.map((g) => {
    const c = CONFIG[g];
    return `<div><dt>${t(g)}</dt><dd>01 versión ${c.version["01"]}: <span class="num">${t(c.esquema["01"])}</span><br>03 versión ${c.version["03"]}: <span class="num">${t(c.esquema["03"])}</span><br>${t(c.origen)}</dd></div>`;
  }).join("");
  const cuerpo = `
<h1>Dos generaciones de esquemas</h1>
<p>El Ministerio publica un esquema JSON para cada documento. CacaoLedger construye y valida con dos generaciones, y cada documento lleva en su versión la generación que usó.</p>
<p>La generación <strong>caso</strong> viene de una copia de un repositorio comunitario, no del Ministerio. En su factura 01 el patrón de forma de pago no admite el 11 (Bitcoin), así que un cobro Lightning se emite como 99 (Otros) con la referencia BTC-LN.</p>
<p>La generación <strong>2026</strong> es el paquete que el Ministerio publica hoy. Ahí el 11 ya está permitido en la factura 01; CacaoLedger lo emite con un aviso, porque la recepción del Ministerio no se pudo probar con ese código.</p>
<p>Además, la reforma municipal cambió los códigos de municipio y los esquemas caso no aceptan la lista vigente.</p>
<section class="bloque"><h2>Archivos</h2><dl class="datos">${filas}</dl></section>`;
  return pagina("Esquemas", "", cuerpo);
}

// All pages of the site, by path relative to the site folder.
export function paginasDelSitio(d: DatosSitio): Map<string, string> {
  const paginas = new Map<string, string>();
  paginas.set("index.html", paginaIndice(d));
  paginas.set("mes.html", paginaMes(d));
  paginas.set("hacienda.html", paginaHacienda());
  paginas.set("esquemas.html", paginaEsquemas());
  for (const [id, ticket] of d.tickets) {
    paginas.set(RUTA_TICKET(id), paginaTicket(ticket, d));
  }
  return paginas;
}
