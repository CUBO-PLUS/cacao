'use client';

import Link from 'next/link';
import { createContext, useContext, useOptimistic, useState } from 'react';

import { EstadoOrden } from '@/componentes/EstadoOrden';
import type { EstadoOrden as Estado } from '@/lib/estados';

import styles from './orden.module.css';

// What the page shows right after an action that ends the order, before the server answers.
// The optimistic state is set inside the action's transition: when the action fails, React drops it
// and the state from the server (the one the page was rendered with) shows again.
export type ResultadoOrden = 'entregada' | 'cancelada' | null;

type Valor = {
  estadoVisible: Estado;
  marcarEstado: (estado: Estado) => void;
  resultado: ResultadoOrden;
  setResultado: (resultado: ResultadoOrden) => void;
};

const ContextoOrden = createContext<Valor | null>(null);

/** Holds the order state the header shows and the result of the last action. One per order page. */
export function OrdenViva({ estado, children }: { estado: Estado; children: React.ReactNode }) {
  const [estadoVisible, marcarEstado] = useOptimistic(estado, (_actual: Estado, nuevo: Estado) => nuevo);
  const [resultado, setResultado] = useState<ResultadoOrden>(null);
  return (
    <ContextoOrden.Provider value={{ estadoVisible, marcarEstado, resultado, setResultado }}>
      {children}
    </ContextoOrden.Provider>
  );
}

/** The actions read it. Outside an order page there is nothing to update, so the value is null. */
export function useOrdenViva(): Valor | null {
  return useContext(ContextoOrden);
}

/** The state chip, and under it the result of the last action with the next steps. */
export function EstadoVivo({ ordenId }: { ordenId: string }) {
  const valor = useOrdenViva();
  if (valor === null) throw new Error('EstadoVivo necesita OrdenViva.');
  return (
    <>
      <p>
        <EstadoOrden estado={valor.estadoVisible} />
      </p>
      {valor.resultado === 'entregada' && (
        <div className={styles.resultado} role="status">
          <p>Entrega simulada. El pedido quedó Entregada.</p>
          <p>
            <Link href={`/ordenes/${ordenId}/recibo/`} className="boton boton--secundario">
              Ver comprobante
            </Link>{' '}
            <a href="#resena-titulo" className="boton boton--secundario">
              Ir a la reseña
            </a>
          </p>
        </div>
      )}
      {valor.resultado === 'cancelada' && (
        <div className={styles.resultado} role="status">
          <p>Pedido cancelado. Los productos volvieron al inventario.</p>
        </div>
      )}
    </>
  );
}
