import { connection } from "next/server";
import * as QRCode from "qrcode";

import { formatoUsd } from "../../src/dinero.ts";
import { ErrorLedger } from "../../src/errores.ts";
import { DIAS_DE_GRACIA, nombrePeriodo, PLANES, totalConIva, type IdPlan } from "../../src/planes.ts";
import { vistaDelPlan, type VistaPlan } from "../../src/servidor/planes.ts";
import { accesoDeDueno, sesionActual } from "../../src/servidor/sesion.ts";
import { LineaContacto } from "../_componentes/LineaContacto.tsx";
import { SinAcceso } from "../_componentes/SinAcceso.tsx";
import { ElegirPlan } from "./ElegirPlan.tsx";
import { EsperandoPago, PreparandoFactura } from "./EsperandoPago.tsx";

export const metadata = { title: "Plan" };

// These pages read the ledger at request time and wait for it: a blocking route, not an instant one.
export const instant = false;

const IDS = Object.keys(PLANES) as IdPlan[];

function textoEstado(vista: VistaPlan): { titulo: string; detalle: string; alerta: boolean } {
  const e = vista.estado;
  switch (e.tipo) {
    case "sin_plan":
      return { titulo: "Prueba gratis", detalle: "Todavía no elegiste un plan. Mientras tanto, Ledger funciona completo.", alerta: false };
    case "al_dia":
      return { titulo: `${PLANES[e.plan].nombre} · al día`, detalle: `La cuota de ${nombrePeriodo(vista.periodo)} está pagada. Gracias.`, alerta: false };
    case "en_gracia":
      return {
        titulo: `${PLANES[e.plan].nombre} · cuota pendiente`,
        detalle: `Tenés ${e.diasRestantes} ${e.diasRestantes === 1 ? "día" : "días"} para pagar la cuota de ${nombrePeriodo(vista.periodo)}. Mientras tanto seguís emitiendo documentos con normalidad.`,
        alerta: false,
      };
    case "suspendido":
      return {
        titulo: `${PLANES[e.plan].nombre} · ventas a mano en pausa`,
        detalle: "Pasaron los 7 días de gracia sin pago. Pagá la cuota para volver a registrar ventas a mano. Las ventas cobradas por CacaoPay siguen recibiendo su documento, y tus libros, tickets y cierres siguen disponibles.",
        alerta: true,
      };
  }
}

export default async function PaginaPlan() {
  await connection();
  if (!(await accesoDeDueno("/plan"))) return <SinAcceso />;
  const sesion = await sesionActual();
  if (!sesion) return <SinAcceso />;

  let vista: VistaPlan | null = null;
  let error: string | null = null;
  try {
    vista = await vistaDelPlan(sesion.usuario.id);
  } catch (e) {
    console.error("El plan no pudo leerse:", e);
    error = e instanceof ErrorLedger ? e.message : "No se pudo leer el plan. Probá de nuevo.";
  }

  const actual = vista && vista.estado.tipo !== "sin_plan" ? vista.estado.plan : null;
  const estado = vista ? textoEstado(vista) : null;
  const qrSvg = vista?.cobro ? await QRCode.toString(`lightning:${vista.cobro.factura}`, { type: "svg", margin: 1, errorCorrectionLevel: "M" }) : null;

  return (
    <>
      <div className="encabezado">
        <h1>Plan</h1>
      </div>
      <p>
        Una cuota mensual que incluye cobrar con CacaoPay: ninguna comisión por venta. Se paga con una factura Lightning que emite CacaoPay; con tarjeta, próximamente.
      </p>

      {error !== null ? (
        <section className="tarjeta">
          <p role="alert" className="error">
            {error}
          </p>
          <LineaContacto pregunta="¿Algo no funciona?" />
        </section>
      ) : null}

      {vista && estado ? (
        <section className={`tarjeta${estado.alerta ? " plan-alerta" : ""}`} aria-labelledby="plan-estado">
          <h2 id="plan-estado">{estado.titulo}</h2>
          <p>{estado.detalle}</p>

          {vista.cobro && qrSvg ? (
            <div className="plan-cobro">
              <div className="qr" dangerouslySetInnerHTML={{ __html: qrSvg }} />
              <div>
                <p className="num plan-monto">
                  {formatoUsd(vista.cobro.usdCentavos)} · {vista.cobro.sats.toLocaleString("en-US")} sats
                </p>
                <p className="nota">Cuota de {nombrePeriodo(vista.periodo)}, IVA incluido. Escaneá el QR o abrilo en tu billetera.</p>
                <p className="hash plan-factura">{vista.cobro.factura}</p>
                <EsperandoPago factura={vista.cobro.factura} />
                {vista.cobro.billeteraDePrueba ? (
                  <p>
                    <a className="boton secundario" href={vista.cobro.billeteraDePrueba} target="_blank" rel="noopener">
                      Pagar con la billetera de prueba
                    </a>
                  </p>
                ) : null}
                <p className="nota">Demostración: bitcoin de prueba (regtest), sin valor.</p>
              </div>
            </div>
          ) : null}

          {vista.cobroActivo && !vista.cobro && vista.cuota?.estado === "pendiente" ? <PreparandoFactura /> : null}

          {actual !== null && !vista.cobroActivo && vista.cuota?.estado !== "pagada" ? (
            <p className="nota">El cobro de la cuota todavía no está activo en este servidor: no se te cobra nada.</p>
          ) : null}
        </section>
      ) : null}

      <h2>Elegí tu plan</h2>
      <div className="plan-grilla">
        {IDS.map((id) => {
          const p = PLANES[id];
          const precio = totalConIva(id);
          return (
            <section key={id} className={`tarjeta plan-tarjeta${actual === id ? " plan-actual" : ""}`} aria-labelledby={`plan-${id}`}>
              <h3 id={`plan-${id}`}>{p.nombre}</h3>
              <p className="nota">{p.para}</p>
              <p className="plan-precio">
                <span className="num">{formatoUsd(p.netoCentavos)}</span> al mes
              </p>
              <p className="nota">
                + IVA: <span className="num">{formatoUsd(precio.total)}</span> en total
              </p>
              <ul>
                {p.incluye.map((linea) => (
                  <li key={linea}>{linea}</li>
                ))}
              </ul>
              <ElegirPlan plan={id} actual={actual === id} />
            </section>
          );
        })}
      </div>

      <section className="tarjeta" aria-labelledby="plan-reglas">
        <h2 id="plan-reglas">Cómo se cobra</h2>
        <ul>
          <li>El primer día de cada mes, CacaoPay te emite una factura Lightning por la cuota, en sats al precio del momento.</li>
          <li>
            Si no la pagás, tenés {DIAS_DE_GRACIA} días de gracia y seguís emitiendo documentos: una venta sin su DTE es justo la infracción que Ledger
            evita.
          </li>
          <li>
            Pasados esos días, se pausa el registro de ventas a mano. Las ventas que ya cobraste por CacaoPay siguen recibiendo su documento, y tus
            libros, tickets y cierres siguen disponibles.
          </li>
          <li>Cobrar con CacaoPay va incluido: no hay comisión por venta.</li>
        </ul>
      </section>
    </>
  );
}
