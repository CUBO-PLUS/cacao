import { etiquetaTipo } from '@/lib/cobro-negocio';
import { negociosQueCobran } from '@/servidor/negocios';

import estilos from '../negocios/estilos.module.css';

// The businesses that charge with CacaoPay (their own counter, through the payments API). A list of its own, apart from
// the BTC Map list below, so the two sources are never mixed.
export async function CobranConCacaoPay() {
  const negocios = await negociosQueCobran();

  return (
    <section aria-labelledby="titulo-cobran" className={estilos.bloque}>
      <h2 id="titulo-cobran">Cobran con CacaoPay</h2>
      <p>
        Negocios que cobran en caja con CacaoPay, en esta demo. Cobran con bitcoin de prueba, que no tiene valor.
      </p>
      {negocios.length === 0 ? (
        <p className={estilos.ayuda} role="status">
          Todavía ningún negocio cobra con CacaoPay. Si tenés uno, activalo desde Mi negocio.
        </p>
      ) : (
        <ul className={estilos.lista}>
          {negocios.map((n) => (
            <li key={n.id}>
              <strong>{n.nombre}</strong>
              <br />
              <span>
                {etiquetaTipo(n.tipo)} · {n.ubicacion}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
