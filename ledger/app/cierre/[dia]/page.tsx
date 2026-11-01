import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";

import { ETIQUETAS, GRUPOS, montoFila, textoPlazo, type FilaCierre, type Grupo, type InformeCierre } from "../../../src/cierre.ts";
import { formatoUsd } from "../../../src/dinero.ts";
import { almacenDeEntorno } from "../../../src/servidor/configuracion.ts";
import { informeDelDia } from "../../../src/servidor/informe.ts";
import { accesoDeDueno } from "../../../src/servidor/sesion.ts";
import { diaDesplazado, esDia, hoySv } from "../../../src/servidor/tiempo-sv.ts";
import { SinAcceso } from "../../_componentes/SinAcceso.tsx";
import { SinDatos } from "../../_componentes/SinDatos.tsx";
import { fechaCorta } from "../../_componentes/formato.ts";

export const metadata = { title: "Cierre del día" };

// These pages read the ledger at request time and wait for it: a blocking route, not an instant one.
export const instant = false;

function Selector({ dia, hoy }: { dia: string; hoy: string }) {
  return (
    <nav className="encabezado" aria-label="Elegir día">
      <Link className="boton secundario" href={`/cierre/${diaDesplazado(dia, -1)}`}>
        ← {fechaCorta(diaDesplazado(dia, -1))}
      </Link>
      <h1>Cierre del {fechaCorta(dia)}</h1>
      {dia < hoy ? (
        <Link className="boton secundario" href={`/cierre/${diaDesplazado(dia, 1)}`}>
          {fechaCorta(diaDesplazado(dia, 1))} →
        </Link>
      ) : (
        <span className="nota">Hoy</span>
      )}
    </nav>
  );
}

// One ticket of the close: its link, the day, the amount and what it still lacks.
function Linea({ f }: { f: FilaCierre }) {
  const plazo = textoPlazo(f);
  return (
    <li>
      <Link className="enlace-fila" href={`/tickets/${f.ticket}`}>
        {f.ticket}
      </Link>
      <span className="num">{fechaCorta(f.fecha)}</span>
      <span className="num">{montoFila(f)}</span>
      {plazo !== null ? <span className={`chip ${f.vencido ? "chip-rechazado" : ""}`.trim()}>{plazo}</span> : null}
      <span className="nota">{f.motivo}</span>
    </li>
  );
}

function Grupo({ g, informe }: { g: Grupo; informe: InformeCierre }) {
  const t = informe.totales[g];
  const filas = informe.grupos[g];
  return (
    <section className="bloque" aria-labelledby={`titulo-${g}`}>
      <h2 id={`titulo-${g}`}>{ETIQUETAS[g]}</h2>
      <p className="nota">
        {t.cantidad} {t.cantidad === 1 ? "cobro" : "cobros"}
        {t.cantidad > 0 ? ` · ${formatoUsd(t.usdCentavos)}` : ""}
      </p>
      {filas.length === 0 ? (
        <p className="vacio">Ninguno.</p>
      ) : (
        <ul className="lineas" style={{ marginTop: "0.5rem" }}>
          {filas.map((f) => (
            <Linea key={f.ticket} f={f} />
          ))}
        </ul>
      )}
    </section>
  );
}

export default async function PaginaCierre({ params }: PageProps<"/cierre/[dia]">) {
  await connection();
  const { dia } = await params;
  // Owner only. The check runs before the first read of the ledger.
  if (!(await accesoDeDueno(`/cierre/${dia}`))) return <SinAcceso />;
  if (!esDia(dia)) notFound();
  const ahora = new Date();
  const hoy = hoySv(ahora);
  let informe: InformeCierre;
  try {
    informe = await informeDelDia(almacenDeEntorno(), dia, ahora);
  } catch (e) {
    console.error(`El cierre del ${dia} no pudo leerse:`, e);
    return (
      <>
        <Selector dia={dia} hoy={hoy} />
        <SinDatos />
      </>
    );
  }
  return (
    <>
      <Selector dia={dia} hoy={hoy} />
      <p role="status" className={informe.todosConSello ? "nota" : "aviso"} style={{ marginTop: "0.5rem" }}>
        {informe.respuesta}
      </p>
      <p className="nota" style={{ marginTop: "0.5rem" }}>
        Control operativo, no una declaración: no hay reporte diario obligatorio. Un documento rechazado debe reenviarse
        dentro de 24 horas (cifra por confirmar). Los sellos son simulados: ningún servicio del Ministerio de Hacienda los emitió.
      </p>
      {GRUPOS.map((g) => (
        <Grupo key={g} g={g} informe={informe} />
      ))}
    </>
  );
}
