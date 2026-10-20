# Arquitectura Técnica y Camino a Bitcoin y Lightning

Este documento describe la arquitectura interna de **CacaoPay**, su modelo de datos y aritmética exacta, y el diseño técnico para conectar el simulador a infraestructura real de Bitcoin y Lightning Network en producción junto con **CacaoLedger**.

## 1. Arquitectura en capas y modelo de seguridad

```
Navegador (Client Components: Cotizador, AsistenteEnvio, SeguimientoEnCamino)
   │
   ▼  Server Actions ('use server') y Server Components
Capa de servidor (src/servidor/: tasas.ts, transferencias.ts, monitor.ts, cuentas.ts, sesion.ts)
   │  Valida sesión con Clerk (`auth()`) y verifica reglas de negocio
   ▼  Llamada RPC con SUPABASE_SERVICE_ROLE_KEY
PostgreSQL en Supabase (pay_crear_transferencia, pay_procesar, pay_completar, pay_fallar, pay_cancelar)
   │  Bloqueo pesimista (FOR UPDATE), recálculo entero (_pay_calcular), historial y auditoría
   ▼
Tablas con RLS estricto (pay_transferencias, pay_historial, pay_tarifas, pay_tasas, eventos, auditoria)
```

### Decisiones clave de seguridad

1. **Cero acceso directo desde el navegador**: `anon` y `authenticated` tienen todos los permisos revocados sobre `pay_transferencias`, `pay_historial`, `pay_tarifas` y `pay_tasas`. Ningún cliente puede leer transferencias ajenas ni modificar estados desde la consola del navegador.
2. **Doble validación del cálculo**: cuando el remitente confirma un envío, `crearEnvio` ignora cualquier comisión, tasa o monto recibido que provenga del formulario, vuelve a cotizar en el servidor (`cotizarEnServidor`), y la función SQL `pay_crear_transferencia` vuelve a ejecutar `_pay_calcular`. Si hay un solo centavo o satoshi de diferencia, la transacción se rechaza con `DATOS_INVALIDOS`.
3. **Idempotencia contra doble toque**: cada instancia del formulario de confirmación genera una `clave` única. La restricción `unique (remitente_id, clave_idempotencia)` y el bloqueo `perform 1 from public.usuarios where id = p_remitente for update` garantizan que dos envíos simultáneos con la misma clave devuelvan la misma transferencia.
4. **Privacidad en el rastreo público**: la vista `/t/[codigo]` usa una proyección dedicada (`COLUMNAS_RASTREO`) que jamás lee el nombre del remitente, el teléfono o correo del destinatario, la comisión pagada ni la nota privada.

## 2. Motor de conversión y aritmética entera

Todo el dinero se almacena y opera en enteros para evitar errores de punto flotante:
- Moneda de origen (`USD` o `EUR`): centavos enteros (`monto_origen_centavos`, `comision_centavos`, `neto_centavos`).
- Moneda de destino: centavos enteros cuando `moneda_destino = 'USD'`, o satoshis enteros cuando `moneda_destino = 'SATS'`.
- Tasas de cambio (`tasa`): escaladas a 8 decimales (`numeric(18,8)` en PostgreSQL y `BigInt(Math.round(tasa * 100_000_000))` en TypeScript).

### Fórmulas exactas (`src/lib/cotizacion.ts` y `_pay_calcular`)

1. **Comisión redondeada hacia arriba** (el servicio nunca cobra una fracción de centavo de menos):
   ```
   comision = fijo_centavos + floor((monto_origen_centavos * porcentaje_bps + 9999) / 10000)
   neto     = monto_origen_centavos - comision
   ```
2. **Tasa de conversión a 8 decimales**:
   - `USD → USD`: `tasa = 1`
   - `EUR → USD`: `tasa = eur_usd` (leída de `pay_tasas`)
   - `USD → SATS`: `tasa = 100_000_000 / usd_btc` (satoshis por `1.00 USD`)
   - `EUR → SATS`: `tasa = eur_usd * (100_000_000 / usd_btc)` (satoshis por `1.00 EUR`)
3. **Monto recibido redondeado hacia abajo** (`floor` mediante división entera en `BigInt`, de modo que nunca se promete un centavo o satoshi por encima del valor neto convertido):
   - Destino en `USD`: `monto_destino = (neto * tasa_8) / 100_000_000`
   - Destino en `SATS`: `monto_destino = (neto * tasa_8) / (100 * 100_000_000)`

## 3. Oráculo de precio BTC/USD (`src/lib/precio/fuente.ts`)

- Consulta en paralelo el precio spot de **Coinbase** (`BTC-USD`) y el último cierre de **Kraken** (`XBTUSD`), con un tiempo límite de 4 segundos por petición.
- Si ambas fuentes responden y la discrepancia entre ellas supera el **2%** respecto del valor menor, el oráculo rechaza la cotización (`SIN_COTIZACION`) para proteger a las partes de precios anómalos.
- Cuando ambas están dentro del margen del 2%, usa el promedio redondeado a centavos y lo guarda en caché en memoria durante 60 segundos.
- Si `PRECIO_FIJO_USD_BTC` está definido con un número positivo (entornos sin red y pruebas automatizadas), usa ese valor fijo.

## 4. Camino de integración con Bitcoin y Lightning en producción

El simulador ya conserva la estructura de estados (`creada` → `procesando` → `completada` / `fallida` / `cancelada`), las tasas con marca de tiempo y las validaciones del servidor que requiere un corredor real sobre Lightning. Para conectar pagos reales sin alterar las pantallas ni el contrato de las funciones actuales, la integración se divide en tres etapas:

### 4.1 Etapa 1: Cobro en origen (Funding)

Cuando el remitente pulsa **"Enviar ahora"** en `/envios/[id]` (transición de `creada` a `procesando`):
1. **Riel fiat (ACH, tarjeta con 3DS o SEPA en euros)**: se crea un `PaymentIntent` en el procesador de entrada con `metadata.transferencia_id = envio.id` y `idempotencyKey = envio.clave_idempotencia`.
2. **Riel Lightning de entrada (si el remitente fondea con Bitcoin)**: se solicita una factura BOLT11 a través de la API de **Blink** (`lnInvoiceCreateOnBehalfOfRecipient` o `lnUsdInvoiceCreate` con Stablesats en USD) por el monto exacto de la transferencia, almacenando el `paymentHash` y la fecha de expiración.
3. Al confirmarse el cobro mediante webhook firmado del proveedor (`payment_intent.succeeded` o `receive.lightning`), el servidor invoca `pay_procesar(envioId, actorId)` y la transferencia pasa a **"En camino" (`procesando`)**.

### 4.2 Etapa 2: Liquidación al destinatario en El Salvador (Payout)

Una vez que la transferencia entra en `procesando`, el despachador de pagos ejecuta la salida según `envio.entrega`:

1. **`entrega = 'lightning'` (Liquidación en satoshis)**:
   - El campo `destinatario_contacto` o la dirección Lightning configurada por el destinatario se resuelve mediante **LNURL-pay (LUD-06 / LUD-16)** para obtener una factura BOLT11 por exactamente `envio.monto_destino` satoshis.
   - El nodo o cuenta operativa en **Blink** / **LND** / **NWC** paga la factura verificando antes que:
     - el monto de la factura coincida exactamente con `envio.monto_destino` sats;
     - la comisión de enrutamiento de la red Lightning (`max_fee_sats`) no supere el presupuesto de ruta (por ejemplo `0.15%`).
   - Al recibir el `payment_preimage` criptográfico que demuestra la liquidación atómica en Lightning, el webhook o trabajador del servidor invoca `pay_completar(envioId, null)` y guarda el `payment_hash` en el detalle de `pay_historial`.
2. **`entrega = 'efectivo'` y `entrega = 'cuenta'` (Liquidación en dólares)**:
   - Si el fondeo viajó desde Europa o Estados Unidos por riel Lightning (conversión instantánea a saldo en USD mediante Stablesats de Blink o proveedor inscrito en el Registro de Proveedores de Bitcoin del BCR), el servidor ordena el desembolso local:
     - **Cuenta bancaria**: transferencia interbancaria local (**Transfer365 del BCR**) a la cuenta del destinatario en dólares (`envio.monto_destino` centavos).
     - **Efectivo**: generación de orden de retiro en red de corresponsales locales contra presentación del **DUI** y del código `CP-XXXX-XXXX`.
   - Cuando el corresponsal o Transfer365 confirma la acreditación, el servidor llama a `pay_completar`; si la cuenta destino está cerrada o rechazada, llama a `pay_fallar` con el motivo devuelto por el banco.

### 4.3 Etapa 3: Facturación electrónica (DTE) y atestación en CacaoLedger

Al pasar la transferencia a `completada`:
1. El evento de liquidación exporta hacia **CacaoLedger** un registro con la comisión cobrada (`comision_centavos` convertida a USD), la tasa `USD/BTC` aplicada, la cantidad de satoshis y el `paymentHash`.
2. **CacaoLedger** construye la **Factura Electrónica (`tipoDte = "01"`)** por la comisión del servicio (con el 13% de IVA desglosado en `resumen.totalIva`), encadena la atestación de tasa en `atestaciones.jsonl` (registro local; su valor probatorio ante Hacienda no está confirmado), firma el documento con JWS (`RS512`) y lo incluye en el cierre diario y en los **Anexos 1 y 2 del Formulario F-07** y el **Formulario F-14 v17** (1.75% de Pago a Cuenta).

## 5. Pago Lightning con BTCPay Server (implementado)

Cuando el servidor tiene `BTCPAY_URL`, `BTCPAY_API_KEY` y `BTCPAY_STORE_ID`, el remitente paga el envío completo (`monto_origen`) con una factura Lightning de BTCPay. En la demostración BTCPay corre en regtest y las facturas no tienen valor. Sin esas variables, "Enviar ahora" funciona como antes.

- **Monto en sats**: `sats = ceil(usd_centavos * 1e6 / cotizacion)`, con la cotización de `src/lib/precio/fuente.ts`. Los euros pasan a dólares con la tasa EUR/USD de `pay_tasas`. Lo calcula `satsParaFactura` (`src/lib/lightning.ts`).
- **Factura**: `crearFactura` (cliente de `infra/btcpay/btcpay.ts`, copiado sin cambios en `src/servidor/btcpay.ts`) crea una factura de 15 minutos solo con `BTC-LN`. La factura se guarda en `pay_transferencias` con `pay_registrar_factura`. Mientras esté vigente, el remitente recibe la misma.
- **Confirmación**: el envío pasa a `procesando` solo cuando BTCPay responde `Settled` (`leerFactura`). La página pregunta cada 3 segundos mientras la pestaña está visible. El webhook `POST /api/pagos/btcpay/` (firma `BTCPay-Sig` con `BTCPAY_WEBHOOK_SECRET`) solo pide volver a mirar: su cuerpo nunca cuenta como pago. La transición la hace `pay_confirmar_btcpay`, que es idempotente.
- **Lo que no cambia**: completar (`pay_completar`) y fallar siguen en manos del administrador o del simulador. Con BTCPay activo, el remitente no puede llamar `pay_procesar` por su cuenta.
- **Pendiente**: si llega un pago a una factura ya reemplazada o de un envío cancelado, no se devuelve ni se marca. Hay que revisarlo a mano en BTCPay.

## 6. Cobro del destinatario por Lightning (implementado)

En un envío `entrega = 'lightning'`, el destinatario cobra con un enlace, sin cuenta. El envío no pasa a entregado porque lo dice quien lo mandó ni el administrador: lo pasa el cobro.

- **Enlace**: al crear el envío, un disparador de la base le asigna `cobro_token` (32 bytes aleatorios en base64url). El remitente lo comparte desde `/envios/[id]` como `/cobrar/<token>`. Quien tiene el enlace puede cobrar: el enlace es la única llave. Por eso no aparece en `/t/[codigo]` ni en ninguna vista de destinatario.
- **Factura**: el destinatario pega una factura Lightning por exactamente `monto_destino` sats. `satsDeFactura` (`src/servidor/cobro.ts`) lee el monto de la parte legible del BOLT11 y rechaza montos sin valor o con fracción de sat. La base vuelve a comparar el monto (`pay_iniciar_cobro`).
- **Pago**: `pay_iniciar_cobro` pone el cobro en `pagando` (solo uno a la vez) y el servidor paga la factura con la API Pay de BTCPay (`src/servidor/btcpay-pagos.ts`). Un `Complete` cierra el cobro con `pay_terminar_cobro`, que mueve el envío a `completada` y guarda el hash. Un rechazo de BTCPay (400 o 422) deja el cobro en `fallido` con un motivo, y el destinatario puede pedir otra factura. Una respuesta `Pending`, o un error de red, deja el cobro en `pagando`: `estadoDeCobro` pregunta a BTCPay por el hash de la factura hasta tener respuesta.
- **Lo que no cambia**: el administrador no puede completar un envío por Lightning a mano (`simularCompletar` lo rechaza), y el remitente lo sigue pagando con su propia factura de BTCPay.
- **Demostración**: BTCPay corre en regtest. La página de cobro enlaza la billetera de prueba (`/billetera/recibir?sats=N`) para quien no tiene una billetera Lightning.
