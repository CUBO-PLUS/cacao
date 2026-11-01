import { ErrorLedger } from "../errores.ts";
import { canonico, HASH_INICIAL, hashDe, type Atestacion, type DatosAtestacion } from "../atestacion.ts";

// The rate attestation chain of the web (table ledger_atestaciones, migration 20261104000001). The record is the CLI's
// (src/atestacion.ts): the hash is SHA-256 of the canonical JSON of {anterior, contenido}. The database stores the
// rows and refuses to append out of order; it does not compute hashes. Verification here recomputes every hash.

export type FilaAtestacion = {
  // Position in the chain, assigned by the store.
  orden: number;
  ticketId: string;
  codigoGeneracion: string;
  // Hash of the record before this one (64 zeros for the first).
  anterior: string;
  hash: string;
  contenido: DatosAtestacion;
};

export type NuevaFilaAtestacion = Omit<FilaAtestacion, "orden">;

export type AlmacenAtestaciones = {
  porTicket(ticketId: string): Promise<FilaAtestacion | null>;
  // The whole chain in order. Used to verify it.
  cadena(): Promise<FilaAtestacion[]>;
  // Hash of the last record, or HASH_INICIAL when the chain is empty.
  ultimoHash(): Promise<string>;
  // Appends the row. Throws CADENA_DESALINEADA when anterior is not the last hash.
  anexar(fila: NuevaFilaAtestacion): Promise<FilaAtestacion>;
};

// The hash of a record, from its anterior and its content. Same rule as the CLI: canonical JSON, no hash field.
export function hashDeRegistro(anterior: string, contenido: DatosAtestacion): string {
  return hashDe({ ...contenido, anterior } as Omit<Atestacion, "hash">);
}

export function construirFila(datos: DatosAtestacion, anterior: string): NuevaFilaAtestacion {
  return {
    ticketId: datos.ticket,
    codigoGeneracion: datos.codigoGeneracion,
    anterior,
    hash: hashDeRegistro(anterior, datos),
    contenido: datos,
  };
}

export type ResultadoCadena = {
  ok: boolean;
  registros: number;
  // First broken record: its position, its ticket and why.
  primerRoto: { orden: number; ticketId: string; motivo: string } | null;
  // Hash of the last record that checks out (HASH_INICIAL for an empty chain).
  cabeza: string;
};

// Walks the chain in order and recomputes each hash from its content. Stops at the first broken link.
export function verificarCadenaFilas(filas: FilaAtestacion[]): ResultadoCadena {
  let previo = HASH_INICIAL;
  for (const f of filas) {
    if (f.anterior !== previo) {
      return {
        ok: false,
        registros: filas.length,
        primerRoto: { orden: f.orden, ticketId: f.ticketId, motivo: "el anterior no coincide con el registro previo: falta, sobra o cambió de orden un registro" },
        cabeza: previo,
      };
    }
    if (hashDeRegistro(f.anterior, f.contenido) !== f.hash) {
      return {
        ok: false,
        registros: filas.length,
        primerRoto: { orden: f.orden, ticketId: f.ticketId, motivo: "el contenido no coincide con su hash: el registro fue alterado" },
        cabeza: previo,
      };
    }
    previo = f.hash;
  }
  return { ok: true, registros: filas.length, primerRoto: null, cabeza: previo };
}

// Appends the record of a ticket once. A ticket that already has one keeps it. A concurrent append that moved the
// head makes the database refuse (CADENA_DESALINEADA); the head is read again, up to three times.
export async function anexarAtestacion(almacen: AlmacenAtestaciones, datos: DatosAtestacion): Promise<FilaAtestacion> {
  // Two emitters can race for the head of the chain; each lost race reads the new head and tries again.
  for (let intento = 0; intento < 8; intento++) {
    const previa = await almacen.porTicket(datos.ticket);
    if (previa !== null) return previa;
    const anterior = await almacen.ultimoHash();
    try {
      return await almacen.anexar(construirFila(datos, anterior));
    } catch (e) {
      if (!(e instanceof ErrorLedger) || !e.message.startsWith("CADENA_DESALINEADA")) throw e;
    }
  }
  throw new ErrorLedger("La cadena de atestaciones cambió varias veces seguidas. Reintentá.");
}

// In-memory store with the same rules as the database: used by the tests.
export function almacenAtestacionesMemoria(): AlmacenAtestaciones & { filas: FilaAtestacion[] } {
  const filas: FilaAtestacion[] = [];
  return {
    filas,
    async porTicket(ticketId) {
      return filas.find((f) => f.ticketId === ticketId) ?? null;
    },
    async cadena() {
      return [...filas];
    },
    async ultimoHash() {
      return filas.length > 0 ? (filas[filas.length - 1] as FilaAtestacion).hash : HASH_INICIAL;
    },
    async anexar(fila) {
      const previa = filas.find((f) => f.ticketId === fila.ticketId);
      if (previa) return previa;
      const ultimo = filas.length > 0 ? (filas[filas.length - 1] as FilaAtestacion).hash : HASH_INICIAL;
      if (ultimo !== fila.anterior) throw new ErrorLedger("CADENA_DESALINEADA: La atestación no sigue al último registro de la cadena.");
      const nueva: FilaAtestacion = { ...fila, orden: filas.length + 1 };
      filas.push(nueva);
      return nueva;
    },
  };
}

type FilaBd = {
  orden: number;
  ticket_id: string;
  codigo_generacion: string;
  anterior: string;
  hash: string;
  contenido: DatosAtestacion;
};

export type ConfigAtestacionesSupabase = { url: string; clave: string; fetch?: typeof fetch };

function desdeFila(f: FilaBd): FilaAtestacion {
  return {
    orden: Number(f.orden),
    ticketId: f.ticket_id,
    codigoGeneracion: f.codigo_generacion,
    anterior: f.anterior,
    hash: f.hash,
    contenido: f.contenido,
  };
}

export function createAlmacenAtestacionesSupabase(config: ConfigAtestacionesSupabase): AlmacenAtestaciones {
  const base = `${config.url.replace(/\/+$/, "")}/rest/v1`;
  const f = config.fetch ?? fetch;
  const cabeceras = { apikey: config.clave, authorization: `Bearer ${config.clave}`, accept: "application/json" };

  async function pedir(ruta: string, init: RequestInit, descripcion: string): Promise<Response> {
    try {
      return await f(`${base}${ruta}`, { ...init, headers: { ...cabeceras, ...(init.headers as Record<string, string>) }, cache: "no-store" });
    } catch {
      throw new ErrorLedger(`No se pudo conectar con la base de atestaciones (${descripcion}).`);
    }
  }

  async function leer(q: URLSearchParams, descripcion: string): Promise<FilaBd[]> {
    const r = await pedir(`/ledger_atestaciones?${q}`, {}, descripcion);
    if (!r.ok) throw new ErrorLedger(`No se pudo leer las atestaciones (${descripcion}, HTTP ${r.status}).`);
    return (await r.json()) as FilaBd[];
  }

  return {
    async porTicket(ticketId) {
      const filas = await leer(new URLSearchParams({ select: "*", ticket_id: `eq.${ticketId}`, limit: "1" }), "ticket");
      return filas[0] ? desdeFila(filas[0]) : null;
    },
    async cadena() {
      const filas = await leer(new URLSearchParams({ select: "*", order: "orden.asc", limit: "100000" }), "cadena");
      return filas.map(desdeFila);
    },
    async ultimoHash() {
      const filas = await leer(new URLSearchParams({ select: "hash", order: "orden.desc", limit: "1" }), "cabeza");
      return filas[0]?.hash ?? HASH_INICIAL;
    },
    async anexar(fila) {
      const r = await pedir(
        "/rpc/ledger_anexar_atestacion",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            p_ticket: fila.ticketId,
            p_codigo: fila.codigoGeneracion,
            p_anterior: fila.anterior,
            p_hash: fila.hash,
            p_contenido: fila.contenido,
          }),
        },
        "escritura",
      );
      if (!r.ok) {
        const cuerpo = await r.text();
        if (cuerpo.includes("CADENA_DESALINEADA")) throw new ErrorLedger("CADENA_DESALINEADA: la cabeza de la cadena cambió.");
        throw new ErrorLedger(`No se pudo guardar la atestación del ticket ${fila.ticketId} (HTTP ${r.status}).`);
      }
      return desdeFila((await r.json()) as FilaBd);
    },
  };
}

// Canonical text of a record, for showing what was hashed. Same function the CLI uses.
export function textoCanonico(fila: FilaAtestacion): string {
  return canonico({ ...fila.contenido, anterior: fila.anterior });
}
