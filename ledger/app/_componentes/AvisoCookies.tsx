"use client";

import { useEffect, useState } from "react";

// Same key and rule as the Cacao Media notice (src/layouts/Base.astro): once dismissed on this browser, it stays hidden.
const CLAVE_AVISO = "cacao-aviso-cookies";

// Renders nothing on the server and on the first client render, so it cannot cause a hydration mismatch.
// It shows itself after mount, unless the storage says it was already dismissed (or cannot be read).
export function AvisoCookies() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let visto = false;
    try {
      visto = localStorage.getItem(CLAVE_AVISO) === "1";
    } catch {}
    if (!visto) setVisible(true);
  }, []);

  if (!visible) return null;

  function ocultar() {
    setVisible(false);
    try {
      localStorage.setItem(CLAVE_AVISO, "1");
    } catch {}
  }

  return (
    <aside className="aviso-cookies" aria-label="Cookies y almacenamiento">
      <p>
        Usamos cookies solo para tu sesión cuando entrás. Sin publicidad ni rastreo.{" "}
        <a href="https://cacao-grupo.vercel.app/legal.html">Privacidad</a>
      </p>
      <button type="button" className="aviso-cookies__ok" onClick={ocultar}>
        Entendido
      </button>
    </aside>
  );
}
