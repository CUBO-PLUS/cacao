'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';

import { Boton } from '@/componentes/Boton';

// Repeats the page's own read of the order. Used when the screen could not load the order at all.
export function ReintentarLectura() {
  const router = useRouter();
  const [pendiente, empezar] = useTransition();
  return (
    <Boton disabled={pendiente} onClick={() => empezar(() => router.refresh())}>
      Intentar de nuevo
    </Boton>
  );
}
