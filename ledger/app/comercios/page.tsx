import { connection } from "next/server";

import { leerIndiceComercios, leerRegistroComercio } from "../../src/comercio/almacen.ts";
import {
  credencialesDelComercio,
  enmascararNit,
  estadoCifrado,
  etiquetaEstadoCifrado,
  hayClaveMaestra,
  type CredencialVista,
  type EstadoCifrado,
} from "../../src/comercio/vista.ts";
import { dirDatos } from "../../src/datos.ts";
import { clientesApi, type ClienteApiVista } from "../../src/servidor/api.ts";
import { supabaseDeEntorno } from "../../src/servidor/configuracion.ts";
import { accesoDeDueno } from "../../src/servidor/sesion.ts";
import { SinAcceso } from "../_componentes/SinAcceso.tsx";
import { SinDatos } from "../_componentes/SinDatos.tsx";
import { fechaHoraSv } from "../_componentes/formato.ts";

export const metadata = { title: "Comercios" };

// These pages read the ledger at request time and wait for it: a blocking route, not an instant one.
export const instant = false;

type FilaComercio = {
  id: string;
  nitMascarado: string;
  estado: EstadoCifrado;
  creado: string;
  credenciales: CredencialVista[];
};

// Read-only. Only yes/no answers and masked text leave the server: the ciphertext and the NIT are never printed.
function leerFilas(): { filas: FilaComercio[]; claveMaestra: boolean } {
  const carpeta = dirDatos();
  const indice = leerIndiceComercios(carpeta);
  const filas = indice.comercios.map((c) => {
    let forma: { sobreDek?: unknown; material?: unknown } | null = null;
    try {
      forma = leerRegistroComercio(carpeta, c.id);
    } catch (e) {
      console.error(`El comercio "${c.id}" no pudo leerse:`, e);
    }
    return {
      id: c.id,
      nitMascarado: enmascararNit(c.nit),
      estado: estadoCifrado(forma),
      creado: c.creado,
      credenciales: credencialesDelComercio(forma),
    };
  });
  return { filas, claveMaestra: hayClaveMaestra(process.env) };
}

function Si({ valor }: { valor: boolean }) {
  return <span className={`chip ${valor ? "chip-emitido" : ""}`.trim()}>{valor ? "Sí" : "No"}</span>;
}

export default async function PaginaComercios() {
  await connection();
  // Owner only. The check runs before the first read of the merchant store.
  if (!(await accesoDeDueno("/comercios"))) return <SinAcceso />;

  let datos: { filas: FilaComercio[]; claveMaestra: boolean } | null = null;
  try {
    datos = leerFilas();
  } catch (e) {
    console.error("La lista de comercios no pudo leerse:", e);
  }
  // The published site has no merchant folder; there the merchants are the API clients in the database.
  let clientes: ClienteApiVista[] | null = null;
  if (supabaseDeEntorno() !== null) {
    try {
      clientes = await clientesApi();
    } catch (e) {
      console.error("Los clientes de la API no pudieron leerse:", e);
    }
  }
  if (datos === null) {
    return (
      <>
        <div className="encabezado">
          <h1>Comercios</h1>
        </div>
        <SinDatos />
      </>
    );
  }

  return (
    <>
      <div className="encabezado">
        <h1>Comercios</h1>
        <p className="nota">Solo lectura. Las credenciales se muestran como sí o no; nunca sus valores.</p>
      </div>

      <section className="bloque" aria-labelledby="titulo-clave">
        <h2 id="titulo-clave">Clave maestra</h2>
        <p className="nota" style={{ marginTop: "0.5rem" }}>
          Variable LEDGER_CLAVE_MAESTRA en el servidor: <Si valor={datos.claveMaestra} />
        </p>
      </section>

      {clientes !== null && (
        <section className="bloque" aria-labelledby="titulo-clientes">
          <h2 id="titulo-clientes">Clientes de la API</h2>
          <p className="nota" style={{ marginTop: "0.5rem" }}>
            Cada producto o negocio que registra ventas tiene su propia clave. Aquí solo se ve el inicio de la clave; la
            base guarda su hash, nunca la clave.
          </p>
          {clientes.length === 0 ? (
            <p className="vacio">Todavía no hay clientes de la API.</p>
          ) : (
            <div style={{ overflowX: "auto", marginTop: "0.5rem" }}>
              <table>
                <thead>
                  <tr>
                    <th scope="col">Cliente</th>
                    <th scope="col">Clave</th>
                    <th scope="col">Tipo</th>
                    <th scope="col">Alta</th>
                    <th scope="col">Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {clientes.map((c) => (
                    <tr key={c.id}>
                      <td>{c.nombre}</td>
                      <td className="num">{c.prefijo}…</td>
                      <td>{c.grupo ? "Grupo Cacao" : "Negocio"}</td>
                      <td className="num">{fechaHoraSv(c.creado_en)}</td>
                      <td>
                        {c.revocado_en === null ? (
                          <span className="chip chip-emitido">Activa</span>
                        ) : (
                          <span className="chip">Revocada</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      <section className="bloque" aria-labelledby="titulo-lista">
        <h2 id="titulo-lista">Comercios registrados</h2>
        {datos.filas.length === 0 ? (
          <p className="vacio">No hay comercios registrados en esta instalación.</p>
        ) : (
          <div style={{ overflowX: "auto", marginTop: "0.5rem" }}>
            <table>
              <thead>
                <tr>
                  <th scope="col">Comercio</th>
                  <th scope="col">NIT</th>
                  <th scope="col">Cifrado</th>
                  <th scope="col">Alta</th>
                  <th scope="col">Última rotación</th>
                  <th scope="col">Credenciales presentes</th>
                </tr>
              </thead>
              <tbody>
                {datos.filas.map((f) => (
                  <tr key={f.id}>
                    <td>{f.id}</td>
                    <td className="num">{f.nitMascarado}</td>
                    <td>{etiquetaEstadoCifrado(f.estado)}</td>
                    <td className="num">{fechaHoraSv(f.creado)}</td>
                    <td className="nota">No registrada</td>
                    <td>
                      <ul className="lineas">
                        {f.credenciales.map((c) => (
                          <li key={c.nombre}>
                            {c.nombre} <Si valor={c.presente} />{" "}
                            <span className="nota">{c.nota}</span>
                          </li>
                        ))}
                      </ul>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="nota" style={{ marginTop: "0.5rem" }}>
          Esta lista sale de la carpeta de datos de la terminal, donde cada comercio guarda sus credenciales cifradas. El
          sitio publicado no tiene esa carpeta.
        </p>
      </section>
    </>
  );
}
