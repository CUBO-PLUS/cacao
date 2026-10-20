import { redirect } from "next/navigation";
import { connection } from "next/server";

import { hoySv } from "../../src/servidor/tiempo-sv.ts";
import { accesoDeDueno } from "../../src/servidor/sesion.ts";
import { SinAcceso } from "../_componentes/SinAcceso.tsx";

// /mes goes to the current month in El Salvador time. Owner only.
export const instant = false;

export default async function PaginaMesActual() {
  await connection();
  if (!(await accesoDeDueno("/mes"))) return <SinAcceso />;
  redirect(`/mes/${hoySv(new Date()).slice(0, 7)}`);
}
