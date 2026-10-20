# CacaoLedger

CacaoLedger toma una venta pagada y produce el documento tributario electrónico (DTE) de El Salvador:
factura 01 para consumidor final o comprobante de crédito fiscal 03 para contribuyente. Registra
cómo se pagó cada venta, guarda en una cadena de registros lo que el DTE no puede contener (como la
tasa de un pago en bitcoin), cierra el día, produce los libros de IVA del mes y publica un sitio
estático del cierre.

Es parte del grupo Cacao (CacaoMedia, CacaoTravel, CacaoMarket, CacaoPay). Una orden pagada de
CacaoMarket puede convertirse en ticket con `importar market`, a partir de un archivo exportado. Producir
ese archivo desde la base de datos de CacaoMarket es un paso aparte, que todavía no existe.

## Requisitos y arranque

Necesitás Node 24. La CLI corre TypeScript directamente; la aplicación web usa Next.js 16 (`npm install` lo baja).

```
npm install
npm test
npm run demo
```

`npm install` baja `ajv`, `ajv-formats`, `next`, `react`, `qrcode`, `typescript` y los tipos. `npm test` corre las
pruebas. `npm run demo` muestra el recorrido completo con datos de prueba, con reloj fijo y sin red.
Para la otra generación de esquemas: `npm run demo -- --esquemas 2026`.

El uso diario es `node src/cli.ts ayuda`. Los datos viven en `datos/`, que no entra al repositorio.

## Aplicación web (CacaoLedger en el navegador)

Next.js 16 en `app/`, en el mismo paquete que la CLI. Muestra las ventas reales de Grupo Cacao sin terminal.

Acceso (`src/servidor/acceso.ts`, `src/servidor/sesion.ts`, `proxy.ts`): el mismo Clerk que los demás sitios de
Cacao (como `pay/`). Quién entra al libro lo decide `usuarios.es_admin` en Supabase, no Clerk.

- Público, sin login: `/`, el tablero con cifras agregadas (hoy, semana, mes, por producto, por riel y 30 días).
  No muestra filas de tickets ni detalles de error.
- Dueño (sesión iniciada y `usuarios.es_admin = true`, comprobado en el servidor en cada página, ruta y acción):
  `/tickets`, `/tickets/[id]`, `/tickets/[id]/json`, `/mes`, `/mes/[mes]`, los CSV y "Sincronizar ahora".
- Sesión sin `es_admin`: "Esta cuenta no tiene acceso al libro de Grupo Cacao."
- Sin sesión: redirige a `/entrar?volver=...`; el cabezal muestra "Entrar". Al dueño, el cabezal muestra
  Tickets, Mes y el botón de cuenta de Clerk.
- Los errores de sincronización son genéricos para todos ("No se pudo sincronizar con BTCPay. Probá más tarde.").
  La causa va al log del servidor y, para el dueño, a la línea de estado del tablero.

```
npm install
npm run dev          # http://localhost:4325
npm run build && npm start
```

Variables de entorno (solo en el servidor, salvo la clave pública de Clerk; ninguna es secreta para el navegador):

| Variable | Para qué |
|---|---|
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Clave pública de Clerk (la misma app que los demás sitios). Va al navegador, como en `pay/`. |
| `CLERK_SECRET_KEY` | Clave secreta de Clerk. Solo en el servidor. |
| `SUPABASE_URL` | Proyecto de Supabase donde están `ledger_tickets`, `ledger_dtes`, `ledger_candados` y `usuarios`. |
| `SUPABASE_SERVICE_ROLE_KEY` | Clave de servicio de ese proyecto. Vincula la cuenta de Clerk (`vincular_clerk`) y lee `es_admin`. |
| `LEDGER_BTCPAY_URL` | Dirección de BTCPay Server (http o https). |
| `LEDGER_BTCPAY_API_KEY` | Clave de API de solo lectura de BTCPay. |
| `LEDGER_BTCPAY_TIENDAS` | Ids de las tiendas, separados por coma. |
| `CRON_SECRET` | Clave que Vercel Cron manda como `Authorization: Bearer ...` a `/api/sincronizar`. |
| `LEDGER_ESQUEMAS` | Solo para la CLI. La web emite y muestra todos los tickets con el esquema `2026`. |

Rutas:

| Ruta | Acceso | Qué muestra |
|---|---|---|
| `/` | Público | Tablero: hoy, semana y mes en USD y sats, ventas por producto, cómo te pagan y últimos 30 días. Estado de la sincronización (y, para el dueño, el botón "Sincronizar ahora"). |
| `/entrar`, `/registrarse`, `/continuar` | Público | Clerk: entrar, crear cuenta y volver a la página pedida. |
| `/tickets` | Dueño | Lista con filtros en la URL (`producto`, `estado`, `desde`, `hasta`, `q`) y "Ver más" por cursor (`despues` y `despuesId`, por creado y id). |
| `/tickets/[id]` | Dueño | Detalle del ticket, totales con IVA, pago y el documento tributario. Si hay fila en `ledger_dtes`, muestra estado, número de control, código, fecha de recepción y el sello SIMULADO (o las observaciones). Si no hay fila, muestra la vista previa rotulada (versión legible, QR, "Imprimir"); la vista previa no se descarga como JSON. |
| `/tickets/[id]/json` | Dueño | El documento emitido como JSON. 404 si el ticket no tiene fila en `ledger_dtes`; 409 si la fila sigue reservada. |
| `/mes` y `/mes/[yyyy-mm]` | Dueño | Libros de IVA del mes, cifras para F-07 y F-14, supuestos, tickets no incluidos y selector de mes. |
| `/mes/[yyyy-mm]/csv/[libro]` | Dueño | CSV del mes: `consumidor`, `contribuyentes`, `anexo1`, `anexo2`. Las celdas que parecen fórmulas se escapan con `'`. |
| `/api/sincronizar` | Secreto de cron | `GET` con `Authorization: Bearer $CRON_SECRET`. Sincroniza sin límite de tiempo. Vercel lo llama cada día (`vercel.json`). |

Sincronización con BTCPay (`src/servidor/sincronizacion.ts`): hay un candado en la base (`ledger_candados`, nombre
`sincronizar`, 120 s, `src/servidor/candado.ts`): solo una corrida a la vez. Cada corrida escribe su fila en
`ledger_sincronizaciones` al empezar (sin `termino`) y la completa al terminar. La página lee la última fila: si
tiene menos de 60 s, no vuelve a consultar BTCPay. Si hay otra corrida en curso, responde "en curso" sin
empezar otra. Después de importar, la corrida emite hasta 50 tickets `pagado`. La página espera 6 s; el botón
usa un límite de 10 s. La corrida sigue hasta terminar y libera el candado al final.

Una factura que falla al guardarse queda en `omitidas` con su motivo; el resto de la corrida sigue.

Emisión: cada ticket `pagado` se emite con la lógica de la CLI (`src/emitir.ts`, detalle en `docs/web-datos.md`):
primero se reserva la fila de `ledger_dtes` con su número (`ledger_reservar_dte`, en la misma transacción), después
se construye, valida y recibe, y la fila pasa a `aceptado` o `rechazado`. Un ticket con fila no toma número. Una fila
que quedó `reservado` la completa la siguiente corrida con el número que ya tiene. Requiere aplicar las migraciones
`market/supabase/migrations/20261021000004_ledger_dte.sql` y `20261021000005_ledger_seguridad.sql` antes de desplegar.

Notas de la vista previa: el documento de cada ticket que aún no se emitió se arma al abrir la página con
`construirDte` y el esquema `2026`. No consume número: su número se deriva del id del ticket y no coincide con el
que se emite. Los libros cuentan solo los tickets en estado `emitido`, con referencias y sello guardados en Supabase.

Despliegue: `vercel.json` usa `framework: nextjs`, `buildCommand: next build` y un cron diario a las
12:00 UTC (06:00 en El Salvador). El sitio estático anterior sigue disponible con `npm run sitio`.

Pruebas: `npm test` cubre la CLI, el almacén, la sincronización con un BTCPay falso (también la factura que falla
sola), el candado, el control de acceso, la emisión con la reserva, y el CSV. Las migraciones SQL no se ejecutaron
contra el proyecto.

## Comandos

| Comando | Qué hace |
|---|---|
| `ticket nuevo --desde <archivo>` o `ticket nuevo --cliente ... --linea ...` | Crea un ticket con líneas, IVA del 13 % incluido y tipo de cliente. |
| `ticket ver <id>`, `ticket lista` | Muestra un ticket o la lista. |
| `pagar <id> --blink <archivo>` o `pagar <id> --efectivo` | Registra el pago por Lightning (webhook de Blink) o en efectivo. |
| `importar market <archivo>` | Crea un ticket pagado desde un pedido exportado de CacaoMarket. Ver `docs/importar-market.md`. |
| `importar btcpay [--desde YYYY-MM-DD] [--archivo <facturas.json>]` | Crea un ticket pagado por cada factura pagada de BTCPay. Ver `docs/importar-btcpay.md`. |
| `dte construir <id>` | Construye el DTE 01 o 03 y lo valida. Escribe la atestación si el pago es Lightning. |
| `dte validar <archivo o id>` | Valida un documento contra el esquema y las reglas propias. |
| `dte firmar <id> [--comercio <id>] [--firmador-url <url>]` | Pide un JWS al SVFE-API-Firmador (URL configurable). Opcional; sin firmador, el ciclo simulado sigue. |
| `dte transmitir <id> --simulado` | Completa el ciclo con un sello simulado. La transmisión real no existe. |
| `comercio registrar <id> --nit ... --password-pri ... --clave-privada <pem>` | Registra un comercio con credenciales cifradas (requiere `LEDGER_CLAVE_MAESTRA`). |
| `comercio lista` | Lista comercios registrados y cuál está activo. |
| `atestacion ver <id>`, `atestacion verificar`, `atestacion exportar` | Muestra, verifica o exporta la cadena de atestaciones de tasa. |
| `cierre [YYYY-MM-DD]` | Cierre del día: cada ticket en un grupo y una pregunta final. `cierre --ayuda` explica el plazo. |
| `mes <YYYY-MM> [--json] [--csv <carpeta>]` | Libros de IVA del mes y cifras para F-07 y F-14. |
| `web [--dia YYYY-MM-DD] [--salida <carpeta>]` | Escribe el sitio estático del cierre (por defecto `sitio/`). |
| `demo` | Recorrido completo con datos de prueba. |
| `npm run sitio` | Corre la demo en una carpeta temporal y escribe `sitio/` desde ella. |

Cuando un comando pide `<id>`, usá el identificador que imprimió el paso anterior (`TK-AAAAMMDD-XXXX`).

Opciones generales: `--esquemas caso|2026` (o la variable `LEDGER_ESQUEMAS`), `--datos <carpeta>` (o
`LEDGER_DATOS`), `--json` en la mayoría de los comandos.

## Los seis puntos del caso

| # | Punto | Estado | Cómo se muestra |
|---|---|---|---|
| 1 | Ticket con líneas, IVA del 13 % incluido y tipo de cliente (01 o 03) | Hecho | `node src/cli.ts ticket nuevo --desde fixtures/ticket-consumidor.json` y `node src/cli.ts ticket ver <id>` |
| 2 | Pago en dos rieles, uno Lightning (webhook de Blink) y otro efectivo | Hecho, desde fixtures | `node src/cli.ts pagar <id> --blink fixtures/blink-receive-lightning.json` y `node src/cli.ts pagar <id> --efectivo` |
| 3 | DTE 01 y 03 válidos, con la forma de pago del riel que liquidó | Hecho | `node src/cli.ts dte construir <id>` |
| 4 | Validación contra los esquemas oficiales, con falla legible del código 11 en 01 | Hecho | `node src/cli.ts dte construir <id> --forzar-codigo 11`, y con `--esquemas 2026` para ver el aviso |
| 5 | Atestación de tasa, enlazada y encadenada | Hecho | `node src/cli.ts atestacion ver <id>`, `node src/cli.ts atestacion verificar` |
| 6 | Cierre diario por grupos y pregunta final | Hecho | `node src/cli.ts cierre` (`node src/cli.ts cierre --ayuda` explica el plazo) |

En el orden del punto 4, corré primero el comando forzado: un ticket con documento ya no admite una
segunda construcción.

## Los puntos opcionales del caso

| # | Punto | Estado | Por qué |
|---|---|---|---|
| 7 | Firma con el firmador del Ministerio (SVFE) y JWS | Hecho (opcional) | `dte firmar <id>` con `LEDGER_FIRMADOR_URL`. Ver `docs/firma-y-comercios.md`. Sin firmador, `dte transmitir --simulado` sigue igual. |
| 8 | Libros de consumidor final y de contribuyentes, y cifras de F-07 y F-14 | Hecho | `node src/cli.ts mes <YYYY-MM>`. Ver la sección siguiente. |
| 9 | Convención defendida para la referencia de 50 caracteres | Hecho | `BTC-LN\|<sats>sat\|<tasa>\|<hash>`. Los argumentos están en `docs/hallazgos.md`, sección 8. |
| 10 | Credenciales por inquilino con cifrado | Hecho (módulo) | Varios comercios en `datos/comercios/` con sobre cifrado (`LEDGER_CLAVE_MAESTRA`). La demo sigue con un comercio. Ver `docs/firma-y-comercios.md`. |
| 11 | Contingencia (`tipoOperacion` 2) con cola de reenvío | No hecho | Requiere el canal de transmisión real. |
| 12 | Recibo para el cliente con QR y versión legible | Hecho (en web) | `tickets/<id>.html` incluye la Versión Legible del DTE con código QR en SVG y enlace a `admin.factura.gob.sv/consultaPublica`, lista para imprimir. |
| 13 | Transmisión a la prueba del Ministerio | No hecho | Las credenciales de prueba salen de un NIT registrado; no se pudieron obtener dentro del sprint. El sello es simulado. |

## Libros de IVA y cifras del mes

`node src/cli.ts mes 2026-10` imprime, para el mes:

- **Libro de ventas a consumidor final (01).** Una fila por día del mes, incluidos los días sin
  ventas: primer y último número de control, cantidad de documentos y ventas gravadas con IVA incluido.
- **Libro de ventas a contribuyentes (03).** Una fila por documento: fecha, número de control, código
  de generación, nombre y NRC del receptor, venta gravada neta, IVA y total.
- **Cifras para las declaraciones.** Las ventas gravadas y el débito fiscal de IVA por concepto para el F-07, y los ingresos brutos y el pago a cuenta del 1.75 % para el F-14, con la base sin IVA como supuesto de cálculo.
- **No incluidos.** Los tickets con dinero recibido y sin documento válido, con el motivo.

Solo cuentan los documentos con sello simulado. Los números salen del documento guardado, no se
retipean.

`--csv <carpeta>` escribe cuatro archivos CSV listos para el contador y para el portal de la DGII:
- `libro-consumidor-final-01_2026-10.csv` y `libro-contribuyentes-03_2026-10.csv` (formato de los libros no verificado en esta revisión; UTF-8 con BOM, punto y coma y coma decimal).
- `anexo-1-contribuyentes-f07_2026-10.csv` (**20 columnas A a T**, con punto decimal) y `anexo-2-consumidor-final-f07_2026-10.csv` (**23 columnas A a W**, agrupado por día con primer y último `codigoGeneracion`), siguiendo la plantilla de la DGII de 2021 e incluyendo las columnas de Renta. No confirmado: que los archivos no lleven encabezado, que el separador sea `;`, que la plantilla sea la versión 14 y los valores fijos de las columnas de Renta.

Las cifras alimentan el **Formulario F-07** (dentro de los primeros 10 días hábiles del mes siguiente, por confirmar; la versión 14 figura como borrador en mh.gob.sv y su vigencia no está confirmada) y el **Formulario F-14 v17** (pago a cuenta del 1.75 % sobre ingresos brutos por rama económica, Art. 151 CT, pago a cuenta, por confirmar; la base sin IVA es un supuesto de cálculo). El plazo del pago a cuenta no está confirmado (por confirmar). El detalle completo está en `docs/hallazgos.md` (sección 12) y en `docs/estrategia-y-hacienda.md`.

## Sitio estático del cierre, libros y marco de Hacienda

`npm run sitio` corre la demo en una carpeta temporal y escribe `sitio/`:
- `index.html`: el cierre del día con los cuatro grupos (`emitidos`, `huérfanos`, `plazo de 24 horas`, `abiertos`) y la respuesta de cuadratura.
- `mes.html`: las cifras para **F-07** y **F-14 v17**, enlaces de descarga a los 4 archivos CSV (`csv/`), los Libros de IVA (`01` y `03`) y la especificación de las 20 y 23 columnas de los Anexos 1 y 2 de Hacienda.
- `hacienda.html`: el marco tributario y sancionatorio de El Salvador (Arts. 119-B, 119-C, 119-F y 119-G CT; multas del Art. 239-A CT sobre el salario mínimo de `$408.80`, vigente desde el 1 de junio de 2025 y sin reforma posterior hallada a la fecha de revisión; umbrales del Art. 28 Ley de IVA de 50,000 colones de transferencias en doce meses o 20,000 colones de activo, en colones y sin reajuste desde el Decreto 296 de 1992, Ley Bitcoin D.L. 199 de 2025, Resolución 1003 del CVPCPA, reforma municipal D.L. 762 de 44 municipios, custodia MTIST 2.0 §6.4, límite frente a la CNAD/PSAD y consulta vinculante del Art. 26 CT, no verificado).
- `esquemas.html`: explicación de las dos generaciones de esquemas (`caso` y `2026`).
- `tickets/<id>.html`: una página por ticket, incluyendo en los documentos emitidos la **Versión Legible del DTE** con código QR en SVG y enlace a la consulta pública de Hacienda en `https://admin.factura.gob.sv/consultaPublica`. Los parámetros no prellenan el formulario: hay que escribir el código de generación, la fecha de emisión y el ambiente (`01` producción, `00` pruebas).

Es HTML y un CSS, sin scripts, para leer e imprimir desde el teléfono o escritorio.

Para el cierre de tus datos reales: `node src/cli.ts web --dia 2026-10-12 --salida sitio`.

`sitio/` no entra al repositorio. En producción se sirve bajo `/ledger` en `https://cacao-grupo.vercel.app/ledger`.

## Dos generaciones de esquemas

El tool sabe construir y validar en dos generaciones, y lo elige explícitamente con `--esquemas caso`
o `--esquemas 2026` (o la variable `LEDGER_ESQUEMAS`). Por defecto usa `caso`.

- `caso` (01 v1, 03 v3) es la generación que describe el caso. Sus archivos son una copia de un
  repositorio comunitario, no del Ministerio. Ahí el patrón de la forma de pago rechaza el 11 en 01.
- `2026` (01 v2, 03 v4) es el paquete que el Ministerio publica hoy. Ahí el esquema ya admite el 11;
  el tool lo emite con un aviso, porque el servicio de recepción no se pudo probar.

Además, la reforma municipal (D.L. 762; texto no verificado en esta revisión) redujo los 262 municipios a 44 municipios y cambió los códigos de `CAT-013`; los esquemas `caso` conservan la lista anterior. Detalle y pruebas en `docs/hallazgos.md`, secciones 2 y 4.

## Límites del entorno de demostración

- **No transmite a los servidores reales del Ministerio.** Sin credenciales de prueba de un contribuyente registrado en el portal de Hacienda, `dte transmitir` usa `--simulado`, y el sello que devuelve empieza por `SIMULADO-`.
- **Firma JWS local y por contenedor.** Incluye firmado JWS (`RS512`) con llaves RSA-4096 por comercio (`src/firma/`) y cliente HTTP hacia `svfe-api-firmador`.
- **Los pagos de demostración son fixtures deterministas**, con la estructura oficial del webhook de Blink.
- **La importación de CacaoMarket lee el pedido exportado** y verifica línea por línea y tasa USD/BTC.
- **No calcula el dígito verificador** del NIT ni del NRC; valida el patrón oficial de cada campo.
- **Los libros y anexos CSV cubren las ventas de CacaoLedger**: el contador los integra con el libro de compras y las retenciones antes de presentar el F-07 y el F-14 en `declara.mh.gob.sv`.

## Las trampas del caso

- **El patrón `^(0[1-9]||10||99)$` acepta la cadena vacía** por sus alternativas vacías. Un validador
  ingenuo deja pasar `codigo: ""`. Aquí la regla de CacaoLedger lo rechaza en las dos generaciones,
  con prueba.
- **`codigoGeneracion` solo admite mayúsculas.** El constructor escribe en mayúsculas y la prueba rechaza
  un UUID en minúsculas.
- **`numeroControl` tiene tres segmentos después del prefijo.** `DTE-01-M001P001-000000000000001` es la
  forma. La prueba rechaza la de cuatro segmentos que aparece en blogs.
- **`ambiente` es `00` para prueba y `01` para producción.** El valor por defecto es `00`; `01` exige
  `--confirmar-produccion` en el constructor y en el validador.
- **El IVA está incluido en el precio de la factura 01.** El IVA de cada línea es el precio por 13/113,
  redondeado al centavo por línea; los totales son la suma de las líneas. Las pruebas comprueban que
  `totalGravada`, `totalIva` y `montoTotalOperacion` cuadren con las líneas.
- **Bitcoin (11) no se declara en una factura 01 con el esquema `caso`.** La forma de pago pasa a 99,
  con la referencia `BTC-LN|<sats>sat|<tasa>|<hash>`. El tool muestra la falla del esquema y de la regla.

## Documentos del repositorio

- `docs/hallazgos.md`: lo comprobado contra los esquemas, las dos generaciones, la reforma municipal (D.L. 762), las decisiones de redondeo y los libros y anexos F-07 / F-14.
- `docs/estrategia-y-hacienda.md`: límite regulatorio ante la CNAD y Ley Bitcoin (D.L. 199), custodia de certificados MTIST 2.0 §6.4, economía unitaria frente al Art. 239-A CT y texto íntegro de la consulta vinculante ante la DGII (Art. 26 CT, no verificado).
- `docs/atestacion.md`: qué prueba la cadena SHA-256 de tasas USD/BTC y cómo se audita.
- `docs/importar-market.md`: formato del pedido de CacaoMarket y sus validaciones.
- `docs/importar-btcpay.md`: facturas pagadas de BTCPay, variables de entorno y omisiones.
- `docs/firma-y-comercios.md`: firmador SVFE, JWS (`RS512`), varios comercios y cifrado AES-256-GCM.
- `esquemas/README.md`: origen y huellas SHA-256 de cada archivo de esquema.
- `fixtures/README.md`: qué es cada dato de prueba.
