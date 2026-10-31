'use client';

import { useAuth } from '@clerk/nextjs';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';

import { Boton } from '@/componentes/Boton';
import { AvisoPedidoDemo, EtiquetaEjemplo } from '@/componentes/Demo';
import { modoDeEntrega, opcionesDeEntrega } from '@/lib/demo';
import { EtiquetaPrecio } from '@/componentes/EtiquetaPrecio';
import { FotoProducto } from '@/componentes/FotoProducto';
import { Vacio } from '@/componentes/Vacio';
import {
  agregarAlCarrito,
  cambiarCantidad,
  claveIdempotencia,
  EVENTO_CARRITO,
  leerCarrito,
  type LineaCarrito,
  vaciarNegocio,
} from '@/lib/carrito';
import { formatoSats, formatoUsd, usdCentavosASats } from '@/lib/dinero';

import { hacerPedido, revisarCarrito } from './acciones';
import styles from './estilos.module.css';
import type { ModoEntrega, ProductoRevisado, RevisionCarrito } from './tipos';

const MODOS: { valor: ModoEntrega; etiqueta: string }[] = [
  { valor: 'recogida', etiqueta: 'Recogida en el punto' },
  { valor: 'entrega_vendedor', etiqueta: 'Entrega por el vendedor' },
];

// Same cap as the cart and the server.
const MAX_UNIDADES = 99;

function suscribirCarrito(avisar: () => void) {
  window.addEventListener(EVENTO_CARRITO, avisar);
  window.addEventListener('storage', avisar);
  return () => {
    window.removeEventListener(EVENTO_CARRITO, avisar);
    window.removeEventListener('storage', avisar);
  };
}

// A JSON string is a stable snapshot: equal carts compare equal, so React does not re-render for nothing.
function instantaneaCarrito(): string {
  return JSON.stringify(leerCarrito());
}

// Server render has no cart. The browser's cart arrives right after hydration.
function sinCarritoEnServidor(): null {
  return null;
}

// One cart line after the server check. Until the check arrives, the stored values stand in.
type Fila = {
  linea: LineaCarrito;
  nombre: string;
  unidad: string;
  foto: string | null;
  categoriaId: number;
  precioUsdCentavos: number;
  disponible: boolean;
  /** Units the order asks for: the cart amount, capped to stock. */
  cantidad: number;
  stock: number | null;
  motivo: string | null;
  /** The seller is a demo profile. Known once the cart has been checked. */
  demo: boolean;
};

function filaDe(linea: LineaCarrito, producto: ProductoRevisado | undefined, revisada: boolean): Fila {
  const guardada = {
    linea,
    nombre: linea.nombre,
    unidad: linea.unidad,
    foto: linea.foto,
    categoriaId: 0,
    precioUsdCentavos: linea.precioUsdCentavos,
    stock: null,
    demo: false,
  };
  if (!revisada) return { ...guardada, disponible: true, cantidad: linea.cantidad, motivo: null };
  if (!producto) {
    return { ...guardada, disponible: false, cantidad: 0, motivo: 'Ya no está disponible.' };
  }
  const actual = {
    ...guardada,
    nombre: producto.nombre,
    unidad: producto.unidad,
    foto: producto.foto,
    categoriaId: producto.categoriaId,
    precioUsdCentavos: producto.precioUsdCentavos,
    stock: producto.stock,
    demo: producto.demo,
  };
  if (!producto.disponible) {
    return { ...actual, disponible: false, cantidad: 0, motivo: producto.motivo };
  }
  return { ...actual, disponible: true, cantidad: Math.min(linea.cantidad, producto.stock), motivo: null };
}

type Grupo = {
  negocioId: string;
  negocioNombre: string;
  filas: Fila[];
  disponibles: Fila[];
  totalUsdCentavos: number;
  /** The shop is a demo profile: its order is a demonstration. */
  demo: boolean;
};

function agrupar(filas: Fila[]): Grupo[] {
  const porNegocio = new Map<string, Grupo>();
  for (const fila of filas) {
    const id = fila.linea.negocioId;
    let grupo = porNegocio.get(id);
    if (!grupo) {
      grupo = {
        negocioId: id,
        negocioNombre: fila.linea.negocioNombre,
        filas: [],
        disponibles: [],
        totalUsdCentavos: 0,
        demo: false,
      };
      porNegocio.set(id, grupo);
    }
    grupo.filas.push(fila);
    if (fila.demo) grupo.demo = true;
    if (fila.disponible) {
      grupo.disponibles.push(fila);
      grupo.totalUsdCentavos += fila.precioUsdCentavos * fila.cantidad;
    }
  }
  return Array.from(porNegocio.values());
}

// Sats and USD together. Without a BTC price the amount is USD only, as the price tags do.
function precioTexto(usdCentavos: number, cotizacion: number | null): string {
  if (cotizacion === null || usdCentavos <= 0) return formatoUsd(usdCentavos);
  return `${formatoSats(usdCentavosASats(usdCentavos, cotizacion))} · ${formatoUsd(usdCentavos)}`;
}

// Brings the stored cart in line with the server: current name, price and photo, and no more units
// than stock. Returns one note per product whose price or stock the buyer should see.
function ajustarCarrito(lineas: LineaCarrito[], revision: RevisionCarrito): Record<string, string> {
  const notas: Record<string, string> = {};
  for (const producto of revision.productos) {
    const linea = lineas.find((l) => l.productoId === producto.productoId);
    if (!linea || !producto.disponible) continue;

    const cantidad = Math.min(linea.cantidad, producto.stock);
    const partes: string[] = [];
    if (producto.precioUsdCentavos !== linea.precioUsdCentavos) {
      partes.push(`El precio cambió. Antes era ${formatoUsd(linea.precioUsdCentavos)}.`);
    }
    if (cantidad < linea.cantidad) partes.push(`Solo quedan ${producto.stock}. Ajustamos la cantidad.`);
    if (partes.length > 0) notas[producto.productoId] = partes.join(' ');

    const cambio =
      partes.length > 0 ||
      producto.nombre !== linea.nombre ||
      producto.unidad !== linea.unidad ||
      producto.foto !== linea.foto;
    if (cambio) {
      // The cart has no update call: remove the line and add it again with the fresh values.
      cambiarCantidad(producto.productoId, 0);
      agregarAlCarrito(
        {
          productoId: producto.productoId,
          negocioId: linea.negocioId,
          negocioNombre: linea.negocioNombre,
          nombre: producto.nombre,
          unidad: producto.unidad,
          precioUsdCentavos: producto.precioUsdCentavos,
          foto: producto.foto,
        },
        cantidad,
      );
    }
  }
  return notas;
}

export function CarritoCliente() {
  const datos = useSyncExternalStore<string | null>(suscribirCarrito, instantaneaCarrito, sinCarritoEnServidor);
  if (datos === null) {
    return (
      <p role="status" className={styles.cargando}>
        Cargando tu carrito…
      </p>
    );
  }
  return <CarritoListo datos={datos} />;
}

function CarritoListo({ datos }: { datos: string }) {
  const router = useRouter();
  const { isLoaded, isSignedIn } = useAuth();
  const lineas = useMemo(() => JSON.parse(datos) as LineaCarrito[], [datos]);
  // Bumped to check the cart again, for example after a failed order.
  const [version, setVersion] = useState(0);
  const clave = `${version}|${datos}`;
  const [revision, setRevision] = useState<{
    clave: string;
    datos: RevisionCarrito | null;
    error: string | null;
  } | null>(null);
  const [avisos, setAvisos] = useState<Record<string, string>>({});
  const [modos, setModos] = useState<Record<string, ModoEntrega>>({});
  const [pidiendo, setPidiendo] = useState<string | null>(null);
  const [errores, setErrores] = useState<Record<string, string>>({});
  // Ref, not state: a second tap in the same frame must not send a second order.
  const enCurso = useRef(false);

  useEffect(() => {
    if (lineas.length === 0) return;
    let vigente = true;
    revisarCarrito(lineas.map(({ productoId, cantidad }) => ({ productoId, cantidad })))
      .then((r) => {
        if (!vigente) return;
        if (!r.ok) {
          setRevision({ clave, datos: null, error: r.mensaje });
          return;
        }
        setRevision({ clave, datos: r.dato, error: null });
        const notas = ajustarCarrito(lineas, r.dato);
        if (Object.keys(notas).length > 0) setAvisos((previas) => ({ ...previas, ...notas }));
      })
      .catch(() => {
        if (vigente) {
          setRevision({ clave, datos: null, error: 'No pudimos revisar el carrito. Probá de nuevo.' });
        }
      });
    return () => {
      vigente = false;
    };
  }, [clave, lineas]);

  const actual = revision !== null && revision.clave === clave ? revision : null;
  const revisada = actual?.datos != null;
  const porId = new Map((actual?.datos?.productos ?? []).map((p) => [p.productoId, p] as const));
  const cotizacion = actual?.datos?.cotizacion ?? null;
  const grupos = agrupar(lineas.map((linea) => filaDe(linea, porId.get(linea.productoId), revisada)));

  async function pedir(grupo: Grupo) {
    // Until Clerk loads, isSignedIn is still undefined. Wait instead of sending the visitor to sign in.
    if (!isLoaded || enCurso.current) return;
    enCurso.current = true;
    setPidiendo(grupo.negocioId);
    setErrores((previos) => {
      const siguiente = { ...previos };
      delete siguiente[grupo.negocioId];
      return siguiente;
    });
    const liberar = () => {
      enCurso.current = false;
      setPidiendo(null);
    };

    try {
      if (!isSignedIn) {
        liberar();
        router.push('/entrar?volver=/carrito');
        return;
      }

      const resultado = await hacerPedido({
        negocioId: grupo.negocioId,
        lineas: grupo.disponibles.map((f) => ({ productoId: f.linea.productoId, cantidad: f.cantidad })),
        modo: modoDeEntrega(grupo.demo, modos[grupo.negocioId] ?? 'recogida'),
        clave: claveIdempotencia(grupo.negocioId),
      });

      if (resultado.ok) {
        vaciarNegocio(grupo.negocioId);
        // The button stays locked until the next page replaces this one.
        router.push(`/ordenes/${resultado.dato.ordenId}/pagar`);
        return;
      }

      liberar();
      if (resultado.codigo === 'SIN_SESION') {
        router.push('/entrar?volver=/carrito');
        return;
      }
      setErrores((previos) => ({ ...previos, [grupo.negocioId]: resultado.mensaje }));
      // Prices and stock may have moved: check the cart again.
      setVersion((v) => v + 1);
    } catch {
      liberar();
      setErrores((previos) => ({
        ...previos,
        [grupo.negocioId]: 'No pudimos enviar el pedido. Revisá tu conexión y probá de nuevo.',
      }));
    }
  }

  if (lineas.length === 0) {
    return (
      <Vacio
        texto="Todavía no agregaste productos al carrito."
        accion={{ href: '/', etiqueta: 'Ver productos' }}
      />
    );
  }

  return (
    <div className={styles.carrito}>
      {actual?.error && (
        <div className={styles.alerta} role="alert">
          <p>{actual.error}</p>
          <Boton variante="secundario" onClick={() => setVersion((v) => v + 1)}>
            Revisar de nuevo
          </Boton>
        </div>
      )}
      {!revisada && !actual?.error && (
        <p role="status" className={styles.estado}>
          Revisando precios y stock…
        </p>
      )}

      {grupos.map((grupo) => (
        <BloqueNegocio
          key={grupo.negocioId}
          grupo={grupo}
          cotizacion={cotizacion}
          revisada={revisada}
          sesionCargada={isLoaded}
          modo={modos[grupo.negocioId] ?? 'recogida'}
          onModo={(valor) => setModos((previos) => ({ ...previos, [grupo.negocioId]: valor }))}
          onPedir={() => void pedir(grupo)}
          pidiendo={pidiendo}
          error={errores[grupo.negocioId] ?? null}
          avisos={avisos}
        />
      ))}
    </div>
  );
}

function BloqueNegocio({
  grupo,
  cotizacion,
  revisada,
  sesionCargada,
  modo,
  onModo,
  onPedir,
  pidiendo,
  error,
  avisos,
}: {
  grupo: Grupo;
  cotizacion: number | null;
  revisada: boolean;
  sesionCargada: boolean;
  modo: ModoEntrega;
  onModo: (valor: ModoEntrega) => void;
  onPedir: () => void;
  pidiendo: string | null;
  error: string | null;
  avisos: Record<string, string>;
}) {
  const idTitulo = `negocio-${grupo.negocioId}`;
  const hayDisponibles = grupo.disponibles.length > 0;
  const puedePedir = revisada && hayDisponibles && pidiendo === null && sesionCargada;

  return (
    <section className={styles.negocio} aria-labelledby={idTitulo}>
      <h2 id={idTitulo} className={styles.negocioTitulo}>
        {grupo.negocioNombre} <EtiquetaEjemplo activo={grupo.demo} />
      </h2>

      <ul className={styles.lineas}>
        {grupo.filas.map((fila) => (
          <FilaCarrito
            key={fila.linea.productoId}
            fila={fila}
            cotizacion={cotizacion}
            aviso={avisos[fila.linea.productoId]}
          />
        ))}
      </ul>

      <div className={styles.resumen}>
        {hayDisponibles ? (
          <>
            <EtiquetaPrecio
              usdCentavos={grupo.totalUsdCentavos}
              sats={cotizacion === null ? null : usdCentavosASats(grupo.totalUsdCentavos, cotizacion)}
            />
            <p className={styles.nota}>El monto en sats se fija al hacer el pedido.</p>
          </>
        ) : (
          <p className={styles.nota}>No hay productos disponibles de esta tienda.</p>
        )}
      </div>

      {opcionesDeEntrega(grupo.demo).length > 0 && (
        <fieldset className={styles.modo}>
          <legend>Cómo querés recibirlo</legend>
          {MODOS.map((opcion) => (
            <label key={opcion.valor} className={styles.opcion}>
              <input
                type="radio"
                name={`modo-${grupo.negocioId}`}
                value={opcion.valor}
                checked={modo === opcion.valor}
                onChange={() => onModo(opcion.valor)}
              />
              {opcion.etiqueta}
            </label>
          ))}
        </fieldset>
      )}

      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}

      <AvisoPedidoDemo activo={grupo.demo} />

      <div className={styles.accion}>
        <Boton onClick={onPedir} disabled={!puedePedir}>
          Hacer pedido
        </Boton>
      </div>
    </section>
  );
}

function FilaCarrito({
  fila,
  cotizacion,
  aviso,
}: {
  fila: Fila;
  cotizacion: number | null;
  aviso: string | undefined;
}) {
  const id = fila.linea.productoId;
  const tope = fila.stock ?? MAX_UNIDADES;
  const subtotal = fila.precioUsdCentavos * fila.cantidad;

  return (
    <li className={styles.linea}>
      <div className={styles.fotoCaja}>
        <FotoProducto src={fila.foto} nombre={fila.nombre} categoriaId={fila.categoriaId} />
      </div>

      <div className={styles.cuerpo}>
        <p className={styles.nombre}>{fila.nombre}</p>
        <p className={styles.unidad}>
          {formatoUsd(fila.precioUsdCentavos)} por {fila.unidad}
        </p>
        {fila.motivo && <p className="motivo">{fila.motivo}</p>}
        {aviso && <p className={styles.aviso}>{aviso}</p>}

        {fila.disponible ? (
          <div className={styles.controles}>
            <div className="stepper">
              <button
                type="button"
                aria-label="Quitar una unidad"
                onClick={() => cambiarCantidad(id, fila.cantidad - 1)}
              >
                −
              </button>
              <output aria-label={`Cantidad: ${fila.cantidad}`}>{fila.cantidad}</output>
              <button
                type="button"
                aria-label="Sumar una unidad"
                onClick={() => cambiarCantidad(id, fila.cantidad + 1)}
                disabled={fila.cantidad >= tope}
              >
                +
              </button>
            </div>
            <p className={styles.subtotal}>{precioTexto(subtotal, cotizacion)}</p>
          </div>
        ) : (
          <button type="button" className={styles.quitar} onClick={() => cambiarCantidad(id, 0)}>
            Quitar del carrito
          </button>
        )}
      </div>
    </li>
  );
}
