import Link from "next/link";
import type { ReactNode } from "react";
import { after, connection } from "next/server";

import { formatoSats, formatoUsd } from "../src/dinero.ts";
import { URL_GRUPO } from "../src/grupo.ts";
import { almacenDeEntorno } from "../src/servidor/configuracion.ts";
import { sesionActual } from "../src/servidor/sesion.ts";
import { leerEstadoSincronizacion, lineaSincronizacion, sincronizarSiHaceFalta } from "../src/servidor/sincronizacion.ts";
import { todosEntre } from "../src/servidor/tiempo-sv.ts";
import { fechaHoraSalvador } from "../src/tiempo.ts";
import { resumen, type Cifras } from "../src/tablero.ts";
import type { Ticket } from "../src/ticket.ts";
import { SinDatos } from "./_componentes/SinDatos.tsx";
import { SincronizarAhora } from "./_componentes/SincronizarAhora.tsx";
import { etiquetaProducto, fechaCorta, ORDEN_PRODUCTOS } from "./_componentes/formato.ts";

const DIA_MS = 86_400_000;

export const metadata = { title: "Tablero" };

// A due sync runs after the page is sent (after()), so a slow BTCPay never shows here. The platform limit applies to
// that background run and to the owner's button, which runs under this page.
export const maxDuration = 60;

// This page is public: it shows totals only. No ticket rows, no ids, no error causes (those are for the owner).

// These pages read the ledger at request time and wait for it: a blocking route, not an instant one.
export const instant = false;

function plural(n: number, uno: string, varios: string): string {
  return `${n} ${n === 1 ? uno : varios}`;
}

// "Octubre de 2026" in El Salvador time.
function mesEnCurso(ahora: Date): string {
  const texto = new Intl.DateTimeFormat("es-SV", { month: "long", year: "numeric", timeZone: "America/El_Salvador" }).format(ahora);
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

// The headline figure: what the group sold this month.
function MesEnCurso({ cifras, ahora }: { cifras: Cifras; ahora: Date }) {
  return (
    <section className="mes" aria-labelledby="titulo-mes">
      <h2 id="titulo-mes">Este mes</h2>
      <p className="nota">{mesEnCurso(ahora)}, hora de El Salvador</p>
      <p className="monto-grande">{formatoUsd(cifras.centavos)}</p>
      <p className="detalle">
        {formatoSats(cifras.sats)} · {plural(cifras.tickets, "venta", "ventas")}
      </p>
    </section>
  );
}

// The smaller figures beside the month: today and the last seven days.
function Cifra({ titulo, cifras }: { titulo: string; cifras: Cifras }) {
  return (
    <section className="cifra" aria-labelledby={`cifra-${titulo}`}>
      <h2 id={`cifra-${titulo}`}>{titulo}</h2>
      <p className="monto">{formatoUsd(cifras.centavos)}</p>
      <p className="detalle">
        {formatoSats(cifras.sats)} · {plural(cifras.tickets, "venta", "ventas")}
      </p>
    </section>
  );
}

// Thirty bars, one per El Salvador day, drawn as inline SVG.
function GraficoDias({ dias }: { dias: { dia: string; centavos: number }[] }) {
  const ancho = 600;
  const alto = 160;
  const base = 136;
  const maximo = Math.max(1, ...dias.map((d) => d.centavos));
  const paso = ancho / dias.length;
  const primero = dias[0]?.dia ?? "";
  const ultimo = dias[dias.length - 1]?.dia ?? "";
  return (
    <svg className="grafico" viewBox={`0 0 ${ancho} ${alto}`} role="img" aria-label="Ventas por día en los últimos 30 días">
      {dias.map((d, i) => {
        const altura = Math.round((d.centavos / maximo) * (base - 8));
        return (
          <rect
            key={d.dia}
            className="barra-dia"
            x={(i * paso + paso * 0.15).toFixed(1)}
            y={base - altura}
            width={(paso * 0.7).toFixed(1)}
            height={Math.max(altura, d.centavos > 0 ? 2 : 0)}
          >
            <title>{`${fechaCorta(d.dia)}: ${formatoUsd(d.centavos)}`}</title>
          </rect>
        );
      })}
      <line x1="0" x2={ancho} y1={base + 0.5} y2={base + 0.5} stroke="currentColor" strokeOpacity="0.4" />
    </svg>
  );
}

// The amount sits above the bar, so a long figure wraps in its own row and never pushes the page sideways.
function Barra({ etiqueta, valor, maximo, cifra }: { etiqueta: string; valor: number; maximo: number; cifra: string }) {
  const ancho = maximo > 0 ? Math.round((valor / maximo) * 100) : 0;
  return (
    <div className="barra-fila">
      <p className="barra-texto">
        <span>{etiqueta}</span>
        <span className="barra-cifra">{cifra}</span>
      </p>
      <div className="barra-pista" aria-hidden="true">
        <div className="barra-valor" style={{ width: `${ancho}%` }} />
      </div>
    </div>
  );
}

export default async function PaginaTablero() {
  await connection();
  const ahora = new Date();
  // The owner sees the cause of a failed run and the sync button; everyone else sees the calm line only.
  const dueno = (await sesionActual())?.usuario.esAdmin === true;
  // The page renders from the stored rows. A due run goes to the background: no visitor waits for BTCPay.
  const lectura = await leerEstadoSincronizacion({ ahora });
  if (lectura.debeCorrer) after(() => sincronizarSiHaceFalta({ ahora: new Date() }));

  let tickets: Ticket[] | null = null;
  try {
    tickets = await todosEntre(almacenDeEntorno(), new Date(ahora.getTime() - 60 * DIA_MS), new Date(ahora.getTime() + DIA_MS));
  } catch (e) {
    console.error("El tablero no pudo leer los tickets:", e);
  }

  const estadoSincro = (
    <section id="sincronizacion" className="sincro" aria-label="Sincronización">
      <p role="status" className={lectura.error !== null && dueno ? "error" : "nota"}>
        {lineaSincronizacion(lectura, ahora, dueno)}
      </p>
      {dueno ? <SincronizarAhora /> : null}
    </section>
  );

  const intro = (
    <p className="intro">
      Lo que Grupo Cacao vendió este mes en dólares, con sus documentos tributarios.{" "}
      <a href={URL_GRUPO}>Visitar Grupo Cacao</a>
    </p>
  );

  if (tickets === null) {
    return (
      <>
        <div className="encabezado">
          <h1>Tablero</h1>
        </div>
        {intro}
        {estadoSincro}
        <SinDatos />
      </>
    );
  }

  const r = resumen(tickets, ahora);
  const maximoProducto = Math.max(1, ...r.porProducto.map((p) => p.centavos));
  const porProducto = ORDEN_PRODUCTOS.map((clave) => {
    const fila = r.porProducto.find((p) => p.producto === clave);
    return { clave, centavos: fila?.centavos ?? 0, tickets: fila?.tickets ?? 0 };
  });
  const mesRiel = r.porRiel.lightning.centavos + r.porRiel.efectivo.centavos;

  // Owner only: what needs attention first. The visitor gets none of these figures, only the totals above.
  let atencion: ReactNode = null;
  if (dueno && tickets.length > 0) {
    const pendientes = r.documentos.pendientes;
    const n = pendientes.tickets;
    atencion = (
      <section className="bloque atencion" aria-labelledby="titulo-atencion">
        <h2 id="titulo-atencion">Por atender</h2>
        {lectura.error !== null ? (
          <p>
            La última sincronización con BTCPay falló. <a href="#sincronizacion">Ver el motivo y sincronizar de nuevo</a>.
          </p>
        ) : null}
        {n > 0 ? (
          <p>
            {plural(n, "venta", "ventas")} por {formatoUsd(pendientes.centavos)} {n === 1 ? "todavía no tiene" : "todavía no tienen"}{" "}
            documento aceptado.{" "}
            <Link href={`/mes/${fechaHoraSalvador(ahora).fecEmi.slice(0, 7)}#titulo-no-incluidos`}>Ver las ventas pendientes</Link>
          </p>
        ) : (
          <p className="nota">Todas las ventas de este mes tienen documento aceptado.</p>
        )}
      </section>
    );
  }

  return (
    <>
      <div className="encabezado">
        <h1>Tablero</h1>
      </div>
      {intro}

      <div className="inicio">
        <MesEnCurso cifras={r.mes} ahora={ahora} />
        <div className="secundarias">
          <Cifra titulo="Hoy" cifras={r.hoy} />
          <Cifra titulo="Esta semana" cifras={r.semana} />
        </div>
      </div>

      {atencion}
      {estadoSincro}

      {tickets.length === 0 ? (
        <section className="bloque">
          <p className="vacio">Todavía no hay ventas. Cuando alguien pague en Media, Travel, Market o Pay, aparece acá.</p>
        </section>
      ) : (
        <div className="cifras detalles">
          <section className="bloque" aria-labelledby="titulo-productos">
            <h2 id="titulo-productos">Ventas por producto</h2>
            <p className="nota">Este mes, en dólares.</p>
            <div className="barras">
              {porProducto.map((p) => (
                <Barra
                  key={p.clave}
                  etiqueta={etiquetaProducto(p.clave)}
                  valor={p.centavos}
                  maximo={maximoProducto}
                  cifra={formatoUsd(p.centavos)}
                />
              ))}
            </div>
          </section>

          <section className="bloque" aria-labelledby="titulo-riel">
            <h2 id="titulo-riel">Cómo te pagan</h2>
            <p className="nota">Este mes. Lightning en bitcoin y efectivo.</p>
            <div className="barras">
              <Barra
                etiqueta="Lightning"
                valor={r.porRiel.lightning.centavos}
                maximo={Math.max(1, mesRiel)}
                cifra={`${formatoUsd(r.porRiel.lightning.centavos)} · ${plural(r.porRiel.lightning.tickets, "venta", "ventas")}`}
              />
              <Barra
                etiqueta="Efectivo"
                valor={r.porRiel.efectivo.centavos}
                maximo={Math.max(1, mesRiel)}
                cifra={`${formatoUsd(r.porRiel.efectivo.centavos)} · ${plural(r.porRiel.efectivo.tickets, "venta", "ventas")}`}
              />
            </div>
          </section>

          <section className="bloque dias" aria-labelledby="titulo-dias">
            <h2 id="titulo-dias">Últimos 30 días</h2>
            <p className="nota">Dólares cobrados por día.</p>
            <div className="grafico-caja">
              <GraficoDias dias={r.porDia} />
              <div className="eje-fila">
                <span>{fechaCorta(r.porDia[0]?.dia ?? "")}</span>
                <span>{fechaCorta(r.porDia[r.porDia.length - 1]?.dia ?? "")}</span>
              </div>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
