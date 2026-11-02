'use client';

import { useEffect, useState } from 'react';

import styles from './AvisoCookies.module.css';

const CLAVE_AVISO = 'cacao-aviso-cookies';

// Storage notice in the page flow, at the top of the page. It renders nothing on the server and on the
// first client render, so the markup matches; it appears only if this browser has not dismissed it.
export function AvisoCookies() {
  const [mostrar, setMostrar] = useState(false);

  useEffect(() => {
    let visto = false;
    try {
      visto = window.localStorage.getItem(CLAVE_AVISO) === '1';
    } catch {
      // Storage blocked: the notice cannot be remembered, so it shows.
    }
    // Showing only after mount is the point: the server and first client render must match.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!visto) setMostrar(true);
  }, []);

  if (!mostrar) return null;

  function entendido() {
    setMostrar(false);
    try {
      window.localStorage.setItem(CLAVE_AVISO, '1');
    } catch {
      // Storage blocked: the notice stays dismissed for this visit only.
    }
  }

  return (
    <aside className={styles.aviso} aria-label="Cookies y almacenamiento">
      <p className={styles.texto}>
        Usamos cookies para tu sesión y el almacenamiento del navegador para tu carrito. Contamos visitas sin saber
        quién sos. Sin publicidad. <a href="https://cacao-grupo.vercel.app/legal.html">Privacidad</a>
      </p>
      <button type="button" className={styles.ok} onClick={entendido}>
        Entendido
      </button>
    </aside>
  );
}
