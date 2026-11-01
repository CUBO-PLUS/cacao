# Catálogo, producto, carrito y precio en bitcoin

Describe lo que ve la persona en cada pantalla antes de pagar, y por qué. Lo que sigue está en la aplicación y se revisó en el navegador a 375 px de ancho.

## Estrategia de catálogo

- **Entrada:** la portada muestra la promesa ("Comprá directo al productor. Precios en dólares."), un buscador y los chips de categoría (Todo, Frutas, Verduras, Granos y café, Lácteos y huevos, Miel y conservas, Hierbas y plantas, Comida preparada).
- **Tarjeta:** nombre, negocio, unidad, precio en dólares y en sats. Si no hay stock, la tarjeta dice "Agotado".
- **Aviso de demostración:** en la portada, una línea dice que algunos negocios son perfiles de demostración y no reciben pedidos reales.
- **Orden:** la lista sale del más reciente. No hay recomendaciones: es una decisión de versión mínima.

## Información mínima de un producto

Cada página de producto muestra, en este orden:

1. Nombre y negocio que lo vende.
2. Precio por unidad en dólares, y en sats al lado.
3. Unidad de venta ("por libra", "por bolsa de 1 libra").
4. Stock: "Quedan N" o "Agotado".
5. Descripción y foto.
6. Cantidad y botón "Agregar al carrito".

Si el negocio es de demostración, su aviso va arriba de la página, y el producto se identifica como "Ejemplo".

## Carrito

- **Por tienda:** cada negocio aparece en su bloque. Un pedido crea una orden por negocio.
- **Cantidad:** los botones "−" y "+" cambian la cantidad de la línea. "Quitar del carrito" saca la línea. Los controles tienen nombre accesible ("Quitar una unidad", "Sumar una unidad").
- **Totales:** cada línea muestra su subtotal en dólares y en sats. El total de la tienda suma las líneas.
- **Revisión:** antes de cada pedido, el carrito revisa precios y stock ("Revisamos precios y stock antes de hacer cada pedido"). Si ya no hay unidades, la base responde `SIN_STOCK` y el pedido no se crea.
- **Carrito vacío:** dice que todavía no hay productos y ofrece "Ver productos".
- **Entrega:** en un negocio normal, la persona elige "Recogida en el punto" o "Entrega por el vendedor". En un negocio de demostración no hay elección: se usa recogida y no se promete entrega.

## Checkout

El checkout es el botón "Hacer pedido" del carrito. No hay una pantalla intermedia de datos: el nombre se pide en `/cuenta` la primera vez. Al pedir:

1. Se crea la orden con el total fijado en sats (`crear_orden`), y se descuenta el stock.
2. Se abre la pantalla de pago de esa orden, con la factura.

La orden existe antes del pago. Si la persona no paga, la orden vence y el stock vuelve (ver [politicas-y-ciclo-de-orden.md](politicas-y-ciclo-de-orden.md)).

## Precio en bitcoin

- **Dólares primero:** el precio que se compara es en dólares. Los sats aparecen como referencia.
- **Sats fijos al pedir:** la conversión es `sats = ceil(centavos × 1.000.000 / cotización)`. Se redondea hacia arriba para que el vendedor nunca reciba menos. La cotización sale de Coinbase y Kraken; si difieren más de 2 %, no se crea la orden.
- **Aviso en el carrito:** "El monto en sats se fija al hacer el pedido."
- **Mismo monto en el recibo:** la orden guarda la cotización usada, y el recibo la muestra.

Hipótesis: mostrar dólares primero reduce la confusión de quien no conoce bitcoin. No está medido.

## Evidencia

- `market/src/app/productos/[id]/page.tsx` y `market/src/app/carrito/CarritoCliente.tsx`.
- `market/src/lib/carrito.ts` y `market/src/lib/carrito.test.ts`.
- `market/src/lib/precio/fuente.ts` y la sección de precio en `market/docs/pagos.md`.
