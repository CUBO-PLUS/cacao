import { createHash, createPublicKey, createSign, createVerify, generateKeyPairSync } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ErrorLedger } from "../errores.ts";

// Local signer for test runs. It builds a compact JWS (alg RS512) over the DTE JSON, the same
// shape the Ministry's firmador returns, but it signs with a test key generated here.
// That key is not a contributor certificate, and Hacienda does not accept what it signs.

export interface ClavesPrueba {
  privada: string; // PEM (PKCS#8). Never log it.
  publica: string; // PEM (SPKI)
  huella: string; // SHA-256 of the public key, hex. Identifies the test key.
}

const NOMBRE_PRIVADA = "clave-privada.pem";
const NOMBRE_PUBLICA = "clave-publica.pem";

function huellaDe(publicaPem: string): string {
  const der = createPublicKey(publicaPem).export({ type: "spki", format: "der" });
  return createHash("sha256").update(der).digest("hex");
}

// Generates a new RSA-2048 test key pair. Nothing is written to disk here.
export function generarParClavesPrueba(): ClavesPrueba {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  return { privada: privateKey, publica: publicKey, huella: huellaDe(publicKey) };
}

// Reuses the test key stored in dirClave, or creates it the first time.
// Callers pass a folder under datos/, which is git-ignored.
export function cargarOCrearClavePrueba(dirClave: string): ClavesPrueba {
  const rutaPrivada = join(dirClave, NOMBRE_PRIVADA);
  const rutaPublica = join(dirClave, NOMBRE_PUBLICA);
  if (existsSync(rutaPrivada) && existsSync(rutaPublica)) {
    const privada = readFileSync(rutaPrivada, "utf8");
    const publica = readFileSync(rutaPublica, "utf8");
    return { privada, publica, huella: huellaDe(publica) };
  }
  const par = generarParClavesPrueba();
  mkdirSync(dirClave, { recursive: true });
  writeFileSync(rutaPrivada, par.privada, { encoding: "utf8", mode: 0o600 });
  writeFileSync(rutaPublica, par.publica, "utf8");
  return par;
}

function base64url(texto: string): string {
  return Buffer.from(texto, "utf8").toString("base64url");
}

function leerParteJson(parte: string, nombre: string): unknown {
  try {
    return JSON.parse(Buffer.from(parte, "base64url").toString("utf8")) as unknown;
  } catch {
    throw new ErrorLedger(`La ${nombre} del JWS no es JSON válido.`);
  }
}

// Returns a compact JWS: header.payload.signature. The signature is RSASSA-PKCS1-v1_5 over SHA-512.
export function firmarDteLocal(dte: unknown, privadaPem: string): string {
  const cabecera = base64url(JSON.stringify({ alg: "RS512" }));
  const carga = base64url(JSON.stringify(dte));
  const entrada = `${cabecera}.${carga}`;
  const firma = createSign("RSA-SHA512").update(entrada).sign(privadaPem).toString("base64url");
  return `${entrada}.${firma}`;
}

// Checks a compact JWS against a public key and returns the decoded DTE.
// Rejects any header other than RS512, and any payload that does not match the signature.
export function verificarJwsLocal(jws: string, publicaPem: string): unknown {
  const partes = jws.split(".");
  if (partes.length !== 3) throw new ErrorLedger("El JWS no tiene las tres partes de una firma compacta.");
  const [cabecera = "", carga = "", firma = ""] = partes;
  const cab = leerParteJson(cabecera, "cabecera");
  const alg = typeof cab === "object" && cab !== null ? (cab as Record<string, unknown>).alg : undefined;
  if (alg !== "RS512") throw new ErrorLedger(`El JWS usa ${String(alg)}; la firma local solo admite RS512.`);
  const valida = createVerify("RSA-SHA512")
    .update(`${cabecera}.${carga}`)
    .verify(publicaPem, Buffer.from(firma, "base64url"));
  if (!valida) throw new ErrorLedger("La firma no coincide con el documento ni con la clave pública.");
  return leerParteJson(carga, "carga");
}
