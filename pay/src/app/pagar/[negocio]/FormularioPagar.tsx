'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';

import { AvisoPagoFallido } from '@/componentes/AvisoPagoFallido';
import { ProximoPaso } from '@/componentes/ProximoPaso';
import { centavosDesdeTexto, formatoDolares } from '@/lib/cobro-negocio';
import { matrizQr } from '@/lib/qr';
import type { CobroNegocio } from '@/servidor/negocios';

import { cobrarPublicoAccion, estadoPublicoAccion } from '../../negocios/acciones';
import estilos from '../../negocios/estilos.module.css';

type Modo = 'formulario' | 'enviando' | 'esperando' | 'pagado' | 'vencido' | 'cancelado';

const CADA_MS = 3000;

function modoDe(estado: CobroNegocio['estado']): Modo {
  if (estado === 'pagado') return 'pagado';
  if (estado === 'vencido') return 'vencido';
  if (estado === 'cancelado') return 'cancelado';
  return 'esperando';
}

function nuevaClave(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function FormularioPagar({ negocioId, nombre }: { negocioId: string; nombre: string }) {
  const [dolares, setDolares] = useState('');
  const [modo, setModo] = useState<Modo>('formulario');
  const [cobro, setCobro] = useState<CobroNegocio | null>(null);
  const [mensaje, setMensaje] = useState('');
  // True when the server or the connection failed the charge, so the notice offers a retry.
  const [fallo, setFallo] = useState(false);
  const claveRef = useRef<string | null>(null);
  const enCurso = useRef(false);

  // Asks about this one charge every 3 seconds while it waits. No other charge is read here.
  useEffect(() => {
    if (modo !== 'esperando' || !cobro) return;
    let vivo = true;
    const id = cobro.id;
    const revisar = async () => {
      const r = await estadoPublicoAccion(negocioId, id);
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
  }, [modo, cobro, negocioId]);

  // The charge request. The retry button calls it again with the same amount and the same key, so the server
  // makes one charge at most.
  async function enviar() {
    if (enCurso.current) return;
    enCurso.current = true;
    claveRef.current ??= nuevaClave();
    setMensaje('');
    setFallo(false);
    setModo('enviando');
    try {
      const r = await cobrarPublicoAccion(negocioId, dolares, claveRef.current);
      if (!r.ok) {
        setMensaje(r.mensaje);
        setFallo(true);
        setModo('formulario');
        return;
      }
      setCobro(r.dato);
      setModo(modoDe(r.dato.estado));
    } catch {
      setMensaje('No pudimos crear el pago. Probá de nuevo en un momento.');
      setFallo(true);
      setModo('formulario');
    } finally {
      enCurso.current = false;
    }
  }

  function pagar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    const centavos = centavosDesdeTexto(dolares);
    if (!centavos.ok) {
      setMensaje(centavos.mensaje);
      setFallo(false);
      return;
    }
    void enviar();
  }

  if (modo === 'formulario' || modo === 'enviando') {
    return (
      <form onSubmit={pagar} className={estilos.formulario} noValidate>
        <div className={estilos.grupo}>
          <label htmlFor="monto-pago" className="campo-etiqueta">
            Monto en dólares
          </label>
          <input
            id="monto-pago"
            name="monto"
            className="campo"
            type="text"
            inputMode="decimal"
            autoComplete="off"
            placeholder="0.00"
            value={dolares}
            onChange={(e) => setDolares(e.target.value)}
            aria-describedby="ayuda-monto"
            aria-invalid={mensaje ? true : undefined}
          />
          <p id="ayuda-monto" className={estilos.ayuda}>
            Entre $1.00 y $10,000.00, con hasta dos decimales.
          </p>
        </div>
        {mensaje &&
          (fallo ? (
            <AvisoPagoFallido mensaje={mensaje} onReintentar={() => void enviar()} deshabilitado={modo === 'enviando'} />
          ) : (
            <p role="alert" className={estilos.error}>
              {mensaje}
            </p>
          ))}
        <button type="submit" className="boton" disabled={modo === 'enviando'} aria-disabled={modo === 'enviando'}>
          {modo === 'enviando' ? 'Creando el pago…' : 'Pagar'}
        </button>
      </form>
    );
  }

  if (modo === 'esperando' && cobro) {
    return (
      <div className={estilos.caja}>
        <p className={estilos.monto}>{formatoDolares(cobro.usd_centavos)}</p>
        <p role="status" className={estilos.cuentaRegresiva}>
          Esperando el pago en {nombre}.
        </p>
        <CodigoQr factura={cobro.factura ?? ''} etiqueta={`Código QR para pagar ${formatoDolares(cobro.usd_centavos)} en ${nombre}`} />
        <p className={estilos.ayuda}>Escaneá el código con tu billetera de bitcoin y confirmá el pago.</p>
      </div>
    );
  }

  if (modo === 'pagado') {
    return (
      <>
        <p role="status" className={`${estilos.estadoGrande} ${estilos.estadoPagado}`}>
          Pagado. Gracias.
        </p>
        {cobro && (
          <p className={estilos.ayuda}>
            Pagaste {formatoDolares(cobro.usd_centavos)} en {nombre}. Guardá esta pantalla como comprobante.
          </p>
        )}
        <ProximoPaso
          opciones={[
            {
              texto: 'Dónde más gastar',
              href: '/donde-gastar',
              detalle: 'Otros negocios de El Salvador donde se puede pagar con bitcoin.',
            },
          ]}
        />
      </>
    );
  }

  return (
    <div className={estilos.caja}>
      <p role="status" className={estilos.estadoGrande}>
        {modo === 'vencido' ? 'Venció' : 'Cancelado'}
      </p>
      <p>No se cobró nada. Escribí el monto de nuevo para pagar.</p>
      <button
        type="button"
        className="boton"
        onClick={() => {
          claveRef.current = null;
          setCobro(null);
          setMensaje('');
          setModo('formulario');
        }}
      >
        Pagar de nuevo
      </button>
    </div>
  );
}

function CodigoQr({ factura, etiqueta }: { factura: string; etiqueta: string }) {
  if (!factura) return null;
  const { tamano, d } = matrizQr(factura);
  const margen = 2;
  const total = tamano + margen * 2;
  return (
    <svg className={estilos.qrGrande} viewBox={`0 0 ${total} ${total}`} role="img" aria-label={etiqueta} shapeRendering="crispEdges">
      <rect width={total} height={total} fill="#fff" />
      <path transform={`translate(${margen} ${margen})`} d={d} fill="#000" />
    </svg>
  );
}
