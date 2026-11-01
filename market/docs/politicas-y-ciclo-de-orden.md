# Ciclo de la orden y políticas

Estados, tiempos y reglas de cada caso, tal como los aplica la base de datos y la aplicación. Los detalles técnicos están en [pagos.md](pagos.md) y [base-de-datos.md](base-de-datos.md).

## Estados de la orden de productos

| Estado en pantalla | Qué significa | Quién lo pasa |
|---|---|---|
| Creada | La orden existe y se está registrando la factura | Sistema, al pedir |
| Esperando pago | Hay factura y falta pagarla | Sistema, al registrar la factura |
| Pagada | El pago se confirmó una sola vez | Sistema (BTCPay o CacaoPay), o el vendedor si el cobro es manual |
| Lista, Entregada, Cerrada | El vendedor la prepara y la entrega | Vendedor y comprador |
| Expirada | Venció sin pago; el stock volvió | Sistema |
| Cancelada | El comprador la canceló antes de pagar; el stock volvió | Comprador |
| En disputa, Resuelta | Hay un reclamo sobre una orden pagada | Comprador y administración |

En inglés, para comparar con otros productos: Esperando pago = Pending, Pagada = Paid, Expirada = Expired, Cancelada = Cancelled.

## Estados de la factura

Cada orden tiene una solicitud de pago (cobro): **pendiente**, **pagado**, **expirado** o **cancelado**. Solo `pagado` confirma la orden. La base no acepta un pago después del vencimiento: `confirmar_pago` responde `FUERA_DE_PLAZO`.

## Vencimiento de la factura

- La factura vence a los **10 minutos** (600 segundos) desde que se crea.
- La pantalla de pago muestra la cuenta regresiva y, en el último minuto, lo avisa.
- Cuando vence, la pantalla dice que se acabó el tiempo y la orden pasa a Expirada. Las consultas a la página hacen una limpieza (`barrer`) para que nadie vea una factura vencida como pagable.

## Políticas

**Pago abandonado.** Si la persona no paga, la orden queda en Esperando pago hasta el vencimiento. Después pasa a Expirada, el stock vuelve, y el comprador ve que se acabó el tiempo y puede volver a comprar. Si paga después del vencimiento, el pago no marca la orden como pagada.

**Cancelación.** El comprador puede cancelar mientras la orden está Creada o Esperando pago. La factura se cancela, el stock vuelve y la orden queda Cancelada. Un pago que llegue después no se confirma. Una orden ya pagada no se cancela: se abre una disputa.

**Inventario no disponible.** Si al pedir ya no hay unidades, no se crea la orden y el carrito dice qué producto se agotó. El stock se descuenta al crear la orden, no al pagar, para que dos personas no compren la última unidad a la vez.

**Pago duplicado.** Un doble toque no crea dos órdenes (clave de idempotencia por intento). Una factura se confirma una sola vez: `confirmar_pago` bloquea la orden y la factura, y un segundo intento responde que la orden ya no está esperando pago.

**Negocios de demostración.** Los negocios de BTC Map que aparecen como ejemplo no reciben pagos. Sus pedidos usan el cobro simulado: la pantalla ofrece "Simular pago" y no se envía bitcoin a nadie. Cada página lo dice.

**Vendedor sin cobro configurado.** Si el negocio no tiene Lightning Address válida ni tienda de BTCPay, la factura no se crea y la orden queda en Creada, con el botón "Intentar de nuevo". La orden vence sola si nadie vuelve.

## Lo que queda fuera de esta versión

- Reembolsos automáticos. Las disputas se resuelven a mano en administración.
- Envíos con cobertura, seguimiento y tarifas.
- Cobro con tarjeta o efectivo.
