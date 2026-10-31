'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

import { TIPOS_NEGOCIO } from '@/lib/cobro-negocio';

import { activarAccion, type EstadoActivar } from './acciones';
import estilos from './estilos.module.css';

type Props = {
  nombre: string;
  ubicacion: string;
  tipo: string;
  /** The business is new: name, type and location are asked. */
  pideDatos: boolean;
  /** The business has no type yet (a Market business): only the type is asked. */
  pideTipo: boolean;
};

export function FormularioActivar({ nombre, ubicacion, tipo, pideDatos, pideTipo }: Props) {
  const [estado, accion] = useActionState<EstadoActivar, FormData>(activarAccion, { nombre, ubicacion, tipo });

  return (
    <form action={accion} className={estilos.formulario} aria-describedby={estado.error ? 'error-activar' : undefined}>
      {pideDatos && (
        <>
          <div className={estilos.grupo}>
            <label htmlFor="nombre-negocio" className="campo-etiqueta">
              Nombre del negocio
            </label>
            <input
              id="nombre-negocio"
              name="nombre"
              className="campo"
              type="text"
              maxLength={80}
              autoComplete="organization"
              defaultValue={estado.nombre}
              required
            />
            <p className={estilos.ayuda}>Entre 2 y 80 letras. Es el nombre que verán tus clientes.</p>
          </div>

          <div className={estilos.grupo}>
            <label htmlFor="ubicacion-negocio" className="campo-etiqueta">
              Dónde está
            </label>
            <input
              id="ubicacion-negocio"
              name="ubicacion"
              className="campo"
              type="text"
              maxLength={160}
              autoComplete="street-address"
              defaultValue={estado.ubicacion}
              required
            />
            <p className={estilos.ayuda}>Colonia, calle o zona, por ejemplo "Colonia Escalón, San Salvador".</p>
          </div>
        </>
      )}

      {pideTipo && (
        <div className={estilos.grupo}>
          <label htmlFor="tipo-negocio" className="campo-etiqueta">
            Tipo de negocio
          </label>
          <select id="tipo-negocio" name="tipo" className={estilos.select} defaultValue={estado.tipo} required>
            <option value="">Elegí uno</option>
            {TIPOS_NEGOCIO.map((t) => (
              <option key={t.clave} value={t.clave}>
                {t.etiqueta}
              </option>
            ))}
          </select>
        </div>
      )}

      {estado.error && (
        <div id="error-activar" role="alert" className={estilos.error}>
          {estado.error}
        </div>
      )}

      <BotonActivar />
    </form>
  );
}

function BotonActivar() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="boton" disabled={pending} aria-disabled={pending}>
      {pending ? 'Preparando tu negocio…' : 'Cobrar con mi negocio'}
    </button>
  );
}
