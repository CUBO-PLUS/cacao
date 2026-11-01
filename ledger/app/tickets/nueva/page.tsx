import Link from "next/link";
import { connection } from "next/server";

import { accesoDeDueno } from "../../../src/servidor/sesion.ts";
import { SinAcceso } from "../../_componentes/SinAcceso.tsx";
import { FormularioVenta } from "./FormularioVenta.tsx";

export const metadata = { title: "Registrar venta" };

// These pages read the ledger at request time and wait for it: a blocking route, not an instant one.
export const instant = false;

export default async function PaginaNuevaVenta() {
  await connection();
  if (!(await accesoDeDueno("/tickets/nueva"))) return <SinAcceso />;
  return (
    <>
      <p className="volver">
        <Link href="/tickets">Volver a la lista</Link>
      </p>
      <div className="encabezado">
        <h1>Registrar venta</h1>
      </div>
      <FormularioVenta />
    </>
  );
}
