import Link from "next/link";
import { connection } from "next/server";

import { LIMITE_DEFECTO, type FiltrosTickets } from "../../src/almacen/tipos.ts";
import { formatoSats, formatoUsd } from "../../src/dinero.ts";
import { almacenDeEntorno } from "../../src/servidor/configuracion.ts";
import { esDia, inicioDia } from "../../src/servidor/tiempo-sv.ts";
import { productoDeTicket, totalDeTicket, type Ticket } from "../../src/ticket.ts";
import { SinDatos } from "../_componentes/SinDatos.tsx";
import { acortar, etiquetaProducto, fechaHoraSv } from "../_componentes/formato.ts";

const DIA_MS = 86_400_000;
const PRODUCTOS = ["media", "travel", "market", "pay"] as const;
const ESTADOS = ["abierto", "pagado", "emitido", "rechazado"] as const;

export const metadata = { title: "Tickets" };

// These pages read the ledger at request time and wait for it: a blocking route, not an instant one.
export const instant = false;


type Filtros = {
  producto: string;
  estado: string;
  desde: string;
  hasta: string;
  q: string;
  despues: string;
};

function leerFiltros(sp: Record<string, string | string[] | undefined>): Filtros {
  const texto = (clave: string): string => {
    const valor = sp[clave];
    return typeof valor === "string" ? valor.trim() : "";
  };
  const producto = texto("producto");
  const estado = texto("estado");
  const despues = texto("despues");
  return {
    producto: (PRODUCTOS as readonly string[]).includes(producto) ? producto : "",
    estado: (ESTADOS as readonly string[]).includes(estado) ? estado : "",
    desde: esDia(texto("desde")) ? texto("desde") : "",
    hasta: esDia(texto("hasta")) ? texto("hasta") : "",
    q: texto("q").slice(0, 100),
    despues: despues !== "" && !Number.isNaN(Date.parse(despues)) ? despues : "",
  };
}

function aFiltrosTickets(f: Filtros): FiltrosTickets {
  const filtros: FiltrosTickets = { limite: LIMITE_DEFECTO };
  if (f.producto !== "") filtros.producto = f.producto;
  if (f.estado !== "") filtros.estado = f.estado;
  if (f.desde !== "") filtros.desde = inicioDia(f.desde);
  // "Hasta" is a day included: the upper bound is the next midnight.
  if (f.hasta !== "") filtros.hasta = new Date(inicioDia(f.hasta).getTime() + DIA_MS);
  if (f.q !== "") filtros.texto = f.q;
  if (f.despues !== "") filtros.despues = f.despues;
  return filtros;
}

function enlaceConFiltros(f: Filtros, extra: Record<string, string> = {}): string {
  const q = new URLSearchParams();
  for (const [clave, valor] of Object.entries({ producto: f.producto, estado: f.estado, desde: f.desde, hasta: f.hasta, q: f.q, ...extra })) {
    if (valor !== "") q.set(clave, valor);
  }
  const texto = q.toString();
  return texto === "" ? "/tickets" : `/tickets?${texto}`;
}

function descripcion(t: Ticket): string {
  const primera = t.lineas[0]?.descripcion ?? "";
  const resto = t.lineas.length - 1;
  const corta = acortar(primera, 60, 0);
  return resto > 0 ? `${corta} (+${resto})` : corta;
}

export default async function PaginaTickets({ searchParams }: PageProps<"/tickets">) {
  await connection();
  const filtros = leerFiltros(await searchParams);

  let lista: Ticket[] | null = null;
  try {
    lista = await almacenDeEntorno().listar(aFiltrosTickets(filtros));
  } catch (e) {
    console.error("La lista de tickets no pudo leer la base:", e);
  }

  const hayFiltros = filtros.producto !== "" || filtros.estado !== "" || filtros.desde !== "" || filtros.hasta !== "" || filtros.q !== "";
  const ultimo = lista?.[lista.length - 1];
  const verMas = lista !== null && lista.length === LIMITE_DEFECTO && ultimo !== undefined;

  return (
    <>
      <div className="encabezado">
        <h1>Tickets</h1>
        <p className="nota">Más nuevos primero. Hora de El Salvador.</p>
      </div>

      <form className="bloque filtros" method="get" action="/tickets" role="search" aria-label="Filtrar tickets">
        <label>
          Producto
          <select name="producto" defaultValue={filtros.producto}>
            <option value="">Todos</option>
            {PRODUCTOS.map((p) => (
              <option key={p} value={p}>
                {etiquetaProducto(p)}
              </option>
            ))}
          </select>
        </label>
        <label>
          Estado
          <select name="estado" defaultValue={filtros.estado}>
            <option value="">Todos</option>
            {ESTADOS.map((e) => (
              <option key={e} value={e}>
                {e}
              </option>
            ))}
          </select>
        </label>
        <label>
          Desde
          <input type="date" name="desde" defaultValue={filtros.desde} />
        </label>
        <label>
          Hasta
          <input type="date" name="hasta" defaultValue={filtros.hasta} />
        </label>
        <label>
          Buscar
          <input type="search" name="q" defaultValue={filtros.q} placeholder="Ticket, factura o producto" maxLength={100} />
        </label>
        <div>
          <button type="submit" className="boton">
            Aplicar
          </button>{" "}
          {hayFiltros ? (
            <Link className="boton secundario" href="/tickets">
              Limpiar
            </Link>
          ) : null}
        </div>
      </form>

      {lista === null ? (
        <SinDatos />
      ) : lista.length === 0 ? (
        <section className="bloque">
          <p className="vacio">
            {hayFiltros ? "No hay tickets con esos filtros." : "Todavía no hay tickets. Cuando haya una venta, aparece acá."}
          </p>
        </section>
      ) : (
        <section className="bloque" aria-label="Lista de tickets">
          <div className="tabla-caja">
            <table>
              <thead>
                <tr>
                  <th scope="col">Ticket</th>
                  <th scope="col">Fecha y hora</th>
                  <th scope="col">Producto</th>
                  <th scope="col">Descripción</th>
                  <th scope="col" className="derecha">
                    USD
                  </th>
                  <th scope="col" className="derecha">
                    Sats
                  </th>
                  <th scope="col">Estado</th>
                </tr>
              </thead>
              <tbody>
                {lista.map((t) => {
                  const pago = t.pago;
                  return (
                    <tr key={t.id}>
                      <td>
                        <Link className="enlace-fila" href={`/tickets/${t.id}`}>
                          {acortar(t.id, 14, 4)}
                        </Link>
                      </td>
                      <td className="num">{fechaHoraSv(t.creado)}</td>
                      <td>
                        <span className="producto">{etiquetaProducto(productoDeTicket(t))}</span>
                      </td>
                      <td>{descripcion(t)}</td>
                      <td className="num derecha">{formatoUsd(totalDeTicket(t).totalCentavos)}</td>
                      <td className="num derecha">{pago?.rail === "lightning" ? formatoSats(pago.sats) : "—"}</td>
                      <td>
                        <span className={`chip chip-${t.estado}`}>{t.estado}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {verMas && ultimo ? (
            <p style={{ marginTop: "1rem" }}>
              <Link className="boton secundario" href={enlaceConFiltros(filtros, { despues: ultimo.creado })}>
                Ver más
              </Link>
            </p>
          ) : null}
        </section>
      )}
    </>
  );
}
