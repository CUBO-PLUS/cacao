# Conversión y KPIs

Qué medimos del embudo y qué estrategia de conversión proponemos. Todo lo de conversión es **hipótesis**: todavía no hay tráfico real que lo confirme. Las cifras se leen en el panel de embudo (`/admin/embudo`), que cuenta sesiones por paso.

## Embudo y eventos

`registrar_evento` guarda una fila por evento, sesión y objeto por hora.

| Paso | Evento | Quién lo registra | Qué cuenta |
|---|---|---|---|
| Vista de producto | `vista_producto` | Navegador | Sesiones que abren una página de producto |
| Agregar al carrito | `agrego_carrito` | Navegador | Sesiones que agregan una unidad |
| Inicio de compra | `inicio_pedido` | Servidor | Órdenes creadas ("Hacer pedido") |
| Vio la factura | `vio_pago` | Servidor | Sesiones que abren la pantalla de pago |
| Pago | `pago` | Servidor | Órdenes pagadas (la compra se concreta) |

Para trabajos hay eventos paralelos: `vista_servicio`, `acordo_trabajo`, `trabajo_hecho`, `vio_pago_trabajo` y `pago_trabajo`.

## KPIs

| KPI | Definición | Cómo se calcula |
|---|---|---|
| Vistas de producto | Sesiones con vista de producto en el período | Paso 1 del embudo |
| Adiciones al carrito | Sesiones que agregan al carrito | Paso 2 |
| Inicios de compra | Órdenes creadas | Paso 3 |
| Pagos | Órdenes pagadas | Paso 5 |
| Conversión de vista a compra | Pagos entre vistas de producto | Paso 5 dividido entre paso 1 |
| Abandono de carrito | 1 menos (inicios entre adiciones) | Paso 2 contra paso 3 |
| Abandono de pago | 1 menos (pagos entre facturas vistas) | Paso 4 contra paso 5 |
| Facturas vencidas | Cobros con estado expirado | Tabla de cobros |

Advertencia: las sesiones son anónimas y por navegador. Una persona que compra desde dos dispositivos cuenta dos veces en los pasos de visita.

## Estrategia de conversión (hipótesis)

1. **Precio en dólares primero, sats después.** Hipótesis: reduce la duda de quien no conoce bitcoin. Se mide con el abandono entre adiciones e inicios.
2. **Stock visible ("Quedan N").** Hipótesis: pocas unidades empujan a pagar. Riesgo: presión falsa; por eso se muestra el número real.
3. **Pantalla de pago con cuenta regresiva y copia de factura.** Hipótesis: bajar el abandono de pago. Se mide con la diferencia entre facturas vistas y pagos.
4. **Aviso al último minuto.** Ya existe en la pantalla de pago. No hay aviso por correo.
5. **Carrito por negocio.** Evita pagar dos veces sin querer. La contrapartida: un carrito con dos negocios crea dos facturas.

## Lo que todavía no hacemos

- No hay pruebas A/B.
- No hay correo ni aviso fuera de la app para carritos abandonados.
- No medimos de dónde llega cada visita.
