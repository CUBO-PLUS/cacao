# Marco Tributario, Custodia y Estrategia de Cumplimiento en El Salvador

Este documento consolida el análisis legal, contable, operativo y estratégico de **CacaoLedger** bajo la normativa salvadoreña consultada el 19 de octubre de 2026: Código Tributario (reformado por Decreto Legislativo N° 487, no verificado), Ley de Impuesto a la Transferencia de Bienes Muebles y a la Prestación de Servicios (Ley de IVA), Ley de Impuesto sobre la Renta (LISR), Ley Bitcoin (reformada por Decreto Legislativo N° 199 de enero de 2025), Resolución 1003 del CVPCPA, Ley de Emisión de Activos Digitales (CNAD) y lineamientos técnicos de la Dirección General de Impuestos Internos (DGII · Ministerio de Hacienda).

---

## 1. Marco regulatorio y límite frente a la CNAD y la Ley Bitcoin (§4.1)

### 1.1 Naturaleza no custodial de CacaoLedger
CacaoLedger es software de punto de venta, facturación electrónica y libros auxiliares de IVA. En ningún punto del flujo recibe, retiene, convierte ni transfiere fondos de terceros:

1. **Pagos en efectivo (`01`)**: el comercio recibe los dólares directamente en su caja.
2. **Pagos por Lightning (`11` / `99`)**: el pago entra directamente a la billetera de **Blink** perteneciente al propio comercio. Cuando el comercio configura una llave de API de Blink para verificar cobros o suscribir el webhook `receive.lightning`, el alcance de permisos exigido es exclusivamente de **lectura y recepción (`READ` y `RECEIVE`)**, nunca de envío (`WRITE`).
3. **Certificado de firma electrónica**: la llave privada del certificado de Hacienda permanece bajo control exclusivo del comercio contribuyente. Es una decisión de diseño. No pudimos recuperar el texto de MTIST 2.0 §6.4, así que no afirmamos que ese manual lo exija.

### 1.2 Exclusión del registro como PSAD ante la CNAD y como Proveedor de Servicios Bitcoin
- **Ley de Emisión de Activos Digitales (Comisión Nacional de Activos Digitales · CNAD)**: el registro de Proveedores de Servicios de Activos Digitales (PSAD) aplica a quienes realizan custodia, intercambio, transferencia o administración de activos digitales por cuenta de terceros. Al no tocar llaves de gasto ni fondos de clientes ni de comercios, CacaoLedger es un proveedor de software contable/tributario y **no constituye un PSAD**.
- **Ley Bitcoin (reformada por D.L. 199 de 29 de enero de 2025, vigente desde el 30 de abril de 2025)**: el Decreto 199 derogó el artículo 4 (y los artículos 8 y 9) y reformó el artículo 7, que dejó de obligar a aceptar bitcoin; la aceptación queda voluntaria en el sector privado. El dólar sigue como moneda de referencia (artículo 6, no reformado por el Decreto 199). CacaoLedger no realiza corretaje ni intermediación de Bitcoin, sino que documenta en `USD` y satoshis las ventas que el comercio decide cobrar voluntariamente por Lightning.

### 1.3 Qué cambiaría si CacaoLedger agregara liquidación agrupada o conversión en nombre del comercio
Si en el futuro CacaoLedger recibiera los satoshis de varios comercios en una billetera concentradora propia para luego liquidarles dólares en cuenta bancaria una vez por semana:
- Pasaría a actuar como custodio e intermediario financiero de activos digitales.
- Requeriría inscripción previa como **PSAD** ante la **CNAD**, programa de cumplimiento antilavado ante la **Unidad de Investigación Financiera (UIF)** de la Fiscalía General de la República y segregación patrimonial de cuentas. Por diseño arquitectónico, CacaoLedger evita ese modelo y mantiene la liquidación directa en la cuenta de Blink de cada comercio.

---

## 2. Arquitectura de custodia de certificados para múltiples comercios (§4.2)

**No verificado:** no pudimos recuperar el Manual Técnico de Integración del Sistema de Transmisión (MTIST 2.0, §6.4), el mismo punto que el caso de estudio deja abierto. Por prudencia diseñamos como si el certificado y la clave privada fueran del contribuyente emisor, sin que un tercero multiinquilino los retenga. Confirmar ese texto sigue pendiente.

CacaoLedger ofrece tres modalidades de despliegue para una cooperativa o red de comercios (como los puestos de CacaoMarket), detalladas técnicamente en [`docs/firma-y-comercios.md`](./firma-y-comercios.md):

| Modalidad | Quién guarda la llave privada | Cómo se firma el DTE | Cumplimiento MTIST 2.0 §6.4 |
|---|---|---|---|
| **A. Firmador local en el comercio (recomendada)** | El dispositivo o servidor local del comercio | CacaoLedger genera el JSON del DTE y el firmador local del comercio produce el JWS (`RS512`) sin que la llave salga del local | Cumple de forma estricta |
| **B. Contenedor dedicado por comercio (`svfe-api-firmador`)** | Instancia aislada del comercio con volumen cifrado propio | Cada comercio opera su propio contenedor oficial del Ministerio de Hacienda y su credencial de API (`MH_API_TOKEN`) | Cumple con aislamiento por contribuyente |
| **C. Bóveda HSM con llave envuelta por comercio** | Clave maestra controlada por la contraseña del cajero en turno | La llave privada se desencripta solo en memoria durante el milisegundo de firma con autorización del emisor | Requiere contrato de encargo de procesamiento sin cesión de custodia |

### Flujo de contingencia (Fuerza Mayor · Art. 119-F CT)
Cuando el servicio de recepción del Ministerio de Hacienda o la conexión a internet del comercio presenta caída:
1. El cobro se registra de inmediato como ticket `pagado` y se genera la atestación de tasa en `atestaciones.jsonl`.
2. El documento se construye con `tipoModelo = 2` (Modelo Diferido) y `tipoTransmision = 2` (Transmisión por Contingencia), registrando el motivo, fecha y hora de inicio y fin de la contingencia en el Evento de Contingencia.
3. El comercio cuenta con **24 horas** (plazo no verificado) desde el restablecimiento del servicio para transmitir el evento de contingencia y los DTE diferidos y obtener el `selloRecepcion`. CacaoLedger visibiliza ese reloj en el grupo **"Con plazo de 24 horas corriendo"** del cierre diario.

---

## 3. Economía unitaria, precios y retorno frente al riesgo de multa (§4.3)

### 3.1 Exposición sancionatoria de un comercio pequeño (Art. 239-A CT)
Con el salario mínimo del sector comercio y servicios de **`$408.80` mensuales**, vigente desde el 1 de junio de 2025; no se halló reforma posterior a la fecha de revisión (19 de octubre de 2026):
- **Una sola venta omitida** (no emitir el DTE, Art. 239-A lit. a): multa del 50 % del monto de la operación por documento, con piso de **2 salarios mínimos = `$817.60`**.
- **Un DTE emitido sin cumplir el Art. 119-G, o transmitido sin cumplir requisitos, estructura o reglas de sello** (Art. 239-A lit. b): multa del 30 % con piso de **2 salarios mínimos = `$817.60`**.
- **Un DTE no transmitido a la plataforma de Hacienda** (Art. 239-A lit. c): multa del 100 % del monto de cada operación, con piso de **9 salarios mínimos = `$3,679.20`**.
- **Un evento de contingencia o una invalidación no transmitidos, o transmitidos fuera de plazo** (Art. 239-A lit. d): 9 salarios mínimos mensuales, cantidad fija (`$3,679.20`).
- **Atraso mayor a 15 días calendario en Libros de IVA** (Art. 242 CT, numeral 1, subnumeral 2): multa en colones según el texto de 2015 (4,970 colones, más 490 colones por cada día de atraso, con tope de nueve salarios mínimos); moneda aplicable no verificada.

Para una cafetería, tostador o puesto en CacaoMarket con ticket promedio de `$4.52`, una sola multa por un DTE no transmitido (piso de 9 salarios mínimos, `$3,679.20`) equivale a **814 ventas brutas completas**.

### 3.2 Costo de infraestructura y estructura de precios de CacaoLedger
Al operar sobre archivos JSON/JSONL deterministas, validación local Ajv y generación estática sin bases de datos pesadas:
- **Costo marginal de infraestructura por comercio**: menos de `$1.50 / mes` (cómputo ligero, almacenamiento de DTE por 10 años (Art. 147 CT, no verificado) y monitoreo de plazos de 24 horas).
- **Planes propuestos**:
  1. **Comercio Semilla (`$9.00 / mes` + IVA)**: hasta 300 DTE mensuales (`01` y `03`), cierre diario con alerta de huérfanos y plazos de 24 horas, cadena de atestación de tasa BTC/USD y generación automática de Libros de IVA y Anexos 1 y 2 para F-07 y F-14 v17.
  2. **Comercio Cosecha (`$24.00 / mes` + IVA)**: hasta 2,500 DTE mensuales, múltiples puntos de venta (`M001P001`, `M001P002`), importación automática de pedidos de CacaoMarket y exportación directa para despacho contable.
  3. **Despacho Contable (`$65.00 / mes` + IVA)**: consola multi-NRC para contadores que atienden hasta 15 comercios, descargando en un clic los 4 CSV mensuales de cada cliente antes del día 10 hábil.
- **Punto de equilibrio**: con 120 comercios en el plan Semilla/Cosecha y 15 despachos contables, el ingreso recurrente mensual supera los `$2,500.00` con margen bruto superior al 85 %. Para el comercio, un año completo del plan Semilla (`$108.00`) cuesta **34 veces menos** que el piso de 9 salarios mínimos del Art. 239-A lit. c (`$3,679.20`).

---

## 4. Consulta formal vinculante ante la DGII · Art. 26 del Código Tributario (no verificado) (§4.4)

A continuación se presenta el texto íntegro de la consulta vinculante redactada conforme a los requisitos del **Artículo 26 del Código Tributario de El Salvador (no verificado)**, lista para ser suscrita por el representante legal del contribuyente ante la Dirección General de Impuestos Internos:

---

**SEÑOR DIRECTOR GENERAL DE IMPUESTOS INTERNOS**
**MINISTERIO DE HACIENDA**
**PRESENTE.**

Yo, **[NOMBRE DEL REPRESENTANTE LEGAL]**, mayor de edad, **[profesión u oficio]**, del domicilio de San Salvador, departamento de San Salvador, portador de mi Documento Único de Identidad número **[00000000-0]**, actuando en nombre y representación en mi calidad de Administrador Único Propietario y Representante Legal de la sociedad **CACAO DE EL SALVADOR, SOCIEDAD ANÓNIMA DE CAPITAL VARIABLE**, que puede abreviarse **CACAO DE EL SALVADOR, S.A. DE C.V.**, con Número de Identificación Tributaria (NIT) **[0614-120826-104-9]** y Número de Registro de Contribuyente (NRC) **[314820-7]**, señalando para oír notificaciones la dirección ubicada en Colonia Escalón, San Salvador Centro, departamento de San Salvador, y el buzón electrónico registrado en el Sistema de Notificación Electrónica del Ministerio de Hacienda; con el debido respeto y con fundamento en los **Artículos 26 (no verificado), 119-A (no verificado), 119-B, 119-C, 119-G y 141 (no verificado) del Código Tributario**, formulo **CONSULTA VINCULANTE** sobre la aplicación de las normas tributarias y los esquemas técnicos de Documentos Tributarios Electrónicos (DTE) a las operaciones de venta cobradas mediante la red Lightning de Bitcoin, con base en los hechos y consideraciones siguientes:

### I. EXPOSICIÓN DE LOS HECHOS Y OPERACIÓN TÉCNICA
1. Mi representada desarrolla actividades comerciales gravadas con el Impuesto a la Transferencia de Bienes Muebles y a la Prestación de Servicios (IVA) al trece por ciento (`13 %`), emitiendo **Facturas de Consumidor Final (`tipoDte = "01"`)** y **Comprobantes de Crédito Fiscal (`tipoDte = "03"`)** en dólares de los Estados Unidos de América (`USD`).
2. En el marco de la aceptación voluntaria de Bitcoin en el sector privado (Ley Bitcoin reformada por Decreto Legislativo N° 199 de enero de 2025), mi representada recibe cobros instantáneos en satoshis a través del protocolo Lightning, liquidados al instante del pago contra el monto facturado en `USD`.
3. Por cada cobro recibido por Lightning, nuestro sistema de facturación (**CacaoLedger**) registra en una cadena de auditoría inmutable (`atestaciones.jsonl`) la cantidad exacta de satoshis recibidos, el monto en `USD`, la tasa de conversión `USD/BTC` vigente en el segundo del cobro, la fuente de cotización y el identificador criptográfico de la transacción (`paymentHash`). La **Resolución N° 1003 del Consejo de Vigilancia de la Profesión de Contaduría Pública y Auditoría (CVPCPA)**, vigente desde el 7 de septiembre de 2021, mide el bitcoin a costo de adquisición con el tipo de cambio de referencia al dólar de los mercados internacionales indicado en la billetera utilizada.

### II. PUNTOS OBJETO DE CONSULTA Y CRITERIO DEL CONTRIBUYENTE

**PRIMERA PREGUNTA: Código del Catálogo `CAT-017` (Forma de Pago) en Factura Electrónica (`01`) frente a Comprobante de Crédito Fiscal (`03`).**
- **Antecedente técnico**: El catálogo oficial `CAT-017` incluye el código `"11"` para *Bitcoin* y el código `"99"` para *Otros (se debe indicar el medio de pago)*. Sin embargo, en el esquema JSON de validación de la Factura Electrónica v1 (`fe-fc-v1.json`, ruta `resumen.pagos[].codigo`), la expresión regular publicada en diversas versiones del validador (`^0[1-9]||1[0-4]||99$`) admite `"99"` pero omite o presenta ambigüedad sobre `"11"`, mientras que en el esquema del Comprobante de Crédito Fiscal v3 (`fe-ccf-v3.json`) admite expresamente `"11"`.
- **Criterio del contribuyente y consulta**: Se consulta si, mientras el validador de recepción de `tipoDte = "01"` rechace o restrinja el código `"11"`, es plenamente válido consignar en `resumen.pagos[0].codigo` el valor `"99"` acompañado en `resumen.pagos[0].referencia` de la cadena estructurada `BTC-LN|<satoshis>sat|<tasa_USD_BTC>|<hash12>`, y consignar `"11"` en `tipoDte = "03"` (o en ambos documentos cuando el validador de recepción admita `"11"`), sin que ello configure incumplimiento de lineamientos técnicos bajo el Artículo 239-A literal b) del Código Tributario.

**SEGUNDA PREGUNTA: Respaldo documental de la tasa de conversión `USD/BTC` en el DTE y en los Libros de IVA.**
- **Antecedente técnico**: Todos los campos monetarios del DTE (`ventaGravada`, `totalIva`, `montoTotalOperacion`, `totalPagar`) exigen valores en `USD` con precisión de dos decimales (`multipleOf: 0.01`) y `tipoMoneda: "USD"`. El esquema JSON no posee un campo dedicado para satoshis ni para la tasa `USD/BTC`.
- **Criterio del contribuyente y consulta**: Se consulta si consignar la referencia `BTC-LN|<satoshis>sat|<tasa_USD_BTC>|<hash12>` dentro de los 50 caracteres de `resumen.pagos[0].referencia`, complementada con el libro auxiliar electrónico de atestaciones encadenadas con `SHA-256` a disposición de la Administración Tributaria, satisface íntegramente los requisitos de control y registro de los Artículos 119-B, 139 y 141 (no verificado) del Código Tributario.

**TERCERA PREGUNTA: Cómputo del plazo de 24 horas en Rechazo de Recepción y Evento de Contingencia (Artículos 119-F y 119-G del Código Tributario).**
- **Antecedente legal**: Según el contribuyente, la normativa técnica de DTE otorga un plazo de veinticuatro horas (no verificado) para subsanar y retransmitir un documento rechazado por el sistema de recepción o para transmitir los DTE emitidos bajo Modelo de Facturación Diferido (`tipoModelo = 2`) tras un evento de contingencia.
- **Criterio del contribuyente y consulta**: Se solicita confirmar si dicho plazo de veinticuatro horas se computa como veinticuatro horas reloj continuas a partir del acuse de rechazo o del restablecimiento del servicio, independientemente de que transcurra en fin de semana o día de asueto nacional, y confirmar el procedimiento aplicable cuando el consumidor final de una Factura `01` cobrada al contado ya se retiró del establecimiento y no proporcionó correo electrónico al momento de la subsanación.

**CUARTA PREGUNTA: Vigencia de los códigos del Catálogo `CAT-013` (Municipios) tras la Ley Especial para la Reestructuración Municipal (Decreto Legislativo N° 762).**
- **Antecedente legal y técnico**: El Decreto Legislativo N° 762 redujo los 262 municipios a 44 municipios a partir del 1 de mayo de 2024. En versiones previas del esquema JSON, las reglas condicionales `allOf` por departamento validan únicamente la numeración histórica (`01` a `22` en La Libertad, `01` a `19` en San Salvador), mientras que el catálogo actualizado asigna los códigos de los nuevos municipios agrupados (`23` a `28` en La Libertad, `20` a `24` en San Salvador).
- **Criterio del contribuyente y consulta**: Se solicita confirmar qué tabla de códigos `CAT-013` exige actualmente el validador de producción para cada versión de esquema (`v1` de Factura y `v3` de CCF) y confirmar que el uso del código aceptado por el esquema JSON vigente del Ministerio de Hacienda junto con la denominación del distrito en `complemento` cumple con los requisitos de dirección del emisor y del receptor.

### III. PETITORIO
Por todo lo anteriormente expuesto, con fundamento en el Artículo 26 del Código Tributario (no verificado), a Usted respetuosamente **PIDO**:
1. Me admita el presente escrito de Consulta Vinculante.
2. Emita respuesta escrita pronunciándose sobre los cuatro puntos técnicos planteados, a efecto de aplicar con plena certeza jurídica los criterios de esta Dirección General en la emisión y declaración de nuestros Documentos Tributarios Electrónicos.

San Salvador, diecinueve de octubre de dos mil veintiséis.
