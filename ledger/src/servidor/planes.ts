import { ErrorLedger } from "../errores.ts";
import { estadoDelPlan, esPlan, periodoDe, PLANES, totalConIva, type EstadoPlan, type IdPlan } from "../planes.ts";
import { supabaseDeEntorno } from "./configuracion.ts";
import { urlBtcpay } from "./url-btcpay.ts";

// The plan of an account and its monthly due, read and written with the service role (ledger_planes, ledger_cuotas),
// and the due charged through the CacaoPay payments API (pay/docs/api.md). Server only.
//
// Ledger is a client of CacaoPay under the product "pay": the due is Grupo Cacao's own revenue, charged with its own
// rails. The charge is in dollars (plan + IVA) and CacaoPay turns it into a Lightning invoice in sats. An invoice lives
// 24 hours; an unpaid month gets a new one on the next visit, under a new idempotency key.

type Entorno = Record<string, string | undefined>;

export type ConfigCacaoPay = { url: string; clave: string };

/** Null unless both CACAO_PAY_URL and CACAO_PAY_API_KEY are set: then the page shows the plans without charging. */
export function cacaoPayDeEntorno(entorno: Entorno = process.env): ConfigCacaoPay | null {
  const url = (entorno.CACAO_PAY_URL ?? "").trim().replace(/\/+$/, "");
  const clave = (entorno.CACAO_PAY_API_KEY ?? "").trim();
  if (!/^https?:\/\/[^/\s]+$/.test(url) || clave === "") return null;
  return { url, clave };
}

export type CobroCacaoPay = {
  id: string;
  estado: "pendiente" | "pagado" | "vencido" | "cancelado";
  factura: string | null;
  sats: number;
  usd_centavos: number;
  expira_en: string | null;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function pay(config: ConfigCacaoPay, metodo: string, ruta: string, cuerpo?: unknown, cabeceras: Record<string, string> = {}): Promise<CobroCacaoPay> {
  const control = new AbortController();
  const reloj = setTimeout(() => control.abort(), 10_000);
  try {
    const r = await fetch(config.url + ruta, {
      method: metodo,
      headers: { "content-type": "application/json", authorization: `Bearer ${config.clave}`, ...cabeceras },
      body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
      signal: control.signal,
      cache: "no-store",
    });
    const texto = await r.text();
    if (!r.ok) {
      console.error(`CacaoPay respondió ${r.status} en ${metodo} ${ruta}:`, texto.slice(0, 300));
      throw new ErrorLedger("CacaoPay no pudo crear el cobro de la cuota. Probá de nuevo en un momento.");
    }
    return JSON.parse(texto) as CobroCacaoPay;
  } catch (e) {
    if (e instanceof ErrorLedger) throw e;
    throw new ErrorLedger("CacaoPay no respondió. Probá de nuevo en un momento.");
  } finally {
    clearTimeout(reloj);
  }
}

// ---------------------------------------------------------------------------------------------
// Database (PostgREST with the service role)

type FilaPlan = { usuario_id: string; plan: string; elegido_en: string };
export type FilaCuota = {
  id: string;
  usuario_id: string;
  periodo: string;
  plan: string;
  usd_centavos: number;
  estado: "pendiente" | "pagada";
  cobro_id: string | null;
  intentos: number;
  pagada_en: string | null;
};

async function rest(ruta: string, opciones: { metodo?: string; cuerpo?: unknown; prefer?: string } = {}): Promise<unknown> {
  const entorno = supabaseDeEntorno();
  if (entorno === null) throw new ErrorLedger("Falta la configuración de la base de datos en el servidor.");
  const r = await fetch(`${entorno.url}/rest/v1${ruta}`, {
    method: opciones.metodo ?? "GET",
    headers: {
      apikey: entorno.clave,
      authorization: `Bearer ${entorno.clave}`,
      accept: "application/json",
      "content-type": "application/json",
      ...(opciones.prefer ? { prefer: opciones.prefer } : {}),
    },
    body: opciones.cuerpo === undefined ? undefined : JSON.stringify(opciones.cuerpo),
    cache: "no-store",
  });
  if (!r.ok) {
    console.error(`Supabase respondió ${r.status} en ${ruta}:`, (await r.text()).slice(0, 300));
    throw new ErrorLedger("No se pudo leer o guardar el plan. Probá de nuevo.");
  }
  const texto = await r.text();
  return texto ? JSON.parse(texto) : null;
}

const COLUMNAS_CUOTA = "id,usuario_id,periodo,plan,usd_centavos,estado,cobro_id,intentos,pagada_en";

async function leerPlan(usuarioId: string): Promise<{ plan: IdPlan; elegidoEn: Date } | null> {
  const q = new URLSearchParams({ select: "usuario_id,plan,elegido_en", usuario_id: `eq.${usuarioId}`, limit: "1" });
  const fila = ((await rest(`/ledger_planes?${q}`)) as FilaPlan[])[0];
  if (!fila || !esPlan(fila.plan)) return null;
  return { plan: fila.plan, elegidoEn: new Date(fila.elegido_en) };
}

async function leerCuota(usuarioId: string, periodo: string): Promise<FilaCuota | null> {
  const q = new URLSearchParams({ select: COLUMNAS_CUOTA, usuario_id: `eq.${usuarioId}`, periodo: `eq.${periodo}`, limit: "1" });
  return ((await rest(`/ledger_cuotas?${q}`)) as FilaCuota[])[0] ?? null;
}

async function actualizarCuota(id: string, cambios: Partial<FilaCuota>): Promise<FilaCuota> {
  const q = new URLSearchParams({ id: `eq.${id}`, select: COLUMNAS_CUOTA });
  const filas = (await rest(`/ledger_cuotas?${q}`, { metodo: "PATCH", cuerpo: cambios, prefer: "return=representation" })) as FilaCuota[];
  if (!filas[0]) throw new ErrorLedger("No se encontró la cuota.");
  return filas[0];
}

// ---------------------------------------------------------------------------------------------
// What the page uses

export type VistaPlan = {
  estado: EstadoPlan;
  periodo: string;
  cuota: FilaCuota | null;
  /** The open Lightning invoice of this month's due, when there is one. */
  cobro: { factura: string; sats: number; usdCentavos: number; expiraEn: string | null; billeteraDePrueba: string | null } | null;
  /** False when CacaoPay is not configured on this server: plans can be chosen, nothing is charged. */
  cobroActivo: boolean;
};

/** Chooses or changes the plan. An unpaid due of this month follows the new plan and gets a new invoice. */
export async function elegirPlan(usuarioId: string, plan: IdPlan, ahora: Date = new Date()): Promise<void> {
  const anterior = await leerPlan(usuarioId);
  await rest("/ledger_planes?on_conflict=usuario_id", {
    metodo: "POST",
    cuerpo: { usuario_id: usuarioId, plan, actualizado_en: ahora.toISOString(), ...(anterior ? {} : { elegido_en: ahora.toISOString() }) },
    prefer: "resolution=merge-duplicates,return=minimal",
  });
  const cuota = await leerCuota(usuarioId, periodoDe(ahora));
  if (cuota && cuota.estado === "pendiente" && cuota.plan !== plan) {
    await actualizarCuota(cuota.id, { plan, usd_centavos: totalConIva(plan).total, cobro_id: null });
  }
}

/** Marks the due paid when CacaoPay reports its charge paid. Returns the due as it is now. */
async function conciliar(config: ConfigCacaoPay | null, cuota: FilaCuota, ahora: Date): Promise<{ cuota: FilaCuota; cobro: CobroCacaoPay | null }> {
  if (cuota.estado === "pagada" || config === null || cuota.cobro_id === null || !UUID.test(cuota.cobro_id)) return { cuota, cobro: null };
  const cobro = await pay(config, "GET", `/api/v1/cobros/${cuota.cobro_id}/`);
  if (cobro.estado === "pagado") {
    return { cuota: await actualizarCuota(cuota.id, { estado: "pagada", pagada_en: ahora.toISOString() }), cobro };
  }
  return { cuota, cobro };
}

/**
 * The state of the account this month. With a plan and CacaoPay configured it also makes sure the due has an open
 * invoice: it creates the due, and a new charge when there is none or the last one expired.
 */
export async function vistaDelPlan(usuarioId: string, ahora: Date = new Date(), crearCobro = true): Promise<VistaPlan> {
  const config = cacaoPayDeEntorno();
  const periodo = periodoDe(ahora);
  const elegido = await leerPlan(usuarioId);
  let cuota = elegido ? await leerCuota(usuarioId, periodo) : null;

  if (elegido && cuota === null && config !== null && crearCobro) {
    await rest("/ledger_cuotas?on_conflict=usuario_id,periodo", {
      metodo: "POST",
      cuerpo: { usuario_id: usuarioId, periodo, plan: elegido.plan, usd_centavos: totalConIva(elegido.plan).total },
      prefer: "resolution=ignore-duplicates,return=minimal",
    });
    cuota = await leerCuota(usuarioId, periodo);
  }

  let cobro: CobroCacaoPay | null = null;
  if (cuota) {
    const r = await conciliar(config, cuota, ahora);
    cuota = r.cuota;
    cobro = r.cobro;
    // A pending charge stays the charge of the due, even before its invoice text arrives: no second invoice.
    const abierto = cobro !== null && cobro.estado === "pendiente";
    if (cuota.estado === "pendiente" && !abierto && config !== null && crearCobro && elegido) {
      const intento = cuota.intentos + 1;
      const plan = esPlan(cuota.plan) ? cuota.plan : elegido.plan;
      cobro = await pay(
        config,
        "POST",
        "/api/v1/cobros/",
        {
          monto: cuota.usd_centavos,
          moneda: "USD",
          descripcion: `CacaoLedger · ${PLANES[plan].nombre} · ${periodo}`,
          referencia: `ledger-cuota-${periodo}`,
          vence_en_segundos: 86_400,
          datos: { tipo: "cuota_ledger", cuota: cuota.id, periodo, plan },
        },
        { "idempotency-key": `ledger-cuota-${cuota.id}-${intento}` },
      );
      cuota = await actualizarCuota(cuota.id, { cobro_id: cobro.id, intentos: intento });
      // CacaoPay may answer before BTCPay hands over the invoice text: read the charge once more.
      if (cobro.factura === null) {
        await new Promise((listo) => setTimeout(listo, 1200));
        cobro = await pay(config, "GET", `/api/v1/cobros/${cobro.id}/`);
      }
    }
  }

  const estado = estadoDelPlan({
    plan: elegido?.plan ?? null,
    elegidoEn: elegido?.elegidoEn ?? null,
    pagadoEstePeriodo: cuota?.estado === "pagada",
    ahora,
  });

  let vistaCobro: VistaPlan["cobro"] = null;
  if (cuota?.estado === "pendiente" && cobro && cobro.estado === "pendiente" && cobro.factura) {
    const base = await urlBtcpay().catch(() => null);
    vistaCobro = {
      factura: cobro.factura,
      sats: cobro.sats,
      usdCentavos: cobro.usd_centavos,
      expiraEn: cobro.expira_en,
      // The demo runs on regtest: the test wallet pays these invoices. Only offered for regtest invoices.
      billeteraDePrueba: base && cobro.factura.startsWith("lnbcrt") ? `${base}/billetera?factura=${encodeURIComponent(cobro.factura)}` : null,
    };
  }
  return { estado, periodo, cuota, cobro: vistaCobro, cobroActivo: config !== null };
}

/** The state only, without creating dues or charges: what the emission check needs. Never throws. */
export async function estadoParaEmitir(usuarioId: string, ahora: Date = new Date()): Promise<EstadoPlan> {
  try {
    return (await vistaDelPlan(usuarioId, ahora, false)).estado;
  } catch (e) {
    // A failure to read the plan must not stop a sale: a missed document is the worse outcome.
    console.error("El estado del plan no pudo leerse; la emisión sigue:", e);
    return { tipo: "sin_plan" };
  }
}
