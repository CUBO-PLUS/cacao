import type { Metadata } from 'next';

import { formatoUsd } from '@/lib/dinero';
import { inventarioAdmin } from '@/servidor/admin';
import { exigirAdmin } from '@/servidor/sesion';

import estilos from '../estilos.module.css';
import { TablaAdmin } from '../TablaAdmin';

export const metadata: Metadata = {
  title: 'Inventario',
};

// Sold out first, then paused, then the rest. The label says what a buyer sees for the product.
function estadoDe(stock: number, activo: boolean): string {
  if (stock === 0) return 'Agotado';
  if (!activo) return 'Pausado';
  return 'Disponible';
}

export default async function PaginaInventario() {
  const sesion = await exigirAdmin();
  const productos = await inventarioAdmin(sesion.usuario.id);
  const agotados = productos.filter((p) => p.stock === 0).length;

  const filas = productos.map((p) => ({
    clave: p.id,
    celdas: [
      p.nombre,
      p.negocio || '—',
      `${formatoUsd(p.precioUsdCentavos)} por ${p.unidad}`,
      String(p.stock),
      estadoDe(p.stock, p.activo),
    ],
  }));

  return (
    <>
      <section className={estilos.bloque} aria-labelledby="titulo-inventario">
        <h2 id="titulo-inventario" className={estilos.subtitulo}>
          Inventario
        </h2>
        <p className={estilos.descripcion}>
          Stock de todos los productos. Cada compra lo descuenta al hacer la orden, y vuelve si la orden vence o se
          cancela. Hay {productos.length} productos y {agotados} agotados.
        </p>
      </section>

      {productos.length === 0 ? (
        <p className={estilos.vacio}>Todavía no hay productos.</p>
      ) : (
        <TablaAdmin
          titulo="Stock por producto"
          encabezados={['Producto', 'Negocio', 'Precio', 'Stock', 'Estado']}
          filas={filas}
        />
      )}
    </>
  );
}
