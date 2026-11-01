# Análisis de competidores

Estado: borrador. No se verificaron comisiones, tiempos ni cifras de ningún competidor en esta revisión. Por eso la tabla comparativa sólo incluye a CacaoPay.

## Qué sí sabemos

- [`hacienda-y-regulacion.md`](hacienda-y-regulacion.md) (sección 4.2) dice que **Remitly y Western Union no se compararon** porque sus comisiones no se verificaron. Ese vacío sigue abierto.

## Tipos de competidores (hipótesis)

| Tipo | Ejemplo | Qué ofrece | Qué no sabemos |
|---|---|---|---|
| Empresas de transferencia con red de sucursales | Western Union (nombre citado, sin datos) | Retiro en efectivo en agencias | Comisión y tipo de cambio actuales |
| Apps de envío digital | Remitly (nombre citado, sin datos) | Envío desde el celular, depósito en cuenta o efectivo | Comisión y tiempos actuales |
| Bancos y cooperativas | Sin nombres definidos | Transferencia entre cuentas | Costo y tiempo en El Salvador |
| Envíos en bitcoin o stablecoins | Sin nombres definidos | Liquidación rápida | Disponibilidad real para quien recibe |

## Dónde CacaoPay intenta diferenciarse (hipótesis de producto)

- Mostrar la comisión y el tipo de cambio por separado, y el monto final que recibe la familia antes de confirmar. Está implementado en `/enviar` (ver [`modelo-comisiones-y-conversion.md`](modelo-comisiones-y-conversion.md)).
- Seguir el envío con un código, sin cuenta, desde `/t/CP-XXXX-XXXX`.
- Dar tres formas de recibir el dinero: efectivo, cuenta o Lightning.

**Importante:** es una simulación. CacaoPay no mueve dinero real y no tiene la licencia de un proveedor de remesas. Compararse con operadores reales exige datos que todavía no tenemos.

## Próximo paso

Verificar en las páginas públicas de cada competidor su comisión y tiempo para un envío de US$100 y US$200, con fecha y captura.
