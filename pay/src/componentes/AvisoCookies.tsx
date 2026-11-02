'use client';

import { useEffect, useState } from 'react';

import styles from './AvisoCookies.module.css';

const CLAVE_AVISO = 'cacao-aviso-cookies';

// Cookie notice in the page flow. Renders nothing on the server and on the first client render, so the
// markup matches; it shows itself after mount unless this browser already dismissed it.
export function AvisoCookies() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let visto = false;
    try {
      visto = localStorage.getItem(CLAVE_AVISO) === '1';
    } catch {}
    if (!visto) setVisible(true);
  }, []);

  if (!visible) return null;

  function entender() {
    setVisible(false);
    try {
      localStorage.setItem(CLAVE_AVISO, '1');
    } catch {}
  }

  return (
    <aside className={styles.aviso} aria-label="Cookies y almacenamiento">
      <p className={styles.texto}>
        Usamos cookies para tu sesión y contamos visitas sin saber quién sos. Sin publicidad.{' '}
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
