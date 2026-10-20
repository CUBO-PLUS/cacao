'use client';

import type { RealtimeChannel } from '@supabase/supabase-js';
import { create } from 'qrcode';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Boton } from '@/componentes/Boton';
import { EtiquetaPrecio } from '@/componentes/EtiquetaPrecio';
import { formatoUsd } from '@/lib/dinero';
import { accionesPosibles } from '@/lib/estados';
import { clienteNavegador } from '@/lib/supabase-navegador';

import { clienteEnVivo } from '../canalEnVivo';
import { FormularioCancelar } from '../FormularioCancelar';

import {
  estadoDePagoAccion,
  reiniciarCobroAccion,
  reintentarCobroAccion,
  simularPagoAccion,
} from './acciones';
import styles from './estilos.module.css';
import type { EstadoPago } from './tipos';

// Polling is the fallback; Realtime is the fast path.
const CADA_MS = 3000;
// Blank space around the code, as the QR spec asks.
const ZONA_SILENCIO = 4;

const TEXTO_VENCIDA =
  'El tiempo para pagar se acabó. No pagués esta factura: el pedido se canceló y los productos volvieron al inventario.';
// A job is not cancelled when its request lapses: it stays agreed and done, and gets a new request.
const TEXTO_VENCIDA_TRABAJO =
  'El tiempo de esta solicitud de pago se acabó. No pagués esa factura. Generá otra para pagar el trabajo.';

// Turns the server's remaining seconds into a deadline on this device's clock. The phone clock
// may be wrong; only the difference matters.
function anclar(segundos: number | null): number | null {
  return segundos === null ? null : Date.now() + segundos * 1000;
}

function formatoCuenta(segundos: number): string {
  const minutos = Math.floor(segundos / 60);
  return `${minutos}:${String(segundos % 60).padStart(2, '0')}`;
}

export function PagoCliente({
  ordenId,
  inicial,
  errorCobro,
  billeteraDePrueba,
}: {
  ordenId: string;
  inicial: EstadoPago;
  errorCobro: string | null;
  /** Regtest test-wallet link for a BTCPay invoice, built on the server. Null otherwise. */
  billeteraDePrueba: string | null;
}) {
  const router = useRouter();
  const [estado, setEstado] = useState<EstadoPago>(inicial);
  const [problema, setProblema] = useState<string | null>(errorCobro);
  const [sinConexion, setSinConexion] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [copiado, setCopiado] = useState('');
  const [vence, setVence] = useState<number | null>(() => anclar(inicial.segundosRestantes));
  // Null until mounted, so the server render and the first client render match.
  const [ahora, setAhora] = useState<number | null>(null);
  // A job whose request lapsed goes back to 'hecha'; this tells that apart from a job never asked for one.
  const [expiroTrabajo, setExpiroTrabajo] = useState(false);
  const estadoPrevio = useRef<EstadoPago['estado']>(inicial.estado);
  const enVuelo = useRef(false);
  const facturaRef = useRef<HTMLTextAreaElement>(null);
  const destinoRef = useRef<HTMLInputElement>(null);
  const montoRef = useRef<HTMLInputElement>(null);

  const aplicar = useCallback((dato: EstadoPago) => {
    if (dato.tipo === 'servicio') {
      const vencio = dato.estado === 'hecha' || dato.estado === 'expirada';
      if (vencio && estadoPrevio.current === 'esperando_pago') setExpiroTrabajo(true);
      if (dato.estado === 'esperando_pago') setExpiroTrabajo(false);
    }
    estadoPrevio.current = dato.estado;
    setEstado(dato);
    setVence(anclar(dato.segundosRestantes));
    setSinConexion(false);
    if (dato.estado !== 'creada') setProblema(null);
  }, []);

  // One clock tick per second drives the countdown.
  useEffect(() => {
    const tic = () => setAhora(Date.now());
    tic();
    const id = setInterval(tic, 1000);
    return () => clearInterval(id);
  }, []);

  const restante =
    vence !== null && ahora !== null ? Math.max(0, Math.floor((vence - ahora) / 1000)) : null;
  const esperando = estado.estado === 'esperando_pago';
  const plazoCumplido = esperando && restante === 0;
  // Expired on the server, or the countdown reached zero here: no more paying this request.
  const vencida = estado.estado === 'expirada' || plazoCumplido;
  // A job's lapsed request is not a cancelled order: it gets a new request instead of the product message.
  const trabajo = estado.tipo === 'servicio';
  const vencidaTrabajo = trabajo && (expiroTrabajo || vencida);
  const vencidaProducto = !trabajo && vencida;
  const quedaUnMinuto = esperando && !vencida && restante !== null && restante <= 60;
  const activo = !vencida && (estado.estado === 'creada' || esperando);
  // A cancelled product order: the screen stops, hides the invoice and says so.
  const canceladaProducto = !trabajo && estado.estado === 'cancelada';
  // The same rule as the order page: the buyer may cancel while the order is unpaid.
  const puedeCancelar =
    !trabajo &&
    accionesPosibles(
      {
        tipo: 'productos',
        estado: estado.estado,
        pagada: false,
        entregadaEn: null,
        tieneResena: false,
        disputa: null,
        proveedor: estado.proveedor ?? 'manual',
      },
      'comprador',
    ).includes('cancelar');

  const refrescar = useCallback(async () => {
    if (enVuelo.current) return;
    enVuelo.current = true;
    try {
      const r = await estadoDePagoAccion(ordenId);
      if (r.ok) aplicar(r.dato);
      else setProblema(r.mensaje);
    } catch {
      setSinConexion(true);
    } finally {
      enVuelo.current = false;
    }
  }, [aplicar, ordenId]);

  // One last check when the countdown ends: a payment that arrived in time still counts.
  // Deferred to a timer so the effect body does not set state directly.
  useEffect(() => {
    if (!plazoCumplido) return;
    const id = setTimeout(() => void refrescar(), 0);
    return () => clearTimeout(id);
  }, [plazoCumplido, refrescar]);

  // Polls every few seconds while the tab is visible, and checks at once when it returns.
  useEffect(() => {
    if (!activo) return;
    let intervalo: ReturnType<typeof setInterval> | undefined;
    const arrancar = () => {
      if (intervalo === undefined) intervalo = setInterval(() => void refrescar(), CADA_MS);
    };
    const parar = () => {
      if (intervalo !== undefined) {
        clearInterval(intervalo);
        intervalo = undefined;
      }
    };
    const alCambiarVisibilidad = () => {
      if (document.visibilityState === 'hidden') {
        parar();
        return;
      }
      void refrescar();
      arrancar();
    };
    if (document.visibilityState !== 'hidden') arrancar();
    document.addEventListener('visibilitychange', alCambiarVisibilidad);
    return () => {
      parar();
      document.removeEventListener('visibilitychange', alCambiarVisibilidad);
    };
  }, [activo, refrescar]);

  // Realtime on this order's row. A change only triggers a fresh read; the server decides.
  useEffect(() => {
    if (!activo) return;
    let vigente = true;
    let navegador: ReturnType<typeof clienteNavegador> | null = null;
    let canal: RealtimeChannel | null = null;
    void clienteEnVivo().then((cliente) => {
      if (!vigente) return;
      navegador = cliente;
      canal = cliente
        .channel(`orden-${ordenId}-pago`)
        .on(
          'postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'ordenes', filter: `id=eq.${ordenId}` },
          () => {
            void refrescar();
          },
        )
        .subscribe();
    });
    return () => {
      vigente = false;
      if (navegador && canal) void navegador.removeChannel(canal);
    };
  }, [activo, ordenId, refrescar]);

  // The server page makes a job's request on load. A page that arrives without one (for example a
  // prefetched copy) asks once from here. Deferred to a timer, as the countdown check above.
  const pidioCobro = useRef(false);
  useEffect(() => {
    // Only for a page that ARRIVED without a request. A request that lapsed while the client was
    // looking also leaves the job at 'hecha', and then the client must ask for the new one: the
    // amount in sats can change, so it is never renewed behind their back.
    if (!trabajo || inicial.estado !== 'hecha' || estado.estado !== 'hecha' || expiroTrabajo) return;
    // The flag is set when the request is sent, so a cleanup before that does not lose it.
    const id = setTimeout(() => {
      if (pidioCobro.current) return;
      pidioCobro.current = true;
      void reintentar();
    }, 0);
    return () => clearTimeout(id);
    // reintentar reads the latest props; the effect only needs the state it watches.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trabajo, estado.estado]);

  // A job goes from waiting for payment straight to entregada: that is the paid state for a job.
  const pagado = estado.estado === 'pagada' || (trabajo && (estado.estado === 'entregada' || estado.estado === 'cerrada'));

  // "Pago recibido" stays for a second, then the buyer lands on the order.
  useEffect(() => {
    if (!pagado) return;
    const id = setTimeout(() => router.replace(`/ordenes/${ordenId}`), 1000);
    return () => clearTimeout(id);
  }, [pagado, ordenId, router]);

  async function copiar(valor: string, campo: HTMLInputElement | HTMLTextAreaElement | null) {
    try {
      await navigator.clipboard.writeText(valor);
      setCopiado('Copiada');
    } catch {
      // No clipboard access: select the text so the buyer can copy it by hand.
      campo?.focus();
      campo?.select();
      let ok = false;
      try {
        ok = document.execCommand('copy');
      } catch {
        ok = false;
      }
      setCopiado(ok ? 'Copiada' : 'Seleccionamos el texto. Copialo a mano.');
    }
  }

  // A job asks for its request again through its own action; a product order only retries a failed one.
  async function reintentar() {
    setOcupado(true);
    try {
      const r = trabajo ? await reiniciarCobroAccion(ordenId) : await reintentarCobroAccion(ordenId);
      if (r.ok) aplicar(r.dato);
      else setProblema(r.mensaje);
    } catch {
      setProblema('No pudimos conectar. Probá de nuevo.');
    } finally {
      setOcupado(false);
    }
  }

  async function simular() {
    setOcupado(true);
    try {
      const r = await simularPagoAccion(ordenId);
      if (r.ok) await refrescar();
      else setProblema(r.mensaje);
    } catch {
      setProblema('No pudimos conectar. Probá de nuevo.');
    } finally {
      setOcupado(false);
    }
  }

  let textoEstado: string;
  if (pagado) textoEstado = 'Pago recibido';
  else if (canceladaProducto) textoEstado = 'Cancelaste este pedido. No pagués esta factura.';
  else if (vencidaTrabajo) textoEstado = TEXTO_VENCIDA_TRABAJO;
  else if (vencidaProducto) textoEstado = TEXTO_VENCIDA;
  else if (estado.estado === 'creada') textoEstado = 'Estamos registrando tu orden. Esperá un momento.';
  // A job waiting for its first request: shown when the request could not be made.
  else if (estado.estado === 'hecha') textoEstado = 'Todavía no hay una solicitud de pago para este trabajo.';
  else if (quedaUnMinuto) textoEstado = 'Queda menos de un minuto para pagar.';
  else textoEstado = 'Esperando tu pago. Esta pantalla se actualiza sola.';

  // Payment details only while the buyer can still pay them.
  const cobroVigente = esperando && !vencida;
  const bolt11 = cobroVigente ? estado.bolt11 : null;
  const destino = cobroVigente ? estado.destino : null;
  const demo = cobroVigente && estado.proveedor === 'falso';
  const factura = !demo && bolt11 !== null ? bolt11 : null;
  const direccion = !demo && factura === null && destino !== null ? destino : null;

  return (
    <article className={styles.pago} aria-labelledby="titulo-pago">
      <header className={styles.cabecera}>
        <h1 id="titulo-pago">{trabajo ? `Pagar el trabajo ${estado.numero}` : `Orden ${estado.numero}`}</h1>
        <p className={styles.negocio}>
          {trabajo ? `Le pagás a ${estado.negocioNombre}` : `Pagás a ${estado.negocioNombre}`}
        </p>
      </header>

      <EtiquetaPrecio usdCentavos={estado.totalUsdCentavos} sats={estado.totalSats} tamano="grande" />
      <p className={styles.cotizacion}>
        Cotización: 1 BTC = {formatoUsd(Math.round(estado.cotizacion * 100))}
      </p>

      {cobroVigente && restante !== null && (
        <p className={styles.cuenta}>
          Vence en <span className={styles.digitos}>{formatoCuenta(restante)}</span>
        </p>
      )}

      {/* Polite: changes once at the one-minute mark and once when the time is up. */}
      <div className={styles.estado} aria-live="polite">
        {textoEstado}
      </div>

      {sinConexion && (
        <p role="status" className={styles.nota}>
          No pudimos actualizar el estado. Lo volvemos a intentar.
        </p>
      )}
      {problema && (
        <p role="alert" className={styles.alerta}>
          {problema}
        </p>
      )}
      {(estado.estado === 'creada' || (trabajo && estado.estado === 'hecha')) && problema && !vencidaTrabajo && (
        <div className={styles.acciones}>
          <Boton onClick={() => void reintentar()} disabled={ocupado}>
            Intentar de nuevo
          </Boton>
        </div>
      )}

      {vencidaTrabajo && (
        <div className={styles.acciones}>
          <Boton onClick={() => void reintentar()} disabled={ocupado}>
            Generar otra solicitud
          </Boton>
          <Boton href={`/ordenes/${ordenId}`} variante="secundario">
            Volver al trabajo
          </Boton>
        </div>
      )}

      {vencidaProducto && (
        <div className={styles.acciones}>
          <Boton href="/carrito" variante="secundario">
            Volver al carrito
          </Boton>
          <Boton href="/">Ir al inicio</Boton>
        </div>
      )}

      {canceladaProducto && (
        <div className={styles.acciones}>
          <Boton href="/carrito" variante="secundario">
            Volver al carrito
          </Boton>
        </div>
      )}

      {puedeCancelar && (
        <section className={styles.bloque} aria-label="Cancelar el pedido">
          <FormularioCancelar ordenId={ordenId} trabajo={false} alCancelar={() => void refrescar()} />
        </section>
      )}

      {demo && (
        <section className={styles.bloque} aria-labelledby="pago-demo">
          <h2 id="pago-demo">Pago simulado (modo demo)</h2>
          <p className={styles.nota}>Esta orden no tiene una factura real. Simulá el pago para ver el flujo completo.</p>
          <CodigoQr texto={`cacaomarket-demo-${estado.numero}`} etiqueta="Código QR de demostración" />
          <div className={styles.acciones}>
            <Boton onClick={() => void simular()} disabled={ocupado}>
              Simular pago
            </Boton>
          </div>
        </section>
      )}

      {factura !== null && (
        <section className={styles.bloque} aria-labelledby="pago-factura">
          <h2 id="pago-factura">Pagá con tu billetera Lightning</h2>
          <CodigoQr texto={`lightning:${factura}`} />
          <div className={styles.acciones}>
            <Boton onClick={() => void copiar(factura, facturaRef.current)}>Copiar factura</Boton>
            <a className="boton boton--secundario" href={`lightning:${factura}`}>
              Abrir en mi billetera
            </a>
          </div>
          {billeteraDePrueba !== null && (
            <div className={styles.acciones}>
              <a className="boton boton--secundario" href={billeteraDePrueba} target="_blank" rel="noopener">
                Pagar con la billetera de prueba
              </a>
              <p className={styles.nota}>Bitcoin de prueba (regtest): no tiene valor.</p>
            </div>
          )}
          <label htmlFor="campo-factura" className="campo-etiqueta">
            Factura
          </label>
          <textarea
            id="campo-factura"
            ref={facturaRef}
            className={`campo ${styles.textoLargo}`}
            readOnly
            rows={3}
            value={factura}
          />
        </section>
      )}

      {direccion !== null && destino !== null && (
        <section className={styles.bloque} aria-labelledby="pago-direccion">
          <h2 id="pago-direccion">{trabajo ? 'Pagá a la dirección de quien trabaja' : 'Pagá a la dirección del vendedor'}</h2>
          <p className={styles.nota}>
            Enviá exactamente este monto a esta dirección desde tu billetera.{' '}
            {trabajo ? 'Quien trabaja confirma cuando lo recibe.' : 'El vendedor confirma cuando lo recibe.'}
          </p>
          <div className={styles.campos}>
            <label htmlFor="campo-direccion" className="campo-etiqueta">
              Dirección Lightning
            </label>
            <input id="campo-direccion" ref={destinoRef} className="campo" readOnly value={destino} />
            <Boton variante="secundario" onClick={() => void copiar(destino, destinoRef.current)}>
              Copiar dirección
            </Boton>
          </div>
          <div className={styles.campos}>
            <label htmlFor="campo-monto" className="campo-etiqueta">
              Monto en sats
            </label>
            <input
              id="campo-monto"
              ref={montoRef}
              className="campo"
              readOnly
              inputMode="numeric"
              value={String(estado.totalSats)}
            />
            <Boton
              variante="secundario"
              onClick={() => void copiar(String(estado.totalSats), montoRef.current)}
            >
              Copiar monto
            </Boton>
          </div>
        </section>
      )}

      <p role="status" className={styles.copiado}>
        {copiado}
      </p>
    </article>
  );
}

// The QR code as inline SVG, drawn from the module matrix. Dark modules are Tostado on Blanco
// cálido, with a quiet zone. Null when the text cannot be encoded.
function dibujarQr(texto: string): { lado: number; trazos: string } | null {
  try {
    const modulos = create(texto, { errorCorrectionLevel: 'M' }).modules;
    const n = modulos.size;
    let trazos = '';
    for (let fila = 0; fila < n; fila++) {
      let col = 0;
      while (col < n) {
        if (!modulos.get(fila, col)) {
          col++;
          continue;
        }
        // Runs of dark modules become one rectangle each, which keeps the path short.
        let largo = 0;
        while (col + largo < n && modulos.get(fila, col + largo)) largo++;
        trazos += `M${col + ZONA_SILENCIO} ${fila + ZONA_SILENCIO}h${largo}v1h-${largo}z`;
        col += largo;
      }
    }
    return { lado: n + ZONA_SILENCIO * 2, trazos };
  } catch {
    return null;
  }
}

function CodigoQr({
  texto,
  etiqueta = 'Código QR de la factura Lightning',
}: {
  texto: string;
  etiqueta?: string;
}) {
  const dibujo = useMemo(() => dibujarQr(texto), [texto]);
  if (dibujo === null) {
    return <p className={styles.nota}>No pudimos dibujar el código QR. Copiá el texto de abajo.</p>;
  }
  return (
    <svg
      role="img"
      aria-label={etiqueta}
      className={styles.qr}
      viewBox={`0 0 ${dibujo.lado} ${dibujo.lado}`}
      shapeRendering="crispEdges"
    >
      <rect width={dibujo.lado} height={dibujo.lado} style={{ fill: 'var(--blanco)' }} />
      <path d={dibujo.trazos} style={{ fill: 'var(--tostado)' }} />
    </svg>
  );
}
