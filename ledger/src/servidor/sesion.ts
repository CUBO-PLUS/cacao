import { auth, currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { cache } from "react";

import { ErrorLedger } from "../errores.ts";
import { decidirAcceso, TEXTO_SIN_ACCESO, type SesionAcceso } from "./acceso.ts";
import { supabaseDeEntorno } from "./configuracion.ts";

// The signed-in person, from Clerk (same app as the other Cacao sites). The link to a usuarios row goes through
// vincular_clerk with the service role, as pay/ does: only a phone or email that Clerk has verified may link an
// existing row. es_admin comes from that row, and it is the only thing that opens the owner pages.

export type SesionWeb = {
  usuario: { id: string; nombre: string; esAdmin: boolean };
};

type Entorno = { url: string; clave: string };

async function llamar(entorno: Entorno, ruta: string, cuerpo?: unknown): Promise<Response> {
  return fetch(`${entorno.url}/rest/v1${ruta}`, {
    method: cuerpo === undefined ? "GET" : "POST",
    headers: {
      apikey: entorno.clave,
      authorization: `Bearer ${entorno.clave}`,
      accept: "application/json",
      ...(cuerpo === undefined ? {} : { "content-type": "application/json" }),
    },
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
    cache: "no-store",
  });
}

// cache() keeps one lookup per request, however many components ask.
export const sesionActual = cache(async (): Promise<SesionWeb | null> => {
  // The session check reads the clock; this keeps that read at request time.
  await connection();
  const { userId } = await auth();
  if (!userId) return null;

  const cuenta = await currentUser();
  if (!cuenta) return null;
  const entorno = supabaseDeEntorno();
  if (entorno === null) throw new ErrorLedger("Falta la configuración de la base de datos en el servidor.");

  // Only a phone or email that Clerk has verified may link an existing row. Anyone can type an unverified one.
  const telefono = cuenta.primaryPhoneNumber?.verification?.status === "verified" ? (cuenta.primaryPhoneNumber?.phoneNumber ?? "") : "";
  const correo = cuenta.primaryEmailAddress?.verification?.status === "verified" ? (cuenta.primaryEmailAddress?.emailAddress ?? "") : "";

  const vinculo = await llamar(entorno, "/rpc/vincular_clerk", {
    p_clerk_id: userId,
    p_telefono: telefono,
    p_correo: correo,
    p_nombre: cuenta.fullName ?? "",
  });
  if (!vinculo.ok) throw new ErrorLedger(`No se pudo vincular la cuenta (HTTP ${vinculo.status}).`);
  const id = (await vinculo.json()) as unknown;
  if (typeof id !== "string") return null;

  // Columns are named on purpose: the database grants column by column.
  const q = new URLSearchParams({ select: "id,nombre,es_admin", id: `eq.${id}`, limit: "1" });
  const perfilRes = await llamar(entorno, `/usuarios?${q}`);
  if (!perfilRes.ok) throw new ErrorLedger(`No se pudo leer la cuenta (HTTP ${perfilRes.status}).`);
  const perfil = ((await perfilRes.json()) as { id: string; nombre: string; es_admin: boolean }[])[0];
  if (!perfil) return null;

  return { usuario: { id: perfil.id, nombre: perfil.nombre, esAdmin: perfil.es_admin === true } };
});

/**
 * Owner-only pages: not signed in goes to /entrar (and back to `volver`); signed in without es_admin gets the
 * friendly denial. Returns true when the visitor may see the page.
 */
async function sesionParaAcceso(): Promise<SesionAcceso> {
  const sesion = await sesionActual();
  return sesion === null ? null : { esAdmin: sesion.usuario.esAdmin };
}

export async function accesoDeDueno(volver: string): Promise<boolean> {
  const decision = decidirAcceso(await sesionParaAcceso(), volver);
  if (decision.tipo === "entrar") redirect(decision.destino);
  return decision.tipo === "permitir";
}

/** Owner-only route handlers return a response instead of a page: a redirect to sign in, or 403. Null when allowed. */
export async function respuestaSinAcceso(volver: string): Promise<Response | null> {
  const decision = decidirAcceso(await sesionParaAcceso(), volver);
  if (decision.tipo === "entrar") return new Response(null, { status: 303, headers: { Location: decision.destino, "Cache-Control": "private, no-store" } });
  if (decision.tipo === "denegar") return Response.json({ error: TEXTO_SIN_ACCESO }, { status: 403 });
  return null;
}
