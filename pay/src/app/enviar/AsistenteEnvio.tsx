'use client';

import { type FormEvent, useCallback, useEffect, useRef, useState } from 'react';

import type { Entrega } from '@/lib/cotizacion';
import type { RecienteDestinatario } from '@/lib/recientes';
import { normalizarContacto } from '@/lib/transferencias';
import { errorDeMonto, leerMonto, type TarifaMostrada } from '@/componentes/formatoEnvio';

import { cotizarAccion, registrarInicioEnvio, registrarVisitaCotizacion, type CotizacionEnvio } from './acciones';
import estilos from './estilos.module.css';
import { PasoConfirmar } from './PasoConfirmar';
import { PasoDestinatario } from './PasoDestinatario';
import { PasoMonto } from './PasoMonto';
import { asegurarVisita } from './visita';

type Paso = 1 | 2 | 3;

/** What "Repetir envío" fills in, read on the server from one of the sender's own transfers. */
export type PrefillEnvio = {
  monedaOrigen: 'USD' | 'EUR';
  montoTexto: string;
  entrega: Entrega;
  nombre: string;
  contacto: string;
};

const MENSAJE_SIN_BTC = 'El precio del bitcoin no está disponible ahora.';
const MENSAJE_SIN_CALCULO = 'No pudimos calcular el envío. Probá de nuevo en un momento.';
// The quote follows the inputs after a short pause, so typing does not send a request per key.
const ESPERA_COTIZACION_MS = 350;

// The last answer from the server, with the inputs it belongs to.
type Respuesta = { clave: string; cotizacion?: CotizacionEnvio; usdBtc?: number | null; error?: string };

/**
 * The sender's flow in three steps on one page: the amount, the recipient, and the confirmation.
 * Every number comes from the server; this component only holds what the person typed.
 */
export function AsistenteEnvio({
  tarifas,
  precioDisponible,
  recientes,
  prefill,
}: {
  tarifas: TarifaMostrada[];
  precioDisponible: boolean;
  recientes: RecienteDestinatario[];
  prefill: PrefillEnvio | null;
}) {
  const [paso, setPaso] = useState<Paso>(1);
  const [montoTexto, setMontoTexto] = useState(prefill?.montoTexto ?? '100');
  const [moneda, setMoneda] = useState<'USD' | 'EUR'>(prefill?.monedaOrigen ?? 'USD');
  const [entrega, setEntrega] = useState<Entrega>(prefill?.entrega ?? 'efectivo');
  const [intentoMonto, setIntentoMonto] = useState(false);
  const [nombre, setNombre] = useState(prefill?.nombre ?? '');
  const [contacto, setContacto] = useState(prefill?.contacto ?? '');
  const [nota, setNota] = useState('');
  const [intentoDestino, setIntentoDestino] = useState(false);
  const [respuesta, setRespuesta] = useState<Respuesta | null>(null);
  // Counts up each time a quote runs out, so the quote is asked again for the same inputs.
  const [vencimientos, setVencimientos] = useState(0);
  const alVencer = useCallback(() => setVencimientos((n) => n + 1), []);

  const tituloRef = useRef<HTMLHeadingElement>(null);
  const pendienteFoco = useRef(false);
  const nombreRef = useRef<HTMLInputElement>(null);
  const contactoRef = useRef<HTMLInputElement>(null);
  const visitaRegistrada = useRef(false);

  const centavos = leerMonto(montoTexto);
  const errorMonto = errorDeMonto(montoTexto, moneda);
  // Identifies the inputs of a quote. Null while the amount cannot be quoted.
  const clave = errorMonto === null && centavos !== null ? `${centavos}|${moneda}|${entrega}` : null;

  useEffect(() => {
    asegurarVisita();
  }, []);

  // Asks the server for the quote of the current inputs. A reply for older inputs is dropped.
  useEffect(() => {
    if (clave === null || centavos === null) return;
    let vigente = true;
    const temporizador = setTimeout(async () => {
      try {
        const pedido = await cotizarAccion({ montoCentavos: centavos, monedaOrigen: moneda, entrega });
        if (!vigente) return;
        if (pedido.ok) {
          setRespuesta({ clave, cotizacion: pedido.dato.cotizacion, usdBtc: pedido.dato.usdBtc });
          if (!visitaRegistrada.current) {
            visitaRegistrada.current = true;
            void registrarVisitaCotizacion();
          }
        } else {
          setRespuesta({ clave, error: pedido.codigo === 'SIN_COTIZACION' ? MENSAJE_SIN_BTC : pedido.mensaje });
        }
      } catch {
        if (vigente) setRespuesta({ clave, error: MENSAJE_SIN_CALCULO });
      }
    }, ESPERA_COTIZACION_MS);
    return () => {
      vigente = false;
      clearTimeout(temporizador);
    };
  }, [clave, centavos, moneda, entrega, vencimientos]);

  // The answer counts only when it belongs to the inputs on screen now.
  const vigente = respuesta !== null && clave !== null && respuesta.clave === clave ? respuesta : null;
  const cotizacion = vigente?.cotizacion ?? null;
  const usdBtc = vigente?.usdBtc ?? null;
  const errorCotizacion = vigente?.error ?? null;
  const enEspera = clave !== null && vigente === null;

  // Validation of the recipient, the same rules the server applies.
  const largoNombre = Array.from(nombre.trim()).length;
  const errorNombre =
    largoNombre < 2 || largoNombre > 80 ? 'Escribí el nombre de quien recibe, entre 2 y 80 letras.' : null;
  const errorContacto =
    normalizarContacto(contacto) === null ? 'Escribí un celular de 8 números o un correo válido.' : null;

  // Moves focus to the heading of the step the person has just reached.
  useEffect(() => {
    if (!pendienteFoco.current) return;
    pendienteFoco.current = false;
    tituloRef.current?.focus();
  }, [paso]);

  function irAPaso(siguiente: Paso) {
    pendienteFoco.current = true;
    setPaso(siguiente);
  }

  function seguirDelMonto(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    setIntentoMonto(true);
    // Without a quote for these inputs there is nothing to confirm yet; the sentence above says why.
    if (errorMonto !== null || cotizacion === null) return;
    irAPaso(2);
  }

  // One tap on a recent person fills the name and the contact. The delivery stays as chosen in step 1.
  function elegirReciente(reciente: RecienteDestinatario) {
    setNombre(reciente.nombre);
    setContacto(reciente.contacto);
    setIntentoDestino(false);
  }

  function seguirDelDestinatario(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    setIntentoDestino(true);
    if (errorNombre) {
      nombreRef.current?.focus();
      return;
    }
    if (errorContacto) {
      contactoRef.current?.focus();
      return;
    }
    void registrarInicioEnvio();
    irAPaso(3);
  }

  return (
    <div className={estilos.asistente}>
      <h1>Enviar dinero</h1>
      <p className={estilos.paso}>{`Paso ${paso} de 3`}</p>

      {paso === 1 && (
        <PasoMonto
          tituloRef={tituloRef}
          montoTexto={montoTexto}
          onMonto={setMontoTexto}
          moneda={moneda}
          onMoneda={setMoneda}
          entrega={entrega}
          onEntrega={setEntrega}
          tarifas={tarifas}
          precioDisponible={precioDisponible}
          error={intentoMonto ? errorMonto : null}
          cotizacion={cotizacion}
          usdBtc={usdBtc}
          errorCotizacion={errorCotizacion}
          enEspera={enEspera}
          onVencer={alVencer}
          onSeguir={seguirDelMonto}
        />
      )}

      {paso === 2 && (
        <PasoDestinatario
          tituloRef={tituloRef}
          nombre={nombre}
          onNombre={setNombre}
          nombreRef={nombreRef}
          errorNombre={intentoDestino ? errorNombre : null}
          contacto={contacto}
          onContacto={setContacto}
          contactoRef={contactoRef}
          errorContacto={intentoDestino ? errorContacto : null}
          nota={nota}
          onNota={setNota}
          recientes={recientes}
          onElegirReciente={elegirReciente}
          onVolver={() => irAPaso(1)}
          onSeguir={seguirDelDestinatario}
        />
      )}

      {paso === 3 &&
        (cotizacion && centavos !== null ? (
          <PasoConfirmar
            tituloRef={tituloRef}
            montoCentavos={centavos}
            monedaOrigen={moneda}
            entrega={entrega}
            nombre={nombre.trim()}
            contacto={contacto.trim()}
            nota={nota.trim()}
            cotizacion={cotizacion}
            usdBtc={usdBtc}
            onVencer={alVencer}
            onVolver={() => irAPaso(2)}
          />
        ) : (
          <p role="alert" className={estilos.error}>
            El monto cambió. Volvé al monto y revisalo.
          </p>
        ))}
    </div>
  );
}
