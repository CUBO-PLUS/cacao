'use client';

import { useState, useSyncExternalStore } from 'react';

import styles from './AvisoCookies.module.css';

const CLAVE_AVISO = 'cacao-aviso-cookies';

// The browser's own answer is read from storage; nothing changes it while the page is open, so there is nothing to
// subscribe to.
function suscribir() {
  return () => {};
}

function yaVisto(): boolean {
  try {
    return localStorage.getItem(CLAVE_AVISO) === '1';
  } catch {
    return false;
  }
}

// Cookie notice: a slim bar fixed above the phone tab bar. The server and the first client render count it as seen,
// so the markup matches and nothing flashes; the bar shows itself once the browser says it was not dismissed.
export function AvisoCookies() {
  const visto = useSyncExternalStore(suscribir, yaVisto, () => true);
  const [cerrado, setCerrado] = useState(false);

  if (visto || cerrado) return null;

  function entender() {
    setCerrado(true);
    try {
      localStorage.setItem(CLAVE_AVISO, '1');
    } catch {}
  }

  return (
    <aside className={styles.aviso} aria-label="Cookies y almacenamiento">
      <p className={styles.texto}>
        Usamos cookies y el almacenamiento del navegador solo para que el sitio funcione. Sin publicidad ni rastreo.{' '}
        <a className={styles.enlace} href="https://cacao-grupo.vercel.app/legal.html">
          Privacidad
        </a>
      </p>
      <button type="button" className={styles.ok} onClick={entender}>
        Entendido
      </button>
    </aside>
  );
}
