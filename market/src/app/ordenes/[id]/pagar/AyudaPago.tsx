import { CORREO_CONTACTO } from '@/lib/contacto';

import styles from './estilos.module.css';

// The line under a failed payment request: where to write when trying again does not help.
export function AyudaPago() {
  return (
    <p className={styles.nota}>
      ¿Algo no funciona? Escribinos a <a href={`mailto:${CORREO_CONTACTO}`}>{CORREO_CONTACTO}</a>
    </p>
  );
}
