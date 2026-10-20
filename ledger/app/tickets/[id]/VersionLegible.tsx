import type { ReactNode } from "react";

import { formatoUsd } from "../../../src/dinero.ts";
import type { ResultadoConstruccion } from "../../../src/dte/construir.ts";
import type { Ticket } from "../../../src/ticket.ts";
import { fechaHoraSv } from "../../_componentes/formato.ts";

// The legible version of the document, laid out like the static site (src/web/paginas.ts). The QR and the
// verification link point to the public query; the query needs the code, the date and the environment typed in.

export const URL_CONSULTA = "https://admin.factura.gob.sv/consultaPublica";

type Props = {
  ticket: Ticket;
  resultado: ResultadoConstruccion;
  qrSvg: string;
};

function Fila({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <div>
      <dt>{titulo}</dt>
      <dd>{children}</dd>
    </div>
  );
}

export function VersionLegible({ ticket, resultado, qrSvg }: Props) {
  const doc = resultado.documento as Record<string, any>;
  const ident = (doc.identificacion ?? {}) as Record<string, any>;
  const emisor = (doc.emisor ?? {}) as Record<string, any>;
  const tipo = String(ident.tipoDte ?? "01");
  const titulo =
    tipo === "01"
      ? "DOCUMENTO TRIBUTARIO ELECTRÓNICO · FACTURA (01)"
      : "DOCUMENTO TRIBUTARIO ELECTRÓNICO · COMPROBANTE DE CRÉDITO FISCAL (03)";
  const pago = (doc.resumen?.pagos?.[0] ?? {}) as { codigo?: string; referencia?: string | null };
  const codGen = String(ident.codigoGeneracion ?? "");
  const fecEmi = String(ident.fecEmi ?? "");
  const ambiente = String(ident.ambiente ?? "00");

  return (
    <section className="legible" aria-labelledby="legible-titulo">
      <div className="legible-cabecera">
        <div>
          <h2 id="legible-titulo">{titulo}</h2>
          <p className="nota">
            Versión legible para el receptor. Por regla general, el DTE se considera emitido al recibir el sello de
            recepción; la contingencia tiene reglas propias.
          </p>
        </div>
        <div>
          <div className="qr" dangerouslySetInnerHTML={{ __html: qrSvg }} />
          <p className="qr-enlace">
            <a href={URL_CONSULTA}>Consultar en Hacienda</a>
          </p>
        </div>
      </div>
      <dl className="dl">
        <Fila titulo="Emisor">{`${String(emisor.nombre ?? "")} (${String(emisor.nombreComercial ?? "")})`}</Fila>
        <Fila titulo="NIT y NRC del emisor">
          <span className="num">{`NIT ${String(emisor.nit ?? "")} · NRC ${String(emisor.nrc ?? "")}`}</span>
        </Fila>
        <Fila titulo="Actividad económica">{`${String(emisor.codActividad ?? "")} · ${String(emisor.descActividad ?? "")}`}</Fila>
        <Fila titulo="Código de generación">
          <span className="num">{codGen}</span>
        </Fila>
        <Fila titulo="Número de control">
          <span className="num">{String(ident.numeroControl ?? "")}</span>
        </Fila>
        <Fila titulo="Fecha y hora de emisión">{`${fecEmi} ${String(ident.horEmi ?? "")}`}</Fila>
        <Fila titulo="Forma de pago">
          <span className="num">{`${pago.codigo ?? ""}${pago.referencia ? ` · ${pago.referencia}` : ""}`}</span>
        </Fila>
        <Fila titulo="Total">
          <span className="num">{formatoUsd(resultado.totales.totalCentavos)}</span>
        </Fila>
        <Fila titulo="Modelo y transmisión">Modelo 1 (previo) · Transmisión 1 (normal) · Moneda USD</Fila>
        <Fila titulo="Ambiente">{ambiente === "01" ? "01, producción" : "00, pruebas"}</Fila>
        <Fila titulo="Verificación en Hacienda">
          <a href={URL_CONSULTA}>{URL_CONSULTA}</a>
          <br />
          En la consulta se escriben el código de generación, la fecha de emisión y el ambiente (00 pruebas o 01
          producción): <span className="num">{codGen}</span> · {fecEmi} · <span className="num">{ambiente}</span>
        </Fila>
        <Fila titulo="Sello de recepción">
          {ticket.sello ? <span className="num">{ticket.sello.valor}</span> : "Todavía no hay sello para este ticket."}
          {ticket.sello ? <span className="nota"> Emitido {fechaHoraSv(ticket.sello.momento)}.</span> : null}
        </Fila>
      </dl>
      <p className="nota" style={{ marginTop: "0.75rem" }}>
        Vista previa armada ahora desde el ticket. No consume correlativo, así que el número puede no coincidir con el
        documento que se emitió.
      </p>
    </section>
  );
}
