import { redirect } from "next/navigation";
import { connection } from "next/server";

import { hoySv } from "../../src/servidor/tiempo-sv.ts";

export const metadata = { title: "Cierre del día" };

// The close of today. The owner check runs on the day's page, so this redirect reveals nothing.
export default async function PaginaCierreHoy() {
  await connection();
  redirect(`/cierre/${hoySv(new Date())}`);
}
