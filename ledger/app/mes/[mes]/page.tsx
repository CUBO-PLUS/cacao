import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";

import { formatoUsd } from "../../../src/dinero.ts";
import { almacenDeEntorno } from "../../../src/servidor/configuracion.ts";
import { accesoDeDueno } from "../../../src/servidor/sesion.ts";
import { informeDelMes } from "../../../src/servidor/informe.ts";
import { esMes, mesDesplazado } from "../../../src/servidor/tiempo-sv.ts";
import { SUPUESTOS, type InformeMes } from "../../../src/mes.ts";
import { SinAcceso } from "../../_componentes/SinAcceso.tsx";
import { SinDatos } from "../../_componentes/SinDatos.tsx";
import { fechaCorta } from "../../_componentes/formato.ts";

const MESES = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
];

export const metadata = { title: "Mes" };

// These pages read the ledger at request time and wait for it: a blocking route, not an instant one.
export const instant = false;


function nombreMes(mes: string): string {
  const [a, m] = mes.split("-").map(Number) as [number, number];
  return `${MESES[m - 1]} de ${a}`;
}

function Selector({ mes }: { mes: string }) {
  return (
    <nav className="encabezado" aria-label="Elegir mes">
      <Link className="boton secundario" href={`/mes/${mesDesplazado(mes, -1)}`}>
        ← {nombreMes(mesDesplazado(mes, -1)).split(" de ")[0]}
      </Link>
      <h1>{nombreMes(mes)}</h1>
      <Link className="boton secundario" href={`/mes/${mesDesplazado(mes, 1)}`}>
        {nombreMes(mesDesplazado(mes, 1)).split(" de ")[0]} →
      </Link>
    </nav>
  );
}

function Cifras({ informe }: { informe: InformeMes }) {
  const c = informe.cifras;
  const filas: [string, number, string][] = [
    ["Ventas a contribuyentes, sin IVA", c.f07VentasContribuyentesNetoCentavos, "F-07, ventas gravadas a contribuyentes (Anexo 1)"],
    ["Ventas a consumidor final, sin IVA", c.f07VentasConsumidorNetoCentavos, "F-07, ventas gravadas a consumidor final (Anexo 2)"],
    ["Base gravada del mes, sin IVA", c.f07BaseGravadaCentavos, "F-07, base total sin IVA"],
    ["Débito fiscal de IVA del mes (13 %)", c.f07DebitoIvaCentavos, "F-07, débito fiscal"],
    ["Ingresos brutos del mes, sin IVA", c.f14IngresosBrutosCentavos, "F-14, base del pago a cuenta"],
    ["Pago a cuenta de 1.75 %", c.f14PagoACuentaCentavos, "F-14, pago a cuenta por rama económica"],
  ];
  return (
    <section className="bloque" aria-labelledby="titulo-cifras">
      <h2 id="titulo-cifras">Cifras para las declaraciones</h2>
      <div className="tabla-caja">
        <table>
          <thead>
            <tr>
              <th scope="col">Cifra</th>
              <th scope="col" className="derecha">
                Monto
              </th>
              <th scope="col">Formulario</th>
            </tr>
          </thead>
          <tbody>
            {filas.map(([cifra, centavos, formulario]) => (
              <tr key={cifra}>
                <td>{cifra}</td>
                <td className="num derecha">{formatoUsd(centavos)}</td>
                <td>{formulario}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="nota" style={{ marginTop: "0.75rem" }}>
        {informe.nota} F-07: dentro de los primeros 10 días hábiles del mes siguiente (por confirmar). F-14: pago a cuenta del
        1.75 % sobre ingresos brutos, Art. 151 CT (por confirmar).
      </p>
    </section>
  );
}

// What the figures assume and what they do not prove. Shown on the month page, next to the figures they feed.
function Supuestos() {
  return (
    <section className="aviso" aria-labelledby="titulo-supuestos">
      <h2 id="titulo-supuestos">Supuestos</h2>
      <ul style={{ marginTop: "0.5rem" }}>
        {SUPUESTOS.map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ul>
    </section>
  );
}

function LibroConsumidor({ informe }: { informe: InformeMes }) {
  return (
    <section className="bloque" aria-labelledby="titulo-consumidor">
      <h2 id="titulo-consumidor">Libro de ventas a consumidor final (01)</h2>
      <div className="tabla-caja">
        <table>
          <thead>
            <tr>
              <th scope="col">Fecha</th>
              <th scope="col">Primer control</th>
              <th scope="col">Último control</th>
              <th scope="col" className="derecha">
                Docs
              </th>
              <th scope="col" className="derecha">
                Ventas (IVA incl.)
              </th>
            </tr>
          </thead>
          <tbody>
            {informe.consumidor.filas.map((f) => (
              <tr key={f.fecha}>
                <td className="num">{fechaCorta(f.fecha)}</td>
                <td className="num">{f.primerControl ?? "sin ventas"}</td>
                <td className="num">{f.ultimoControl ?? ""}</td>
                <td className="num derecha">{f.cantidad}</td>
                <td className="num derecha">{f.cantidad > 0 ? formatoUsd(f.ventasGravadasCentavos) : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p style={{ marginTop: "0.75rem" }}>
        Total del mes: {informe.consumidor.cantidad} {informe.consumidor.cantidad === 1 ? "documento" : "documentos"},{" "}
        <span className="num">{formatoUsd(informe.consumidor.ventasGravadasCentavos)}</span>
      </p>
    </section>
  );
}

function LibroContribuyentes({ informe }: { informe: InformeMes }) {
  const c = informe.contribuyentes;
  return (
    <section className="bloque" aria-labelledby="titulo-contribuyentes">
      <h2 id="titulo-contribuyentes">Libro de ventas a contribuyentes (03)</h2>
      {c.filas.length === 0 ? (
        <p className="vacio">No hay comprobantes de crédito fiscal emitidos este mes.</p>
      ) : (
        <div className="tabla-caja">
          <table>
            <thead>
              <tr>
                <th scope="col">Fecha</th>
                <th scope="col">Número de control</th>
                <th scope="col">Receptor</th>
                <th scope="col" className="derecha">
                  Neto
                </th>
                <th scope="col" className="derecha">
                  IVA
                </th>
                <th scope="col" className="derecha">
                  Total
                </th>
              </tr>
            </thead>
            <tbody>
              {c.filas.map((f) => (
                <tr key={f.codigoGeneracion}>
                  <td className="num">{fechaCorta(f.fecha)}</td>
                  <td className="num">{f.numeroControl}</td>
                  <td>{f.receptorNombre}</td>
                  <td className="num derecha">{formatoUsd(f.netoCentavos)}</td>
                  <td className="num derecha">{formatoUsd(f.ivaCentavos)}</td>
                  <td className="num derecha">{formatoUsd(f.totalCentavos)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p style={{ marginTop: "0.75rem" }}>
        Total del mes: {c.cantidad}, neto <span className="num">{formatoUsd(c.netoCentavos)}</span>, IVA{" "}
        <span className="num">{formatoUsd(c.ivaCentavos)}</span>, total <span className="num">{formatoUsd(c.totalCentavos)}</span>
      </p>
    </section>
  );
}

export default async function PaginaMes({ params }: PageProps<"/mes/[mes]">) {
  await connection();
  const { mes } = await params;
  // Owner only. The check runs before the first read of the ledger.
  if (!(await accesoDeDueno(`/mes/${mes}`))) return <SinAcceso />;
  if (!esMes(mes)) notFound();

  let informe: InformeMes;
  try {
    informe = await informeDelMes(almacenDeEntorno(), mes);
  } catch (e) {
    console.error(`El mes ${mes} no pudo leerse:`, e);
    return (
      <>
        <Selector mes={mes} />
        <SinDatos />
      </>
    );
  }

  const csv = [
    ["consumidor", "Libro de consumidor final (01)"],
    ["contribuyentes", "Libro de contribuyentes (03)"],
    ["anexo1", "Anexo 1 para el F-07"],
    ["anexo2", "Anexo 2 para el F-07"],
  ] as const;

  return (
    <>
      <Selector mes={mes} />
      <section className="bloque" aria-labelledby="titulo-descargas">
        <h2 id="titulo-descargas">Descargar CSV</h2>
        <p className="nota">Separados por punto y coma, en UTF-8. Para el contador y el portal de la DGII.</p>
        <div className="acciones">
          {csv.map(([libro, texto]) => (
            <a key={libro} className="boton secundario" href={`/mes/${mes}/csv/${libro}`}>
              {texto}
            </a>
          ))}
        </div>
      </section>

      <Cifras informe={informe} />
      <Supuestos />
      <LibroConsumidor informe={informe} />
      <LibroContribuyentes informe={informe} />

      <section className="bloque" aria-labelledby="titulo-no-incluidos">
        <h2 id="titulo-no-incluidos">No incluidos</h2>
        <p className="nota">Tickets con dinero recibido y sin documento con sello.</p>
        {informe.noIncluidos.length === 0 ? (
          <p className="vacio">Ninguno este mes.</p>
        ) : (
          <ul className="lineas" style={{ marginTop: "0.5rem" }}>
            {informe.noIncluidos.map((n) => (
              <li key={n.ticket}>
                <Link className="enlace-fila" href={`/tickets/${n.ticket}`}>
                  {n.ticket}
                </Link>
                <span className="num">{fechaCorta(n.fecha)}</span>
                <span>{n.cliente}</span>
                <span className="chip">{n.estado}</span>
                <span className="nota">{n.motivo}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
