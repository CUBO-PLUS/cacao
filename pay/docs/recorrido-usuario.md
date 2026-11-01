# Recorrido del usuario

Este documento describe el recorrido de quien envía y de quien recibe, tal como lo recorrimos en el navegador a 375 px. Las personas están en [`hacienda-y-regulacion.md`](hacienda-y-regulacion.md) (sección 4.3); son perfiles de trabajo, no entrevistas.

## Quien envía

1. **Inicio (`/`)**: ve cuánto recibe la familia para un monto. Elige cómo lo recibe: Bitcoin por Lightning, efectivo o cuenta bancaria.
2. **Entrar (`/entrar`)**: con celular o correo, por código. Sin contraseña.
3. **Enviar, paso 1 (`/enviar`)**: monto, moneda y forma de entrega. Ve comisión, tipo de cambio y "Recibe". La cotización vale unos minutos.
4. **Enviar, paso 2**: nombre y celular o correo de quien recibe. Hay chips de personas a las que ya envió.
5. **Enviar, paso 3**: resumen en palabras, y botón "Confirmar envío". Se crea el envío en estado "Sin enviar".
6. **Pagar la factura**: desde el envío, "Pagar con Lightning". Con BTCPay activo, el envío sale sólo cuando la factura queda pagada. Esto vale para las tres formas de entrega.
7. **Compartir el código**: el envío muestra `CP-XXXX-XXXX` y el enlace `/t/…`, con botón para WhatsApp.
8. **Seguimiento**: "En camino", después "Entregado". Se puede cancelar sólo antes de pagar.

## Quien recibe

1. Recibe el código o el enlace.
2. Sin cuenta: `/rastrear` o `/t/CP-XXXX-XXXX` muestra el estado y el monto que llega, sin datos privados del remitente ni la comisión.
3. Con cuenta del mismo celular o correo: `/recibidos` lista el envío. Si es Lightning, puede cobrarlo desde ahí.
4. Comprobante: al completarse, aparece el comprobante imprimible.
5. "Dónde gastar" (`/donde-gastar`): lista de negocios de BTC Map, con la aclaración de que no son aliados.

## Casos que el recorrido debe cubrir

- Cancelar antes de pagar.
- Cotización vencida: se pide una nueva.
- Factura pagada tarde o de más: queda para devolver.
- Cobro vencido: el dinero vuelve a quien envió.
- Envío fallido: se muestra el motivo.

## Fricciones observadas en el recorrido local (2026-11-01)

- Después de pagar con una billetera externa, la página del remitente no se actualiza sola hasta que se vuelve a tocar el botón (límite conocido).
- El desglose tributario usa códigos del formulario de Hacienda ("05 · Transferencia y depósito bancario") que un usuario sin contexto no entiende.
