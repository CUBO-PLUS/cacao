# Guion de la demo (3 minutos)

Guion para presentar el grupo Cacao en tres minutos. Cada bloque dice qué abrir, qué tocar y qué decir, en ese orden. Los tiempos son aproximados.

## Antes de empezar

- Tené encendido el BTCPay de regtest y el túnel activo. Sin BTCPay, la factura no aparece y el paso 2 no se puede hacer.
- Abrí tres pestañas: `https://cacao-grupo.vercel.app`, `https://cacao-media.vercel.app` y `https://cacao-cuentas.vercel.app`.
- Probá el recorrido una vez antes de presentar. Si algo no responde, no improvises: decí que es una demo y seguí con el paso 3.

## 0:00 a 0:25 · La puerta

**Abrí:** `https://cacao-grupo.vercel.app`

**Tocá:** nada todavía. Dejá que se vea la portada.

**Decí:** "Esto es Cacao: la empresa y la plataforma. Desde acá se entra a cinco productos hechos en El Salvador. Media, Travel y Market están del lado de lo público; Pay y Ledger, del lado del dinero. Todo lo que ven es una demostración."

## 0:25 a 1:05 · Comprar una historia en Media

**Abrí:** `https://cacao-media.vercel.app/historias/ataco-y-sus-murales/`, una historia de pago (la que tiene el muro al final).

**Tocá:** "Desbloquear por 120 sats".

**Decí:** "Las historias sin experiencia en Travel cuestan 120 sats. Las vinculadas son gratis, porque la venta viene de la reserva. No hay suscripción: pagás una historia y listo. El pago es una factura Lightning, que genera BTCPay."

## 1:05 a 1:45 · Pagar con la billetera de prueba

**Tocá:** "Pagar con la billetera de prueba" en la pantalla de pago.

**Decí:** "Esta billetera es de prueba. Es bitcoin de regtest: no tiene valor y no se mueve dinero real. Lo que ven es el mismo flujo que tendría un pago de verdad."

**Esperá:** la pantalla pasa a "Pago recibido" y la historia se abre sin mover la página.

## 1:45 a 2:25 · La venta en Ledger

**Abrí:** `https://cacao-cuentas.vercel.app`

**Tocá:** la venta que acabás de hacer en la lista. Abrí su ticket.

**Decí:** "La venta queda registrada en Ledger con su pago. Ahí se ve el monto, la fecha y el pago de Lightning que la liquidó. Desde acá se arma su factura electrónica, que en la demo es simulada."

## 2:25 a 2:50 · Lo que es simulado

**Abrí:** `https://cacao-grupo.vercel.app/legal`

**Tocá:** nada. Señalá el aviso de arriba.

**Decí:** "Esto es una demostración. Los pagos usan bitcoin de prueba sin valor, y los sellos de Hacienda son simulados: no son documentos oficiales. Los datos que guardamos, por qué los guardamos y cómo pedir que se borren están en esta página."

## 2:50 a 3:00 · Cierre

**Decí:** "Cinco productos, un mismo pago por Lightning, y todo se puede probar hoy. Si quieren ver el código o hablar de una versión real, escríbannos a hola@cacaomedia.sv."

## Si algo falla

- **La factura no aparece:** BTCPay está apagado o el túnel se cortó. Decí que es una demo y mostrá el ticket de Ledger ya generado.
- **La venta no aparece en Ledger:** no improvises. Mostrá una venta de ejemplo de la lista y seguí con la página legal.
- **La historia no se abre después de pagar:** esperá unos segundos y recargá la página. Si sigue cerrada, pasá al paso 3.
