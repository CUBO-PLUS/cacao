# Marco Tributario, de Hacienda (DGII), del BCR y Estrategia de Remesas en El Salvador

Este documento detalla el tratamiento tributario, contable y regulatorio aplicable a **CacaoPay** en El Salvador (revisión de octubre de 2026; los puntos no verificados están marcados como tales), su integración con **CacaoLedger** para la emisión de Documentos Tributarios Electrónicos (DTE) y declaraciones mensuales ante el Ministerio de Hacienda, así como el estudio estratégico del corredor de remesas hacia El Salvador.

## 1. Tratamiento tributario en El Salvador (DGII · Ministerio de Hacienda)

En una remesa familiar convergen dos flujos económicos distintos que este documento trata por separado: **el monto principal transferido al destinatario** (`neto_centavos` / `monto_destino`) y **el cobro por el servicio de transferencia** (`comision_centavos`).

### 1.1 El monto principal que recibe la familia: tratamiento en Renta e IVA

1. **Impuesto sobre la Renta (ISR · Decreto Legislativo N° 134)**:
   - El **artículo 3 numeral 4 de la Ley de Impuesto sobre la Renta (LISR)**, agregado por el Decreto 969 de 2024 (por confirmar), establece que no constituyen renta los valores obtenidos en el exterior. El alcance de esa norma para las remesas familiares no está confirmado.
   - El monto entregado al destinatario (`$96.51` en efectivo, `$98.01` en cuenta bancaria o su equivalente en satoshis por Lightning en un envío de `$100.00`) **no tiene confirmada** una exención del 100% de ISR ni una retención en la fuente de `0%`.
2. **Impuesto a la Transferencia de Bienes Muebles y a la Prestación de Servicios (IVA · Decreto Legislativo N° 296)**:
   - El tratamiento del principal de la remesa en el IVA no está verificado en esta revisión: el artículo 4 de la Ley de IVA y la tasa de `0%` no se confirmaron.
3. **Impuesto a las operaciones financieras**:
   - No verificado en esta revisión: no se confirmó si existe un impuesto al cheque o a las transferencias electrónicas, ni si el retiro en ventanilla o el depósito bancario tienen deducción tributaria.

### 1.2 El cobro por el servicio de remesa (`comision_centavos`)

El tratamiento fiscal de la comisión depende de dónde se origina y quién presta el servicio:

1. **Comisión cobrada por un operador o punto de pago domiciliado en El Salvador**:
   - **IVA del 13% incluido**: cuando se presta a consumidor final, el precio cobrado incluye el 13% de IVA (los artículos 47 y 54 de la Ley de IVA no están verificados en esta revisión). La base imponible sin IVA se calcula en centavos enteros como `round(comisionUsdCentavos * 100 / 113)` y el débito fiscal es `comisionUsdCentavos - baseSinIva`.
   - **Pago a cuenta de renta del 1.75% (Art. 151 CT, por confirmar)**: el contribuyente declara y entera un anticipo del `1.75%` sobre los ingresos brutos obtenidos por rama económica, en el **Formulario F-14 v17** (versión indicada en la lista de formularios de mh.gob.sv; vigencia por confirmar). Supuesto de cálculo: este documento aplica el 1.75% a los ingresos sin IVA; confirmalo con tu contador. La acreditación contra el Impuesto sobre la Renta anual (artículo 41 LISR y sus tasas) no está verificada en esta revisión.
2. **Comisión originada en el exterior o liquidada entre corresponsales**:
   - Si el servicio es cobrado íntegramente fuera de El Salvador por un transmisor extranjero y la entidad local factura una comisión de distribución o pago al transmisor no domiciliado, se analiza bajo las reglas de territorialidad y exportación de servicios (los artículos 16 y 74 de la Ley de IVA no están verificados en esta revisión) o, entre entidades contribuyentes locales, se documenta mediante **Comprobante de Crédito Fiscal (`tipoDte = "03"`)** separando el 13% de IVA.

### 1.3 Desglose tributario de referencia en un envío de `$100.00`

El módulo [`src/lib/hacienda.ts`](../src/lib/hacienda.ts) implementa este cálculo en centavos de dólar (dado que el artículo 139 del Código Tributario, sobre asientos en moneda de curso legal, y el artículo 6 de la Ley Bitcoin, que mantiene el dólar como moneda de referencia sin reforma del Decreto 199, sustentan llevar los registros en `USD`):

| Vía de entrega | Enviado | Recibe el destinatario (valores del exterior, Art. 3 num. 4 LISR; alcance no confirmado) | Comisión bruta (DTE 01) | Base gravada sin IVA | Débito fiscal IVA 13% | Pago a cuenta 1.75% (F-14 v17, Art. 151 CT, por confirmar) | Código `CAT-017` |
|---|---|---|---|---|---|---|---|
| **Efectivo en punto de pago** | `$100.00` | `$96.51` | `$3.49` | `$3.09` | `$0.40` | `$0.05` | `01` (Billetes y monedas) |
| **Depósito a cuenta bancaria** | `$100.00` | `$98.01` | `$1.99` | `$1.76` | `$0.23` | `$0.03` | `05` (Transferencia y depósito bancario) |
| **Bitcoin por Lightning** (`1 BTC = $100,000.00`) | `$100.00` | `99,500 sats` (`$99.50`) | `$0.50` | `$0.44` | `$0.06` | `$0.01` | `11` (Bitcoin) o `99` con referencia `BTC-LN` en `01` v1 |

La base sin IVA es un supuesto de cálculo: el texto del Art. 151 CT no la define. Las cifras de esta tabla ilustran el cálculo de `src/lib/hacienda.ts`.

## 2. Facturación electrónica (DTE), formularios F-07 y F-14 v17 y conexión con CacaoLedger

Dentro del grupo Cacao, **CacaoLedger** (`ledger/`) es el motor encargado de convertir cada cobro confirmado en su Documento Tributario Electrónico y en los libros y anexos mensuales del Ministerio de Hacienda:

1. **Emisión del DTE por la comisión del servicio (artículos 119-B, 119-C y 119-F del Código Tributario, por confirmar)**:
   - Por cada envío en estado `completada`, la comisión cobrada se documenta en dólares (`tipoMoneda: "USD"`) mediante **Factura Electrónica (`tipoDte = "01"`)** para consumidor final o **Comprobante de Crédito Fiscal (`tipoDte = "03"`)** para contribuyentes inscritos en IVA.
   - En los envíos liquidados por Lightning, el campo `resumen.pagos[0]` registra la forma de pago conforme a la generación de esquemas activa: código `"99"` con referencia `BTC-LN|<sats>sat|<tasa>|<hash>` en el esquema `01` v1 (donde el patrón del validador restringe `"11"`), o código `"11"` en CCF `03` y en Factura `01` v2, respaldado por la cadena de atestación SHA-256 (`atestaciones.jsonl`). La **Resolución 1003 del CVPCPA** (por confirmar), según la guía de esa institución, indica medir el bitcoin a costo de adquisición, con el tipo de cambio con referencia al dólar que establecen los mercados internacionales, indicado en la billetera que se utilice.
2. **Libros de IVA y anexos CSV del formulario F-07 (arts. 93-94 Ley de IVA, según la DGII, para el plazo)**:
   - Al cierre del mes, las facturas con sello de recepción se consolidan por día en el **Libro de Ventas a Consumidor Final** y en el **Anexo 2 de Consumidor Final del F-07** (plantilla de la DGII de 2021, con 23 columnas de la `A` a la `W`). No están confirmados el encabezado, el separador de punto y coma, que la plantilla sea la versión 14 del F-07 (publicada en mh.gob.sv, ago. 2025; vigencia por confirmar) ni los valores fijos de las columnas `R`, `S`, `U` y `V`.
   - Los comprobantes `03` se reportan uno por fila en el **Libro de Ventas a Contribuyentes** y en el **Anexo 1 de Contribuyentes del F-07** (plantilla de la DGII de 2021, con 20 columnas de la `A` a la `T`; el formato del archivo no está confirmado).
3. **Declaración mensual de Pago a Cuenta (Formulario F-14 v17 · Art. 151 CT)**:
   - La suma de bases gravadas sin IVA de las comisiones del mes alimenta la declaración de Pago a Cuenta al `1.75%`, que se presenta y paga en el plazo que indica el Art. 151 CT (pago a cuenta, por confirmar) en `declara.mh.gob.sv`.
4. **Exposición sancionatoria (artículo 239-A CT)**:
   - Las multas dependen del salario mínimo y del tipo de incumplimiento. Consultá el texto vigente antes de tomar decisiones.

## 3. Marco regulatorio del BCR, Ley Bitcoin (D.L. 199), CNAD y UIF

1. **Banco Central de Reserva (BCR · Norma Técnica `NRP-19`)**:
   - La `NRP-19` regula a las entidades que envían o reciben dinero mediante subagentes. La obligación de reportar al BCR las estadísticas de volumen, operaciones, departamento de destino, canal de pago y país de origen no está verificada en esta revisión.
   - Para el cobro en efectivo en puntos de pago, el destinatario presenta su **Documento Único de Identidad (DUI)** vigente (o pasaporte/carné de residente para personas extranjeras).
2. **Prevención de Lavado de Dinero y de Activos (LCLDA e Instructivo de la UIF · Fiscalía General de la República)**:
   - **Límites por operación**: CacaoPay acota cada transferencia entre **`$1.00` y `$3,000.00`** (o `€1.00` a `€3,000.00`), es un límite propio del simulador; no se verificó un tope legal.
   - **Identificación y trazabilidad**: quien envía debe contar con sesión verificada por teléfono o correo electrónico, y toda transición de estado queda registrada en `pay_historial` y en la tabla `auditoria` con marca de tiempo y actor.
   - **Umbrales de reporte**: en operación real, la LCLDA exige reportar a la Unidad de Investigación Financiera (UIF) las operaciones que alcancen umbrales o sean sospechosas. Los montos, incluido el de `$10,000.00` en efectivo, no están verificados en esta revisión.
3. **Ley Bitcoin (reformada por Decreto Legislativo N° 199, enero de 2025), BCR `NRP-29` y CNAD**:
   - Desde la reforma de 2025 (**Decreto Legislativo N° 199**) aceptar bitcoin es voluntario. El dólar de los Estados Unidos (`USD`) sigue como moneda de referencia según el artículo 6 de la Ley Bitcoin, que el Decreto 199 no reformó.
   - En la versión actual de demostración, CacaoPay es un **simulador educativo no custodial** que no recibe, retiene ni convierte dinero ni satoshis reales.
   - Para operar con fondos reales convirtiendo dólares o euros a satoshis y liquidando pagos a terceros en El Salvador, el operador debe contar con inscripción en el **Registro de Proveedores de Bitcoin del Banco Central de Reserva** (artículo 10 de la `NRP-29`, por confirmar) y/o licencia de **Proveedor de Servicios de Activos Digitales (PSAD)** ante la **Comisión Nacional de Activos Digitales (CNAD)** (PSAD y CNAD no verificados en esta revisión), además de las licencias de transmisor de dinero (*Money Transmitter License*) en las jurisdicciones de origen, o bien operar como interfaz sobre un proveedor licenciado que ejecute la custodia y liquidación.

## 4. Entregable estratégico del corredor de remesas hacia El Salvador

### 4.1 Magnitud del mercado (datos verificados del BCR)

| Indicador | Cifra de referencia | Fuente |
|---|---|---|
| Remesas recibidas en 2023 | `8,181.8 millones` (USD) | Nota del BCR, enero de 2024 |
| Parte de esas remesas en bitcoin, 2023 | `82.9 millones` | Nota del BCR, enero de 2024 |

Otras cifras de mercado (remesas de 2024, participación por corredor, hogares y costos de envío) no se verificaron en esta revisión y no se usan en esta guía.

### 4.2 Análisis comparativo de comisiones y tiempos (envío de `$100.00` y `$200.00`)

| Proveedor / Vía | Estructura de comisión | Costo en `$100.00` | Costo en `$200.00` | Tiempo estimado | Transparencia cambiaria |
|---|---|---|---|---|---|
| **CacaoPay · Lightning** | `$0.00` fijo + `0.50%` (50 bps) | `$0.50` (`0.50%`) | `$1.00` (`0.50%`) | ~1 minuto | Tasa spot Coinbase y Kraken explícita, separada de la comisión |
| **CacaoPay · Cuenta bancaria** | `$0.99` fijo + `1.00%` (100 bps) | `$1.99` (`1.99%`) | `$2.99` (`1.50%`) | ~60 minutos | `1 USD = 1 USD` o tasa `EUR/USD` separada de la comisión |
| **CacaoPay · Efectivo** | `$1.99` fijo + `1.50%` (150 bps) | `$3.49` (`3.49%`) | `$4.99` (`2.50%`) | ~30 minutos | Comisión separada; retiro con DUI en punto de pago |

Remitly y Western Union no se comparan en esta tabla: sus comisiones no se verificaron en esta revisión.

### 4.3 Perfiles de personas usuarias

1. **Remitente en Estados Unidos ("Lucía en Maryland")**: envía entre `$100.00` y `$400.00` cada quincena para gastos del hogar. Necesita saber antes de pagar cuánto llega exactamente, sin cargos ocultos, y mandar el código `CP-XXXX-XXXX` por mensaje a su familia.
2. **Remitente en Europa ("Diego en Madrid o Milán")**: envía euros (`EUR`). Necesita ver la tasa `EUR/USD` separada de la comisión antes de confirmar.
3. **Destinataria en El Salvador ("Doña Rosa en San Miguel")**: consulta el estado del envío desde su celular con el código público `/t/CP-XXXX-XXXX` sin necesidad de crear cuenta ni ver datos internos del remitente, y sabe si debe llevar su DUI al punto de pago o esperar el abono en su cuenta o billetera Lightning.

### 4.4 Marco de indicadores (KPIs) en `/monitor`

| Indicador | Fórmula en CacaoPay | Fuente en base de datos | Meta operativa |
|---|---|---|---|
| **Conversión del cotizador al envío** | `creo_envio / vio_cotizacion` | Función RPC `embudo('pay', desde, hasta)` | `> 60%` |
| **Tasa de entrega efectiva** | `completada / total_creadas` | Función RPC `pay_resumen(desde, hasta)` | `> 85%` |
| **Abandono o fallo post-creación** | `(cancelada + fallida) / total_creadas` | Función RPC `pay_resumen(desde, hasta)` | `< 10%` |
| **Ticket promedio enviado (USD)** | `monto_origen_usd_centavos / cantidad` | Función RPC `pay_resumen(desde, hasta)` | `$150.00` a `$400.00` |
| **Recaudación e impuestos por período** | Base sin IVA (supuesto de cálculo), Débito IVA 13% y Pago a Cuenta 1.75% | `desglosarComisionUsd` en `/monitor` | Cuadratura del 100% con F-07 y F-14 |
