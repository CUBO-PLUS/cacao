# Importar facturas pagadas de BTCPay

`ledger importar btcpay` lee las facturas pagadas de BTCPay Server y crea un ticket pagado por cada
una. Corre cuando se le pide: no queda nada conectado en segundo plano. Una factura ya importada no
crea otro ticket.

## Uso

```
ledger importar btcpay [--desde YYYY-MM-DD]
ledger importar btcpay --archivo <facturas.json>
```

Con la red, el comando lee las tiendas indicadas en la configuración. Con `--archivo` lee una lista
JSON de facturas, con la misma forma que devuelve `infra/btcpay/btcpay.ts`, y no se conecta a nada.
Sirve para pruebas y para trabajar sin conexión. Con `--archivo` no se usa `--desde`.

Variables de entorno (solo para la lectura en red):

| Variable | Qué es |
|---|---|
| `LEDGER_BTCPAY_URL` | Dirección pública de BTCPay, con http o https. |
| `LEDGER_BTCPAY_API_KEY` | Clave de la API con permiso para ver facturas. Solo lectura. |
| `LEDGER_BTCPAY_TIENDAS` | Ids de las tiendas, separados por coma. |

Si falta alguna, el comando dice cuál falta y termina con código de salida 2.

## Qué se importa

Solo las facturas `Settled`. Cada una necesita en `metadata` los campos del contrato
(`MetadatosCacao` en `pagos/btcpay-api.ts`): `producto` (`media`, `travel`, `market` o `pay`),
`orderId`, `itemDesc`, `usdCentavos` y `cotizacionUsdBtc`. Además, la factura tiene que traer
`sats` y el `paymentHash` del pago.

El ticket es de consumidor final, con una sola línea: la descripción es `itemDesc`, cantidad 1 y el
precio `usdCentavos`, con IVA incluido. El pago es Lightning, con los sats de la factura, la tasa
`cotizacionUsdBtc` y la fuente `btcpay`. El ticket guarda el producto y el id de la factura como
origen.

## Qué se omite

Cada factura omitida sale con una frase en la lista:

- no está `Settled` (por ejemplo `New` o `Expired`);
- falta un campo de `metadata`, o `usdCentavos` o `cotizacionUsdBtc` no son válidos;
- faltan los sats o el `paymentHash`;
- la misma compra ya se importó desde CacaoMarket (`ya importada desde CacaoMarket`). Un cobro de
  `market` con el número de pedido de CacaoMarket no se duplica;
- el `paymentHash` ya cubre otro ticket.

## Idempotencia

El ticket guarda el id de la factura como origen. Si la factura ya tiene ticket, el comando lo
muestra como `ya importada` y no escribe nada. Por eso correr el comando dos veces, o con
superposición de fechas en `--desde`, no duplica tickets.

## Salida

Una línea por factura, con el ticket creado o la razón de la omisión, y al final el total:

```
TK-20261012-1A2B factura BtcpayMedia0001Fx nueva
omitida: la factura no está pagada (estado New) (factura BtcpayNuevo0005Fx)
Nuevas: 1. Repetidas: 0. Omitidas: 1.
```

`--json` imprime el resumen (`nuevas`, `repetidas`, `omitidas`) y la lista de facturas.

## Fixture

`fixtures/btcpay-facturas.json` tiene seis facturas inventadas (ids y hashes falsos): cuatro pagadas
de los cuatro productos, una sin pagar y una sin metadatos.
