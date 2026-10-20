import Link from "next/link";
import { connection } from "next/server";

import { formatoSats, formatoUsd } from "../src/dinero.ts";
import { almacenDeEntorno } from "../src/servidor/configuracion.ts";
import { sincronizarSiHaceFalta } from "../src/servidor/sincronizacion.ts";
import { todosEntre } from "../src/servidor/tiempo-sv.ts";
import { resumen, type Cifras } from "../src/tablero.ts";
import { productoDeTicket, totalDeTicket, type Ticket } from "../src/ticket.ts";
import { SinDatos } from "./_componentes/SinDatos.tsx";
import { SincronizarAhora } from "./_componentes/SincronizarAhora.tsx";
import { acortar, etiquetaProducto, fechaCorta, fechaHoraSv, haceCuanto, ORDEN_PRODUCTOS } from "./_componentes/formato.ts";

const DIA_MS = 86_400_000;
const VENTAS_EN_TABLA = 8;

export const metadata = { title: "Tablero" };

// These pages read the ledger at request time and wait for it: a blocking route, not an instant one.
export const instant = false;


function plural(n: number, uno: string, varios: string): string {
  return `${n} ${n === 1 ? uno : varios}`;
}

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
      <text className="eje" x="0" y={alto - 4}>
        {fechaCorta(primero)}
      </text>
      <text className="eje" x={ancho} y={alto - 4} textAnchor="end">
        {fechaCorta(ultimo)}
      </text>
    </svg>
  );
}

function Barra({ etiqueta, valor, maximo, cifra }: { etiqueta: string; valor: number; maximo: number; cifra: string }) {
  const ancho = maximo > 0 ? Math.round((valor / maximo) * 100) : 0;
  return (
    <div className="barra-fila">
      <span>{etiqueta}</span>
      <div className="barra-pista" aria-hidden="true">
        <div className="barra-valor" style={{ width: `${ancho}%` }} />
      </div>
      <span className="barra-cifra">{cifra}</span>
    </div>
  );
}

export default async function PaginaTablero() {
  await connection();
  const ahora = new Date();
  // Never throws: a slow or failing BTCPay shows up as the status line, not as a broken page.
  const sincro = await sincronizarSiHaceFalta({ ahora });

  let tickets: Ticket[] | null = null;
  try {
    tickets = await todosEntre(almacenDeEntorno(), new Date(ahora.getTime() - 60 * DIA_MS), new Date(ahora.getTime() + DIA_MS));
  } catch (e) {
    console.error("El tablero no pudo leer los tickets:", e);
  }

  let estadoTexto: string;
  if (sincro.error !== null) {
    estadoTexto = `No se pudo sincronizar: ${sincro.error}`;
    if (sincro.ultima) estadoTexto += ` Última vez con éxito: ${haceCuanto(sincro.ultima, ahora)}.`;
  } else if (sincro.ultima) {
    estadoTexto = `Sincronizado con BTCPay ${haceCuanto(sincro.ultima, ahora)}`;
  } else {
    estadoTexto = "Todavía no hay una sincronización con BTCPay.";
  }
  // The documents of this call only: 0 when the call did not run BTCPay.
  if (sincro.error === null && sincro.corrio) {
    const emision: string[] = [];
    if (sincro.emitidos > 0) emision.push(plural(sincro.emitidos, "documento emitido", "documentos emitidos"));
    if (sincro.rechazados > 0) emision.push(plural(sincro.rechazados, "documento rechazado", "documentos rechazados"));
    if (emision.length > 0) estadoTexto += `. ${emision.join(" y ")}.`;
  }

  const estadoSincro = (
    <section className="bloque" aria-label="Sincronización">
      <p role="status">{estadoTexto}</p>
      <SincronizarAhora />
    </section>
  );

  if (tickets === null) {
    return (
      <>
        <div className="encabezado">
          <h1>Tablero</h1>
        </div>
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
  const ultimas = tickets.slice(0, VENTAS_EN_TABLA);

  return (
    <>
      <div className="encabezado">
        <h1>Tablero</h1>
        <p className="nota">Mes en curso, hora de El Salvador</p>
      </div>
      {estadoSincro}

      {tickets.length === 0 ? (
        <section className="bloque">
          <p className="vacio">Todavía no hay ventas. Cuando alguien pague en Media, Travel, Market o Pay, aparece acá.</p>
        </section>
      ) : (
        <>
          <div className="cifras">
            <Cifra titulo="Hoy" cifras={r.hoy} />
            <Cifra titulo="Esta semana" cifras={r.semana} />
            <Cifra titulo="Este mes" cifras={r.mes} />
          </div>

          <div className="cifras" style={{ marginTop: "1rem" }}>
            <section className="bloque" aria-labelledby="titulo-productos" style={{ margin: 0, gridColumn: "span 1" }}>
              <h2 id="titulo-productos">Ventas por producto</h2>
              <p className="nota">Este mes, en dólares.</p>
              <div className="barras" style={{ marginTop: "0.75rem" }}>
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

            <section className="bloque" aria-labelledby="titulo-riel" style={{ margin: 0 }}>
              <h2 id="titulo-riel">Cómo te pagan</h2>
              <p className="nota">Este mes. Lightning en bitcoin y efectivo.</p>
              <div className="barras" style={{ marginTop: "0.75rem" }}>
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
          </div>

          <section className="bloque" aria-labelledby="titulo-dias">
            <h2 id="titulo-dias">Últimos 30 días</h2>
            <p className="nota">Dólares cobrados por día.</p>
            <div style={{ marginTop: "0.75rem" }}>
              <GraficoDias dias={r.porDia} />
            </div>
          </section>

          <section className="bloque" aria-labelledby="titulo-ultimas">
            <div className="encabezado" style={{ margin: 0 }}>
              <h2 id="titulo-ultimas">Últimas ventas</h2>
              <Link className="enlace-fila" href="/tickets">
                Ver todas
              </Link>
            </div>
            <div className="tabla-caja">
              <table>
                <thead>
                  <tr>
                    <th scope="col">Ticket</th>
                    <th scope="col">Fecha</th>
                    <th scope="col">Producto</th>
                    <th scope="col" className="derecha">
                      USD
                    </th>
                    <th scope="col">Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {ultimas.map((t) => (
                    <tr key={t.id}>
                      <td>
                        <Link className="enlace-fila" href={`/tickets/${t.id}`}>
                          {acortar(t.id, 14, 4)}
                        </Link>
                      </td>
                      <td className="num">{fechaHoraSv(t.creado)}</td>
                      <td>{etiquetaProducto(productoDeTicket(t))}</td>
                      <td className="num derecha">{formatoUsd(totalDeTicket(t).totalCentavos)}</td>
                      <td>
                        <span className={`chip chip-${t.estado}`}>{t.estado}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </>
  );
}
