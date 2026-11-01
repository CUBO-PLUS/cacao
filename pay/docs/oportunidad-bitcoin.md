# Oportunidad de Bitcoin en la remesa

Estado: análisis de hipótesis. Hay dos datos verificados (ver [`investigacion-mercado.md`](investigacion-mercado.md)); el resto son supuestos que hay que probar.

## Lo que el simulador ya hace

- Cobrar al remitente por Lightning (BTCPay en regtest) y entregar al destinatario en Lightning, en minutos.
- Entregar en efectivo o en cuenta mientras el pago de origen sigue en Lightning. Así se prueba la capa de cobro sin tocar la de entrega.

Ver [`arquitectura-y-lightning.md`](arquitectura-y-lightning.md) para la integración y [`hacienda-y-regulacion.md`](hacienda-y-regulacion.md) para el marco legal.

## Dónde podría ayudar (hipótesis)

1. **Tiempo de liquidación.** Un pago Lightning se liquida en segundos, frente a días o horas en algunos canales. Hipótesis: esto reduce el tiempo que el dinero queda en tránsito. No medido.
2. **Costo de la capa de pago.** Hipótesis: una capa de pago más barata permite una comisión menor. Hay que comprobarlo con costos reales de liquidez, que no tenemos.
3. **Acceso.** Hipótesis: quien tiene celular pero no cuenta bancaria podría recibir en una billetera. Esto depende de que la persona sepa usar la billetera.

## Riesgos que no se pueden ignorar

- **Volatilidad.** Lo que se envía en dólares y llega en sats puede valer distinto al cobrar. El simulador muestra el precio de referencia, pero no cubre la variación.
- **Liquidez.** Pagar una factura Lightning necesita canales con saldo. Hoy todo es regtest y sin valor.
- **Regulación.** La Ley Bitcoin (D.L. 199) y la regulación de proveedores de remesas tienen efectos que no analizamos aquí. Ver [`hacienda-y-regulacion.md`](hacienda-y-regulacion.md).
- **Experiencia.** El bitcoin no es para todos. Por eso la entrega en efectivo y en cuenta sigue en el producto.

## Conclusión provisional

La oportunidad es real como hipótesis de costo y velocidad, pero no está probada con datos. El siguiente paso es medir liquidez, costo y tiempo con un piloto controlado.
