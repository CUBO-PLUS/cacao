# Modelo de comisiones y de conversión

Esta es la cuenta que hace el sistema. Está en [`src/lib/cotizacion.ts`](../src/lib/cotizacion.ts) y se vuelve a calcular en el servidor y en la base de datos (`_pay_calcular`). Las pruebas están en `src/lib/cotizacion.test.ts`.

## Comisión

Fórmula, en centavos, redondeada hacia arriba para que nunca quede corta:

```
comisión = tarifa fija + ceil(monto × porcentaje / 10 000)
```

| Entrega | Tarifa fija | Porcentaje | Tiempo estimado (supuesto) |
|---|---|---|---|
| Bitcoin por Lightning | US$0.00 | 0.50% | 1 minuto |
| Cuenta bancaria | US$0.99 | 1.00% | 60 minutos |
| Efectivo | US$1.99 | 1.50% | 30 minutos |

Ejemplo, US$100 en efectivo: 199 + ceil(100 × 150 / 10 000) = US$3.49. Llegan US$96.51.

**Dato:** estas tarifas son las que están sembradas en `pay_tarifas` y en el código. **Hipótesis:** son un supuesto del simulador, no una tarifa comercial. No se compararon con las de ningún proveedor real.

## Conversión

- Del dólar a dólar no hay cambio: El Salvador usa dólares. La línea dice "No hay cambio".
- De euro a dólar: 1 EUR = 1.08 USD, marcado como **tasa fija de demostración**. Se guarda en `pay_tasas` con ocho decimales.
- Para Lightning, el monto en sats sale del precio BTC/USD de dos fuentes (Coinbase y Kraken). Si el precio no se puede leer, Lightning no se cotiza.
- La cotización vale por un tiempo corto. Si vence, la pantalla pide una nueva y el servidor rechaza el envío si el monto o la tasa ya no coinciden.

## Qué ve quien envía

Cuatro líneas separadas: **Enviás**, **Comisión** (con su fórmula en palabras), **Tipo de cambio** y **Recibe**. La comisión nunca se mezcla con la tasa.

## Qué no modela todavía

- Tarifas por país o por monto.
- Redondeo y tasas de un proveedor real.
- Impuestos de la comisión en la línea de cobro (se muestran aparte, en `/hacienda` y en el envío).
