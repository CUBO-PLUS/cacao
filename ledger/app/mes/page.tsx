import { redirect } from "next/navigation";
import { connection } from "next/server";

import { hoySv } from "../../src/servidor/tiempo-sv.ts";

// /mes goes to the current month in El Salvador time.
export const instant = false;

export default async function PaginaMesActual() {
  await connection();
  redirect(`/mes/${hoySv(new Date()).slice(0, 7)}`);
}
