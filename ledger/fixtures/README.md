# Fixtures

Datos de prueba que se versionan. La demostración no necesita cuenta en ningún proveedor
ni conexión a internet.

| Archivo | Qué es |
|---|---|
| `comercio-prueba/clave-privada.pem` | PEM inventado para probar el cifrado por comercio. **No es válido ante Hacienda** y no va en respaldos reales. |
| `emisor.json` | Emisor ficticio de la demostración. NIT y NRC tienen formato válido; el dígito verificador no se comprueba. Códigos de establecimiento `M001` y punto de venta `P001`. Actividad 47219 y ubicación (departamento 05, municipio 27) tomadas del catálogo oficial. |
| `ticket-consumidor.json` | Venta a consumidor final: dos líneas, $4.52 con IVA incluido. Produce una factura 01. |
| `ticket-contribuyente.json` | Misma venta a contribuyente: precios netos de $1.00 y $2.00, total $4.52 con IVA. Produce un CCF 03. Incluye un receptor ficticio. |
| `blink-receive-lightning.json` | Webhook `receive.lightning` de Blink, para el ticket de consumidor. |
| `blink-receive-lightning-ccf.json` | Segundo webhook de Blink, para el ticket de contribuyente. Otro payment hash, porque cada pago liquida una sola venta. |
| `blink-receive-lightning-pupusas.json` | Tercer webhook de Blink, por $4.20, para el ticket de pupusas. Es el cobro Lightning que la demostración deja sin documento. |
| `ticket-consumidor-pupusas.json` | Venta a consumidor final de $4.20 con IVA incluido: pupusas y horchata. |
| `market-orden-1042.json` | Pedido 1042 de CacaoMarket: dos productos de una tienda de Suchitoto, $17.75, pagados por Lightning. Formato en `docs/importar-market.md`. El pago es un fixture: no hay una orden real detrás. |
| `btcpay-facturas.json` | Seis facturas de BTCPay inventadas (ids y hashes falsos) para `importar btcpay --archivo`: cuatro pagadas de los cuatro productos, una sin pagar y una sin metadatos. Formato en `docs/importar-btcpay.md`. |

## Cómo se construyeron los webhooks de Blink

Los dos archivos de Blink están construidos a mano a partir de la forma documentada en
<https://dev.blink.sv/api/webhooks>. **No se capturaron de una cuenta real.** Los campos y
sus tipos siguen el ejemplo documentado: `eventType`, `transaction.createdAt`,
`transaction.initiationVia.paymentHash`, `settlementAmount` (en sats), `settlementCurrency`,
`settlementDisplayAmount` (USD con dos decimales), `settlementDisplayPrice` y `status`.

Cambios respecto del ejemplo documentado:

- `settlementAmount` y `settlementDisplayAmount` se ajustaron a la venta de $4.52. Los sats
  se calcularon redondeados hacia arriba a 12,236, a una tasa de 36,941.26 USD por BTC.
- `settlementDisplayPrice.offset` es `"6"`, no `"12"`. Con el valor del ejemplo, base
  `36941263391` daría 0.0369 USD, que no cuadra con los montos del propio ejemplo (1.00 USD
  por 2,707 sats). Con `"6"` la base da 36,941.263391 USD por BTC, que sí cuadra. La
  herramienta no usa `settlementDisplayPrice`: calcula la tasa de los montos.
- `accountId`, `walletId`, `transaction.id` y las fechas son valores inventados.
- El `paymentHash` del primer archivo es el del ejemplo documentado. El del segundo se
  generó al azar para la prueba.

## Fixtures de la generación `caso`

`fixtures/caso/emisor.json` y `fixtures/caso/ticket-contribuyente.json` son los mismos
datos que los fixtures por defecto, con dos cambios: `tipoEstablecimiento` (`02`, casa matriz,
del paquete npm `seedcode-catalogos-mh` 8.2.0) y los códigos de municipio anteriores a la reforma
municipal (`18` Tamanique en el emisor, `14` San Salvador en el receptor). Esos códigos vienen del
paquete de terceros `seedcode-catalogos-mh` 1.0.0 a 7.0.0; no se comprobaron contra el catálogo del
Ministerio. Los fixtures de pagos Blink sirven para las dos generaciones.
