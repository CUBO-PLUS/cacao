# Estrategia de la tienda: concepto, cliente y mercado

Este documento describe qué es CacaoMarket hoy y para quién está pensado. Lo que dice sobre el cliente y la competencia es **hipótesis**: no hicimos entrevistas, encuestas ni estudios de mercado con datos propios. Cuando haya tráfico real, cada hipótesis se valida con las métricas de [conversion-y-kpis.md](conversion-y-kpis.md).

## Concepto

CacaoMarket es un mercado de productos y servicios locales en El Salvador. El comprador paga en bitcoin por Lightning. El cobro va a la tienda de cada negocio, y CacaoMarket no custodia dinero. Un carrito con productos de dos negocios se convierte en dos órdenes, una por negocio.

Lo que hace el producto hoy:

- Venta de productos con stock, por unidad o por libra, con precio en dólares y referencia en sats.
- Servicios a precio fijo, o con cotización del vendedor.
- Un tablón de necesidades donde alguien pide algo y los negocios responden con ofertas.
- Panel del vendedor (productos, órdenes, cotizaciones) y panel de administración (negocios, órdenes, inventario, disputas, embudo).

Lo que no hace: no emite factura electrónica (eso lo hace CacaoLedger), no tiene envíos con cobertura propia y no mueve bitcoin real en la versión de demostración.

## Categoría

Productos de alimentación y artículos locales (granos y café, frutas, verduras, lácteos, miel, comida preparada), más servicios de oficio. La categoría sale de la tabla `categorias`. No hay un estudio de demanda detrás.

## Cliente objetivo (hipótesis)

- **Comprador:** una persona de El Salvador que ya tiene una billetera Lightning o está dispuesta a instalar una, y quiere comprar a productores o negocios pequeños. Hipótesis: se siente más cómodo viendo precios en dólares, con el monto en sats como segunda línea.
- **Vendedor:** un productor o negocio pequeño que ya acepta bitcoin o quiere probarlo, con poco tiempo para tener una tienda propia. Hipótesis: prefiere una vitrina compartida a montar un sitio.

No sabemos cuántos de estos perfiles existen ni cuántos comprarían. Eso no está medido.

## Mercado y competencia

No hay datos de mercado propios. Estas son referencias de conocimiento general, usadas para comparar:

| Referencia | Qué es | Qué aprendemos (hipótesis) |
|---|---|---|
| Marketplaces tradicionales (por ejemplo, Mercado Libre o Facebook Marketplace) | Compra con tarjeta o efectivo, con catálogo y reseñas | La gente espera un carrito simple, precio claro y estado del pedido. No aceptan bitcoin. |
| BTC Map | Directorio de negocios que aceptan bitcoin | Ya hay negocios salvadoreños listados. Por eso CacaoMarket muestra negocios reales como perfiles de demostración, con aviso. |
| BTCPay Server | Procesador de pagos de bitcoin autoalojado | Es la base del cobro de cada tienda; no es una tienda para el comprador. |

Diferencia que proponemos (hipótesis a validar): un solo lugar para comprar en negocios locales que aceptan bitcoin, con el cobro directo al negocio y sin comisión de CacaoMarket en la versión actual.

## Negocios de demostración

Para que la vitrina no esté vacía, hay negocios reales de BTC Map cargados como perfiles de demostración. Sus productos y precios son ejemplos, y no se les pide nada. Cada página lo dice, y sus pedidos son de demostración: no se paga a ninguno de ellos. Ver [politicas-y-ciclo-de-orden.md](politicas-y-ciclo-de-orden.md#politicas).

## Riesgos conocidos

- El cliente necesita una billetera Lightning. Hipótesis: es la mayor barrera de entrada.
- El precio del bitcoin cambia. La orden fija los sats al crearse; ver [catalogo-y-carrito.md](catalogo-y-carrito.md#precio-en-bitcoin).
- No hay investigación de campo todavía. Las decisiones de catálogo y pago son razonables, pero no están comprobadas.
