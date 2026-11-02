import estilos from './estilos.module.css';

// The period as two date inputs. A plain GET form, so it works before any script loads.
export function FiltroPeriodo({
  ruta,
  desde,
  hasta,
  aviso,
}: {
  ruta: string;
  desde: string;
  hasta: string;
  aviso: string | null;
}) {
  return (
    <form action={ruta} method="get" className={estilos.filtro}>
      <div className={estilos.filtroCampo}>
        <label htmlFor="desde" className="campo-etiqueta">
          Desde
        </label>
        <input id="desde" name="desde" type="date" className="campo" defaultValue={desde} required />
      </div>
      <div className={estilos.filtroCampo}>
        <label htmlFor="hasta" className="campo-etiqueta">
          Hasta
        </label>
        <input id="hasta" name="hasta" type="date" className="campo" defaultValue={hasta} required />
      </div>
      <button type="submit" className="boton">
        Ver período
      </button>
      {aviso && (
        <p role="alert" className={estilos.error}>
          {aviso}
        </p>
      )}
    </form>
  );
}
