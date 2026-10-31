import { ErrorLedger } from "../errores.ts";
import { documentoDe, SIN_DOCUMENTO_NEGOCIO, type FilaVenta } from "../ventas-api.ts";
import { ErrorApi, autenticar, claveDeCabecera, cuotaCliente, informeMesApi, puertoVentas, registrarVentaApi, ventaDeCliente, ventasDeCliente, type ClienteApi } from "./api.ts";
import { validarMes } from "../mes.ts";

// The HTTP side of the API v1: the same answer shape everywhere, a code per failure, and the key checked before anything.
// Errors: { error: { codigo, mensaje } }. The Spanish sentence goes to the client; the cause goes to the server log only.

const ESTADO_HTTP: Record<string, number> = {
  NO_AUTORIZADO: 401,
  NO_PERMITIDO: 403,
  NO_ENCONTRADA: 404,
  DATOS_INVALIDOS: 400,
  IDEMPOTENCIA_CONFLICTO: 409,
  IDEMPOTENCIA_EN_CURSO: 409,
  DUPLICADO: 409,
  ESTADO_INVALIDO: 409,
  LIMITE: 429,
  NO_DISPONIBLE: 503,
};

const MAXIMO_CUERPO_BYTES = 16_000;
const LIMITE_DEFECTO = 50;
const LIMITE_MAXIMO = 200;

export function respuestaJson(estado: number, cuerpo: unknown, cabeceras: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(cuerpo), {
    status: estado,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...cabeceras },
  });
}

export function respuestaError(codigo: string, mensaje: string, cabeceras: Record<string, string> = {}): Response {
  return respuestaJson(ESTADO_HTTP[codigo] ?? 500, { error: { codigo, mensaje } }, cabeceras);
}

// Turns any failure into the answer. Validation failures (ErrorLedger) are 400; a connection failure is 503.
export function respuestaDeFallo(e: unknown): Response {
  if (e instanceof ErrorApi) {
    const cabeceras: Record<string, string> = {};
    if (e.codigo === "NO_AUTORIZADO") cabeceras["www-authenticate"] = "Bearer";
    if (e.codigo === "LIMITE") cabeceras["retry-after"] = "60";
    return respuestaError(e.codigo, e.message, cabeceras);
  }
  if (e instanceof ErrorLedger) {
    if (e.message.startsWith("No se pudo conectar")) return respuestaError("NO_DISPONIBLE", e.message);
    return respuestaError("DATOS_INVALIDOS", e.message);
  }
  console.error("API de CacaoLedger:", e instanceof Error ? e.message : e);
  return respuestaError("INTERNO", "Algo falló en el servidor. Probá de nuevo más tarde.");
}

// Authenticates, counts the request, and runs the handler. Nothing runs for an unknown, revoked or over-limit key.
export async function conCliente(request: Request, manejar: (cliente: ClienteApi) => Promise<Response>): Promise<Response> {
  try {
    const cliente = await autenticar(request.headers.get("authorization"));
    if (cliente === null) {
      return respuestaError("NO_AUTORIZADO", "La clave de la API no es válida o fue revocada.", { "www-authenticate": "Bearer" });
    }
    if (!(await cuotaCliente(cliente.id))) {
      return respuestaError("LIMITE", "Demasiadas peticiones con esta clave. Probá de nuevo en un minuto.", { "retry-after": "60" });
    }
    return await manejar(cliente);
  } catch (e) {
    return respuestaDeFallo(e);
  }
}

// The public view of a sale: what the client may read about its own sale.
export function vistaVenta(v: FilaVenta) {
  return {
    id: v.id,
    referencia: v.referencia,
    producto: v.producto,
    negocio_id: v.negocio_id,
    descripcion: v.descripcion,
    monto_usd_centavos: v.monto_centavos,
    medio: v.medio,
    factura: v.factura_id,
    sats: v.sats,
    estado: v.estado,
    creado: v.creado_en,
  };
}

export async function postVentas(request: Request): Promise<Response> {
  return conCliente(request, async (cliente) => {
    const clave = claveDeCabecera(request.headers.get("idempotency-key"));
    const texto = await request.text();
    if (Buffer.byteLength(texto, "utf8") > MAXIMO_CUERPO_BYTES) {
      throw new ErrorApi("DATOS_INVALIDOS", "El cuerpo es demasiado grande.");
    }
    let cuerpo: unknown;
    try {
      cuerpo = JSON.parse(texto);
    } catch {
      throw new ErrorApi("DATOS_INVALIDOS", "El cuerpo no es JSON válido.");
    }
    const r = await registrarVentaApi(cliente, clave, cuerpo);
    return respuestaJson(r.situacion === "nueva" ? 201 : 200, r);
  });
}

function fechaIso(valor: string | null, campo: string): string | undefined {
  if (valor === null || valor === "") return undefined;
  if (Number.isNaN(new Date(valor).getTime())) throw new ErrorApi("DATOS_INVALIDOS", `El campo ${campo} no es una fecha ISO-8601.`);
  return new Date(valor).toISOString();
}

export async function getVentas(request: Request): Promise<Response> {
  return conCliente(request, async (cliente) => {
    const url = new URL(request.url);
    const limiteTexto = url.searchParams.get("limite");
    const limite = limiteTexto === null ? LIMITE_DEFECTO : Number(limiteTexto);
    if (!Number.isSafeInteger(limite) || limite < 1 || limite > LIMITE_MAXIMO) {
      throw new ErrorApi("DATOS_INVALIDOS", `El límite tiene que ser un entero entre 1 y ${LIMITE_MAXIMO}.`);
    }
    const filas = await ventasDeCliente(cliente.id, {
      desde: fechaIso(url.searchParams.get("desde"), "desde"),
      hasta: fechaIso(url.searchParams.get("hasta"), "hasta"),
      despues: fechaIso(url.searchParams.get("despues"), "despues"),
      limite,
    });
    const siguiente = filas.length === limite ? filas[filas.length - 1]?.creado_en ?? null : null;
    return respuestaJson(200, { ventas: filas.map(vistaVenta), despues: siguiente });
  });
}

export async function getVenta(request: Request, id: string): Promise<Response> {
  return conCliente(request, async (cliente) => {
    const venta = await ventaDeCliente(cliente.id, id);
    if (venta === null) throw new ErrorApi("NO_ENCONTRADA", "No encontramos esa venta.");
    let documento = null;
    if (venta.ticket_id) {
      const ticket = await puertoVentas().almacen.porId(venta.ticket_id);
      documento = ticket ? documentoDe(ticket) : null;
    }
    return respuestaJson(200, {
      ...vistaVenta(venta),
      documento,
      sinDocumento: venta.producto === "negocios" ? SIN_DOCUMENTO_NEGOCIO : null,
    });
  });
}

// The group's month, for the group owner's client only. Business sales are not in it.
export async function getReporteMes(request: Request, mes: string): Promise<Response> {
  return conCliente(request, async (cliente) => {
    if (!cliente.grupo) throw new ErrorApi("NO_PERMITIDO", "Esta clave no puede leer los reportes del grupo.");
    validarMes(mes);
    const informe = await informeMesApi(mes);
    return respuestaJson(200, {
      mes: informe.mes,
      consumidor: { cantidad: informe.consumidor.cantidad, ventasGravadasCentavos: informe.consumidor.ventasGravadasCentavos },
      contribuyentes: {
        cantidad: informe.contribuyentes.cantidad,
        netoCentavos: informe.contribuyentes.netoCentavos,
        ivaCentavos: informe.contribuyentes.ivaCentavos,
        totalCentavos: informe.contribuyentes.totalCentavos,
      },
      cifras: informe.cifras,
      noIncluidos: informe.noIncluidos.length,
    });
  });
}
