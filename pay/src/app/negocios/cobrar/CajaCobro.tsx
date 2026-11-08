'use client';

import { useEffect, useRef, useState } from 'react';

import { AvisoPagoFallido } from '@/componentes/AvisoPagoFallido';
import { agregarDigito, COBRO_MIN_CENTAVOS, formatoDolares } from '@/lib/cobro-negocio';
import { matrizQr } from '@/lib/qr';
import type { CobroNegocio } from '@/servidor/negocios';

import { cancelarCajaAccion, cobrarCajaAccion, estadoCajaAccion } from '../acciones';
import estilos from '../estilos.module.css';

type Modo = 'teclado' | 'cobrando' | 'esperando' | 'pagado' | 'vencido' | 'cancelado' | 'error';

const CADA_MS = 2000;

/** The key of one sale attempt: a double tap sends the same one, so the server makes one charge. 32 hex characters. */
function nuevaClave(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function modoDe(estado: CobroNegocio['estado']): Modo {
  if (estado === 'pagado') return 'pagado';
  if (estado === 'vencido') return 'vencido';
  if (estado === 'cancelado') return 'cancelado';
  return 'esperando';
}

export function CajaCobro({ nombre }: { nombre: string }) {
  const [centavos, setCentavos] = useState(0);
  const [modo, setModo] = useState<Modo>('teclado');
  const [cobro, setCobro] = useState<CobroNegocio | null>(null);
  const [mensaje, setMensaje] = useState('');
  const [ahora, setAhora] = useState(() => Date.now());
  const claveRef = useRef<string | null>(null);
  const enCurso = useRef(false);

  // Asks the server for the charge's state every 2 seconds while the customer has not paid.
  useEffect(() => {
    if (modo !== 'esperando' || !cobro) return;
    let vivo = true;
    const id = cobro.id;
    const revisar = async () => {
      const r = await estadoCajaAccion(id);
      if (!vivo || !r.ok) return;
      setCobro(r.dato);
      const siguiente = modoDe(r.dato.estado);
      if (siguiente !== 'esperando') setModo(siguiente);
    };
    const reloj = setInterval(revisar, CADA_MS);
    return () => {
      vivo = false;
      clearInterval(reloj);
    };
  }, [modo, cobro]);

  // The countdown redraws each second while the charge waits.
  useEffect(() => {
    if (modo !== 'esperando') return;
    const reloj = setInterval(() => setAhora(Date.now()), 1000);
    return () => clearInterval(reloj);
  }, [modo]);

  async function cobrar(monto: number) {
    if (enCurso.current) return;
    enCurso.current = true;
    claveRef.current ??= nuevaClave();
    setMensaje('');
    setModo('cobrando');
    try {
      const r = await cobrarCajaAccion(claveRef.current, monto);
      if (!r.ok) {
        setMensaje(`${r.mensaje} No se cobró nada: podés tocar Cobrar de nuevo.`);
        setModo('error');
        return;
      }
      setCobro(r.dato);
      setModo(modoDe(r.dato.estado));
    } catch {
      setMensaje('No pudimos hablar con el servidor. No se cobró nada: podés tocar Cobrar de nuevo.');
      setModo('error');
    } finally {
      enCurso.current = false;
    }
  }

  async function cancelar() {
    if (!cobro) return;
    setMensaje('');
    const r = await cancelarCajaAccion(cobro.id);
    if (r.ok) {
      setCobro(r.dato);
      setModo(modoDe(r.dato.estado));
      return;
    }
    setMensaje(r.mensaje);
    const estado = await estadoCajaAccion(cobro.id);
    if (estado.ok) {
      setCobro(estado.dato);
      setModo(modoDe(estado.dato.estado));
    }
  }

  function nuevaVenta() {
    claveRef.current = null;
    setCentavos(0);
    setCobro(null);
    setMensaje('');
    setModo('teclado');
  }

  function cobrarDeNuevo() {
    claveRef.current = null;
    void cobrar(centavos);
  }

  // The keypad stays on screen while the charge is being made, so the screen does not jump.
  const teclado = modo === 'teclado' || modo === 'error' || modo === 'cobrando';
  // Once a charge exists, the amount on screen is the charge's; before, it is the amount being typed.
  const enCobro = modo === 'esperando' || modo === 'pagado' || modo === 'vencido' || modo === 'cancelado';
  const montoMostrado = enCobro ? (cobro?.usd_centavos ?? centavos) : centavos;
  const restante =
    cobro?.expira_en && modo === 'esperando' ? Math.max(0, Math.floor((new Date(cobro.expira_en).getTime() - ahora) / 1000)) : null;

  return (
    <div className={estilos.caja}>
      <div className={estilos.cabeceraCaja}>
        <p>{nombre}</p>
        <p>{enCobro ? 'Cobro en curso' : 'Monto en dólares'}</p>
      </div>

      <p className={estilos.monto} aria-live="polite">
        {formatoDolares(montoMostrado)}
      </p>

      {mensaje &&
        (modo === 'error' ? (
          // A failed charge: the same amount and key go out again, so the server still makes one charge at most.
          <AvisoPagoFallido mensaje={mensaje} onReintentar={() => void cobrar(centavos)} />
        ) : (
          <p role="alert" className={estilos.error}>
            {mensaje}
          </p>
        ))}

      {teclado && (
        <>
          <div className={estilos.teclado} role="group" aria-label="Teclado del monto">
            {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) => (
              <button
                key={d}
                type="button"
                className={estilos.tecla}
                onClick={() => setCentavos((c) => agregarDigito(c, d))}
                disabled={modo === 'cobrando'}
              >
                {d}
              </button>
            ))}
            <button
              type="button"
              className={`${estilos.tecla} ${estilos.teclaBorrar}`}
              onClick={() => setCentavos((c) => Math.floor(c / 10))}
              disabled={centavos === 0}
              aria-label="Borrar el último dígito"
            >
              Borrar
            </button>
            <button
              type="button"
              className={estilos.tecla}
              onClick={() => setCentavos((c) => agregarDigito(c, 0))}
              disabled={modo === 'cobrando'}
            >
              0
            </button>
            <button type="button" className={`${estilos.tecla} ${estilos.teclaBorrar}`} onClick={() => setCentavos(0)} disabled={centavos === 0}>
              Limpiar
            </button>
          </div>
          <button
            type="button"
            className={`boton ${estilos.grande}`}
            onClick={() => void cobrar(centavos)}
            disabled={centavos < COBRO_MIN_CENTAVOS || modo === 'cobrando'}
            aria-disabled={centavos < COBRO_MIN_CENTAVOS || modo === 'cobrando'}
          >
            {modo === 'cobrando' ? 'Cobrando…' : 'Cobrar'}
          </button>
          {centavos > 0 && centavos < COBRO_MIN_CENTAVOS && (
            <p className={estilos.ayuda}>El cobro mínimo es $1.00.</p>
          )}
        </>
      )}

      {modo === 'esperando' && cobro && (
        <>
          <p role="status" className={estilos.cuentaRegresiva}>
            {restante === null
              ? 'Esperando el pago del cliente.'
              : restante > 0
                ? `Esperando el pago. Vence en ${Math.floor(restante / 60)}:${String(restante % 60).padStart(2, '0')}.`
                : 'Venció el tiempo. Revisando si el cliente pagó…'}
          </p>
          <QrCobro texto={cobro.factura ?? ''} descripcion={`Código QR para pagar ${formatoDolares(cobro.usd_centavos)}`} />
          <p className={estilos.ayuda}>El cliente escanea el código con su billetera de bitcoin y confirma el pago.</p>
          {cobro.enlace_billetera && (
            <a href={cobro.enlace_billetera} className="boton boton--secundario" target="_blank" rel="noopener noreferrer">
              Pagar con la billetera de prueba
            </a>
          )}
          <button type="button" className="boton boton--secundario" onClick={() => void cancelar()}>
            Cancelar cobro
          </button>
        </>
      )}

      {modo === 'pagado' && (
        <>
          <p role="status" className={`${estilos.estadoGrande} ${estilos.estadoPagado}`}>
            Pagado
          </p>
          <p className={estilos.ayuda}>Entró el pago de {formatoDolares(cobro?.usd_centavos ?? centavos)}.</p>
          <button type="button" className="boton" onClick={nuevaVenta}>
            Nueva venta
          </button>
        </>
      )}

      {modo === 'vencido' && (
        <>
          <p role="status" className={estilos.estadoGrande}>
            Venció
          </p>
          <p>El cliente no pagó a tiempo. No se cobró nada. Podés cobrar de nuevo con el mismo monto o empezar una venta nueva.</p>
          <button type="button" className="boton" onClick={cobrarDeNuevo}>
            Cobrar de nuevo
          </button>
          <button type="button" className="boton boton--secundario" onClick={nuevaVenta}>
            Nueva venta
          </button>
        </>
      )}

      {modo === 'cancelado' && (
        <>
          <p role="status" className={estilos.estadoGrande}>
            Cancelado
          </p>
          {cobro?.pago_tardio ? (
            <p role="alert">El cliente pagó después de cancelar. Escribinos para devolverle el pago antes de seguir.</p>
          ) : (
            <p>El cobro se canceló. No se cobró nada.</p>
          )}
          <button type="button" className="boton" onClick={nuevaVenta}>
            Nueva venta
          </button>
        </>
      )}
    </div>
  );
}

// The invoice as a QR code, drawn as SVG: black on white, two modules of quiet zone, as the standard asks.
function QrCobro({ texto, descripcion }: { texto: string; descripcion: string }) {
  if (!texto) return null;
  const { tamano, d } = matrizQr(texto);
  const margen = 2;
  const total = tamano + margen * 2;
  return (
    <figure className={estilos.qrCaja} style={{ margin: 0 }}>
      <svg viewBox={`0 0 ${total} ${total}`} role="img" aria-label={descripcion} shapeRendering="crispEdges">
        <rect width={total} height={total} fill="#fff" />
        <path transform={`translate(${margen} ${margen})`} d={d} fill="#000" />
      </svg>
    </figure>
  );
}
