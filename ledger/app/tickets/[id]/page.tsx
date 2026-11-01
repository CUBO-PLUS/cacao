import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import * as QRCode from "qrcode";

import { formatoSats, formatoUsd } from "../../../src/dinero.ts";
import type { RegistroDte } from "../../../src/almacen/dtes.ts";
import { almacenAtestacionesDeEntorno, almacenDeEntorno, almacenDtesDeEntorno } from "../../../src/servidor/configuracion.ts";
import type { FilaAtestacion } from "../../../src/almacen/atestaciones.ts";
import { accesoDeDueno } from "../../../src/servidor/sesion.ts";
import { vistaDte } from "../../../src/servidor/vista-dte.ts";
import { modalidadDe, productoDeTicket, totalDeTicket, type Ticket } from "../../../src/ticket.ts";
import { SinAcceso } from "../../_componentes/SinAcceso.tsx";
import { SinDatos } from "../../_componentes/SinDatos.tsx";
import { etiquetaProducto, fechaHoraSv, acortar } from "../../_componentes/formato.ts";
import { ImprimirBoton } from "./ImprimirBoton.tsx";
import { ReintentarEmision } from "./ReintentarEmision.tsx";
import { URL_CONSULTA, VersionLegible } from "./VersionLegible.tsx";
import { VerificarCadena } from "./VerificarCadena.tsx";

const FORMATO_ID = /^TK-\d{8}-[0-9A-F]{4}$/;

export const metadata = { title: "Ticket" };

// These pages read the ledger at request time and wait for it: a blocking route, not an instant one.
export const instant = false;


function Fila({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <div>
      <dt>{titulo}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function Totales({ ticket }: { ticket: Ticket }) {
  const total = totalDeTicket(ticket);
  if (modalidadDe(ticket.cliente) === "con-iva") {
    return (
      <dl className="dl">
        <Fila titulo="Total con IVA incluido">
          <span className="num">{formatoUsd(total.totalCentavos)}</span>
        </Fila>
        <Fila titulo="IVA contenido (13/113)">
          <span className="num">{formatoUsd(total.ivaCentavos)}</span>
        </Fila>
        <Fila titulo="Neto">
          <span className="num">{formatoUsd(total.netoCentavos)}</span>
        </Fila>
      </dl>
    );
  }
  return (
    <dl className="dl">
      <Fila titulo="Subtotal sin IVA">
        <span className="num">{formatoUsd(total.gravadoCentavos)}</span>
      </Fila>
      <Fila titulo="IVA 13 %">
        <span className="num">{formatoUsd(total.ivaCentavos)}</span>
      </Fila>
      <Fila titulo="Total a pagar">
        <span className="num">{formatoUsd(total.totalCentavos)}</span>
      </Fila>
    </dl>
  );
}

function SeccionPago({ ticket }: { ticket: Ticket }) {
  const p = ticket.pago;
  if (p === null) {
    return (
      <section className="bloque" aria-labelledby="titulo-pago">
        <h2 id="titulo-pago">Pago</h2>
        <p className="nota">Todavía no hay cobro para este ticket.</p>
      </section>
    );
  }
  return (
    <section className="bloque" aria-labelledby="titulo-pago">
      <h2 id="titulo-pago">Pago</h2>
      <dl className="dl">
        <Fila titulo="Medio">{p.rail === "lightning" ? "Lightning (bitcoin)" : "Efectivo"}</Fila>
        <Fila titulo="Monto">
          <span className="num">{formatoUsd(p.montoCentavos)}</span>
        </Fila>
        {p.rail === "lightning" ? (
          <>
            <Fila titulo="Sats recibidos">
              <span className="num">{formatoSats(p.sats)}</span>
            </Fila>
            <Fila titulo="Tasa">
              <span className="num">{`${p.tasaUsdPorBtc} USD/BTC`}</span>
            </Fila>
            <Fila titulo="Fuente de la tasa">{p.tasaFuente}</Fila>
            <Fila titulo="Hash del pago">
              <span className="hash">{p.paymentHash}</span>
            </Fila>
          </>
        ) : null}
        <Fila titulo="Momento">{fechaHoraSv(p.momento)}</Fila>
      </dl>
    </section>
  );
}

// The document the web emitted for this ticket (ledger_dtes): real numbers and the simulated seal.
function DocumentoEmitido({ registro }: { registro: RegistroDte }) {
  if (registro.estado === "reservado") {
    return (
      <p className="nota">
        El número {registro.correlativo ?? ""} ya está reservado para este ticket. El documento se completa en la próxima sincronización.
      </p>
    );
  }
  if (registro.estado === "contingencia") {
    return (
      <>
        <dl className="dl">
          <Fila titulo="Estado">
            <span className="chip">En contingencia</span> <span className="aviso-simulado">SIMULADO</span>
          </Fila>
          <Fila titulo="Tipo de documento">{registro.tipoDte === "01" ? "Factura (01)" : "Comprobante de crédito fiscal (03)"}</Fila>
          <Fila titulo="Número de control">
            <span className="num">{registro.numeroControl}</span>
          </Fila>
          <Fila titulo="Código de generación">
            <span className="num">{registro.codigoGeneracion}</span>
          </Fila>
          <Fila titulo="Sello de recepción">Todavía no: espera la transmisión simulada</Fila>
        </dl>
        <p className="nota" style={{ marginTop: "0.5rem" }}>
          Emitido durante una caída simulada de Hacienda (tipo de transmisión 2). Se transmite cuando la recepción vuelva, dentro de
          24 horas. Ningún servicio del Ministerio lo recibió.
        </p>
      </>
    );
  }
  const aceptado = registro.estado === "aceptado";
  const conDocumento = Object.keys(registro.documento as object).length > 0;
  return (
    <>
      <dl className="dl">
        <Fila titulo="Estado">
          <span className={`chip chip-${aceptado ? "emitido" : "rechazado"}`}>{aceptado ? "Emitido" : "Rechazado"}</span>
        </Fila>
        <Fila titulo="Tipo de documento">{registro.tipoDte === "01" ? "Factura (01)" : "Comprobante de crédito fiscal (03)"}</Fila>
        <Fila titulo="Número de control">
          <span className="num">{registro.numeroControl}</span>
        </Fila>
        <Fila titulo="Código de generación">
          <span className="num">{registro.codigoGeneracion}</span>
        </Fila>
        <Fila titulo="Ambiente">{registro.ambiente === "00" ? "00, de pruebas" : "01, de producción"}</Fila>
        <Fila titulo="Fecha de recepción">{fechaHoraSv(registro.creado)}</Fila>
        {aceptado && registro.sello ? (
          <Fila titulo="Sello de recepción">
            <span className="hash">{registro.sello}</span>
          </Fila>
        ) : null}
      </dl>
      {aceptado ? (
        <p className="nota" style={{ marginTop: "0.5rem" }}>
          El sello es simulado: ningún servicio del Ministerio de Hacienda lo emitió.
        </p>
      ) : (
        <div className="aviso" style={{ marginTop: "0.75rem" }}>
          <p>La recepción simulada rechazó el documento. Observaciones:</p>
          <ul>
            {(registro.motivo ?? "").split("\n").map((o, i) => (
              <li key={i}>{o}</li>
            ))}
          </ul>
        </div>
      )}
      {conDocumento ? (
        <div className="acciones no-imprimir" style={{ marginTop: "0.75rem" }}>
          <a className="boton" href={`/tickets/${registro.ticketId}/json`}>
            Descargar JSON
          </a>
        </div>
      ) : null}
    </>
  );
}

// What the document cannot hold, for a Lightning payment: the bitcoin amount, the rate and where it came from, the
// payment hash, and the document it belongs to. Each record carries the hash of the one before it; "Verificar cadena"
// recomputes every hash of the whole chain on the server.
function AtestacionTasa({ ticket, registro, fila }: { ticket: Ticket; registro: RegistroDte | null; fila: FilaAtestacion | null }) {
  const p = ticket.pago;
  if (p === null || p.rail !== "lightning") return null;
  return (
    <section className="bloque" aria-labelledby="titulo-atestacion">
      <h2 id="titulo-atestacion">Atestación de tasa</h2>
      <p className="nota">Lo que la factura no puede contener: cuántos bitcoin entraron y a qué tasa.</p>
      <dl className="dl">
        <Fila titulo="Bitcoin recibido">
          <span className="num">{formatoSats(p.sats)}</span>
        </Fila>
        <Fila titulo="Monto en USD">
          <span className="num">{formatoUsd(p.montoCentavos)}</span>
        </Fila>
        <Fila titulo="Tasa">
          <span className="num">{`${p.tasaUsdPorBtc} USD/BTC`}</span>
        </Fila>
        <Fila titulo="Fuente de la tasa">{p.tasaFuente}</Fila>
        <Fila titulo="Momento del pago">{fechaHoraSv(p.momento)}</Fila>
        <Fila titulo="Hash del pago">
          <span className="hash">{p.paymentHash}</span>
        </Fila>
        <Fila titulo="Documento al que pertenece">
          {registro !== null ? (
            <span className="num">{registro.codigoGeneracion}</span>
          ) : (
            "Todavía sin documento: la atestación se completa al emitirlo"
          )}
        </Fila>
      </dl>
      {fila !== null ? (
        <>
          <h3 style={{ marginTop: "0.75rem" }}>Cadena de atestaciones</h3>
          <dl className="dl">
            <Fila titulo="Posición en la cadena">
              <span className="num">{fila.orden}</span>
            </Fila>
            <Fila titulo="Hash de este registro">
              <span className="hash">{fila.hash}</span>
            </Fila>
            <Fila titulo="Hash del registro anterior">
              <span className="hash">{fila.anterior}</span>
            </Fila>
          </dl>
          <VerificarCadena />
        </>
      ) : (
        <p className="nota" style={{ marginTop: "0.5rem" }}>
          Este ticket todavía no tiene registro en la cadena de atestaciones.
        </p>
      )}
      <p className="nota" style={{ marginTop: "0.5rem" }}>
        Cada registro lleva el hash del anterior. Si alguien cambia un número de un registro, la verificación lo marca.
      </p>
    </section>
  );
}

export default async function PaginaTicket({ params }: PageProps<"/tickets/[id]">) {
  await connection();
  const { id } = await params;
  // Owner only. The check runs before the first read of the ledger.
  if (!(await accesoDeDueno(`/tickets/${id}`))) return <SinAcceso />;
  if (!FORMATO_ID.test(id)) notFound();

  let ticket: Ticket | null;
  try {
    ticket = await almacenDeEntorno().porId(id);
  } catch (e) {
    console.error(`El ticket ${id} no pudo leerse:`, e);
    return (
      <>
        <p className="volver">
          <Link href="/tickets">Volver a la lista</Link>
        </p>
        <SinDatos />
      </>
    );
  }
  if (ticket === null) notFound();

  let fila: FilaAtestacion | null = null;
  try {
    fila = await almacenAtestacionesDeEntorno().porTicket(id);
  } catch (e) {
    console.error(`La atestación del ticket ${id} no pudo leerse:`, e);
  }

  // A stored document wins over the preview. If the documents table cannot be read, the page shows the preview.
  let registro: RegistroDte | null = null;
  try {
    registro = await almacenDtesDeEntorno().porTicket(id);
  } catch (e) {
    console.error(`El documento del ticket ${id} no pudo leerse:`, e);
  }

  const origen = ticket.origen;
  const vista = vistaDte(ticket);
  const qrSvg = await QRCode.toString(URL_CONSULTA, { type: "svg", margin: 1, errorCorrectionLevel: "M" });
  // The legible version of the stored document, when it was accepted: its own numbers, never the preview's.
  const emitidoAceptado = registro !== null && registro.estado === "aceptado" && Object.keys(registro.documento as object).length > 0;

  return (
    <>
      <p className="volver">
        <Link href="/tickets">Volver a la lista</Link>
      </p>
      <div className="encabezado">
        <h1>
          Ticket <span className="num">{ticket.id}</span>
        </h1>
        <span className={`chip chip-${ticket.estado}`}>{ticket.estado}</span>
      </div>

      <section className="bloque" aria-labelledby="titulo-datos">
        <h2 id="titulo-datos">Datos</h2>
        <dl className="dl">
          <Fila titulo="Cliente">{ticket.cliente === "consumidor" ? "Consumidor final (01)" : "Contribuyente (03)"}</Fila>
          <Fila titulo="Creado">{fechaHoraSv(ticket.creado)}</Fila>
          <Fila titulo="Producto">
            <span className="producto">{etiquetaProducto(productoDeTicket(ticket))}</span>
          </Fila>
          {origen?.plataforma === "btcpay" ? (
            <Fila titulo="Factura de BTCPay">
              <span className="num">{origen.numero}</span>
            </Fila>
          ) : null}
          {origen?.plataforma === "cacaomarket" ? (
            <Fila titulo="Pedido de CacaoMarket">
              <span className="num">{origen.numero}</span>
            </Fila>
          ) : null}
          {ticket.contingencia ? (
            <Fila titulo="Contingencia (simulada)">
              <span className="aviso-simulado">SIMULADO</span>{" "}
              {ticket.contingencia.transmitida
                ? `Emitida durante la caída simulada de Hacienda; transmitida (simulada) el ${fechaHoraSv(ticket.contingencia.transmitida.momento)}.`
                : `Emitida durante la caída simulada de Hacienda el ${fechaHoraSv(ticket.contingencia.desde)}; espera la transmisión.`}
            </Fila>
          ) : null}
          {ticket.receptor ? (
            <>
              <Fila titulo="Receptor">{ticket.receptor.nombre}</Fila>
              <Fila titulo="NIT del receptor">
                <span className="num">{ticket.receptor.nit}</span>
              </Fila>
              <Fila titulo="NRC del receptor">
                <span className="num">{ticket.receptor.nrc}</span>
              </Fila>
            </>
          ) : null}
        </dl>
      </section>

      <section className="bloque" aria-labelledby="titulo-lineas">
        <h2 id="titulo-lineas">Líneas</h2>
        <ul className="lineas">
          {ticket.lineas.map((l, i) => (
            <li key={i}>
              <span>{l.descripcion}</span>
              <span className="num">{`${l.cantidad} × ${formatoUsd(l.precioCentavos)} = ${formatoUsd(l.precioCentavos * l.cantidad)}`}</span>
            </li>
          ))}
        </ul>
        <div style={{ marginTop: "0.75rem" }}>
          <Totales ticket={ticket} />
        </div>
      </section>

      <SeccionPago ticket={ticket} />

      <section className="bloque" aria-labelledby="titulo-documento">
        <h2 id="titulo-documento">Documento tributario</h2>
        {registro !== null ? (
          <>
            <DocumentoEmitido registro={registro} />
            {emitidoAceptado ? (
              <>
                <VersionLegible
                  ticket={ticket}
                  documento={registro.documento as Record<string, unknown>}
                  totalCentavos={totalDeTicket(ticket).totalCentavos}
                  sello={registro.sello}
                  emitido
                  qrSvg={qrSvg}
                />
                <div className="acciones no-imprimir">
                  <ImprimirBoton />
                </div>
              </>
            ) : null}
          </>
        ) : vista.ok ? (
          <>
            <p className="nota">Vista previa: este documento todavía no se emitió. El número y el código son de demostración.</p>
            <VersionLegible
              ticket={ticket}
              documento={vista.resultado.documento}
              totalCentavos={vista.resultado.totales.totalCentavos}
              sello={ticket.sello?.valor ?? null}
              emitido={false}
              qrSvg={qrSvg}
            />
            <div className="acciones no-imprimir">
              <ImprimirBoton />
            </div>
            <p className="nota" style={{ marginTop: "0.5rem" }}>
              Forma de pago: {vista.resultado.formaPago.codigo}. Esquema {vista.resultado.generacion}, ambiente{" "}
              {vista.resultado.ambiente === "00" ? "de pruebas" : "de producción"}. Código{" "}
              <span className="num">{acortar(vista.resultado.codigoGeneracion, 8, 4)}</span>.
            </p>
          </>
        ) : (
          <p className="nota">{vista.motivo}</p>
        )}
        {registro === null && ticket.rechazo ? (
          <div className="aviso" style={{ marginTop: "0.75rem" }}>
            <p>Rechazado el {fechaHoraSv(ticket.rechazo.momento)}. Observaciones:</p>
            <ul>
              {ticket.rechazo.observaciones.map((o, i) => (
                <li key={i}>{o}</li>
              ))}
            </ul>
          </div>
        ) : null}
        {ticket.estado === "rechazado" ? <ReintentarEmision ticketId={ticket.id} /> : null}
      </section>
      <AtestacionTasa ticket={ticket} registro={registro} fila={fila} />
    </>
  );
}
