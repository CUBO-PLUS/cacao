# CacaoLedger

CacaoLedger toma una venta pagada y produce el documento tributario electrónico (DTE) de El Salvador:
factura 01 para consumidor final o comprobante de crédito fiscal 03 para contribuyente. Registra cómo se
pagó cada venta, guarda en una cadena de registros lo que el DTE no puede contener (la tasa de un pago en
bitcoin), arma el cierre del día, produce los libros de IVA del mes y muestra todo en una web para el dueño.

Es parte del grupo Cacao (CacaoMedia, CacaoTravel, CacaoMarket, CacaoPay).

**Nada se transmite a Hacienda.** El sello de recepción de la demo es simulado y empieza por `SIMULADO-`.
Ningún servicio del Ministerio lo emitió.

## Estado: qué funciona, qué no, qué sigue

| Estado | Qué |
|---|---|
| Funciona, se ve con `npm run demo` | Ticket con IVA del 13 % incluido y tipo de cliente; pago por Lightning (fixture con la forma del webhook de Blink) y en efectivo; factura 01 y comprobante 03 de la misma venta; validación contra los esquemas (dos generaciones, ver abajo); atestación de tasa encadenada, con verificación y prueba de alteración; cierre del día; libros de IVA y cifras de F-07 y F-14. |
| Funciona, con pruebas | Cliente del firmador SVFE (contra un servidor falso); credenciales de varios comercios con cifrado AES-256-GCM; importación de facturas de BTCPay y de pedidos de CacaoMarket. |
| Funciona en la web (dueño) | Tablero con el cierre de hoy; cierre por día en `/cierre/[día]`; tickets, detalle con la atestación de tasa, documento, libros del mes y CSV. Requiere cuenta de dueño y variables de entorno. |
| Funciona en la web (dueño) | Venta en efectivo marcada a mano (`/tickets/nueva`), con un token por envío: un doble envío no hace dos tickets. La cadena de atestaciones se guarda en `ledger_atestaciones` y «Verificar cadena» la recalcula en el servidor. |
| Simulado | Caída de Hacienda (`/cierre`, «Simular caída de Hacienda»): los documentos nuevos salen con `tipoOperacion` 2 y `tipoContingencia` 1, esperan 24 horas y «Simular que Hacienda volvió» los transmite con sello simulado. Todo se rotula SIMULADO. |
| Parcial | Los esquemas `2026` se validan con el paquete oficial del Ministerio, pero el servicio de recepción real no se probó. Firma: solo el cliente, contra un firmador falso. |
| No funciona | Transmisión a Hacienda, ni real ni de prueba. Firma con el firmador real del Ministerio (no se corrió). Contingencia real: lo de arriba es solo una simulación. Verificación del dígito del NIT y del NRC. Validación del par departamento-municipio contra CAT-013 de 2026. |
| Qué sigue | Probar la recepción con el servicio de pruebas del Ministerio, con credenciales de un NIT registrado. Contingencia de la CLI. Revisar con un contador las cifras de F-07 y F-14 antes de usarlas. |

Lo que no está probado en este repositorio se dice en la sección «Límites».

## Arranque desde un clon limpio

Necesitás Node 24 y acceso a internet para `npm install`. La CLI no necesita cuentas ni secretos.

```
git clone https://github.com/bitcoinenthusiastsv/cacao.git
cd cacao/ledger
npm install
npm test
npm run demo
```

- `npm test` corre todas las pruebas, sin red y sin cuentas.
- `npm run demo` corre el recorrido completo en una carpeta temporal, con reloj fijo y sin red. Al final muestra
  el cierre del 12 de octubre de 2026 con código de salida 1: a propósito, hay cobros sin documento válido.
- `npm run demo -- --esquemas 2026` corre el mismo recorrido con los esquemas del Ministerio.
- `node src/cli.ts ayuda` lista los comandos.
- `npm run check` genera los tipos de las rutas de Next.js y revisa TypeScript. Usá ese comando y no `npx tsc` solo: sin
  generar los tipos, `tsc` no encuentra `PageProps`.
- `npm run build` compila la web. Compila sin variables de entorno; la web necesita las de la sección «Aplicación web» para responder.

Los datos reales viven en `datos/` (o en `LEDGER_DATOS`), que no entra al repositorio. Antes de tener datos
propios, `ticket lista` sale vacío, y es lo esperado.

## Qué muestra la demo, paso por paso

`npm run demo` imprime cada comando y su resultado. Lo que hay que ver:

1. **Ticket con IVA incluido.** `ticket nuevo` calcula el IVA como 13/113 de cada línea y redondea al centavo por línea.
2. **Dos rieles.** Lightning (`pagar --blink`) y efectivo (`pagar --efectivo`). La forma de pago sale del riel que liquidó.
3. **Factura 01 con código 11 forzado.** `dte validar` la rechaza: falla el patrón del esquema `caso` y la regla de
   CacaoLedger. La salida dice `NO VÁLIDO`, con la ruta, el valor y la regla.
4. **Qué se emite en lugar del 11.** En `caso`, la factura 01 de Bitcoin lleva forma de pago `99` (Otros) y la
   referencia `BTC-LN|<sats>sat|<tasa>|<hash>`. En `2026`, el código es `11`, con un aviso (ver «Los esquemas de Hacienda»).
5. **Atestación encadenada.** `atestacion ver` muestra sats, USD, tasa, fuente, momento, hash de pago y código de
   generación del DTE. `atestacion verificar` confirma la cadena; con un número alterado en una copia, la verificación falla.
6. **Cierre del día.** `cierre` separa cada ticket en emitidos, huérfanos (cobrados sin documento válido), con plazo
   de 24 horas corriendo, y abiertos, y responde con una sola pregunta.
7. **Libros y F-07 / F-14.** `mes 2026-10` imprime el libro de consumidor final por día, el de contribuyentes y las
   cifras para las declaraciones, con la lista de tickets que no entran.

## Los seis puntos del caso

| # | Punto | Estado | Cómo se ve |
|---|---|---|---|
| 1 | Ticket con líneas, IVA del 13 % incluido y tipo de cliente (01 o 03) | Cumple | `node src/cli.ts ticket nuevo --desde fixtures/ticket-consumidor.json` y `ticket ver <id>`. En la web, en el detalle del ticket. |
| 2 | Pago en dos rieles, uno Lightning | Cumple, desde fixtures | `pagar <id> --blink fixtures/blink-receive-lightning.json` y `pagar <id> --efectivo`. Ver «Riel de pago». |
| 3 | DTE 01 y 03 de la misma venta, con la forma de pago del riel que liquidó | Cumple | `dte construir <id>`: en efectivo, código 01; por Lightning, 99 en 01 con `caso` y 11 con `2026`; en 03, 11. |
| 4 | Validación contra los esquemas oficiales, con falla legible del código 11 en 01 | Cumple, con matiz | `dte construir <id> --forzar-codigo 11` falla con `caso`. Con `--esquemas 2026` el mismo código pasa el esquema (ver «Los esquemas de Hacienda»). |
| 5 | Atestación de tasa, enlazada y encadenada | Cumple | `atestacion ver <id>`, `atestacion verificar`. En la web, bloque «Atestación de tasa» en el ticket, con hash, hash anterior y «Verificar cadena». |
| 6 | Cierre del día: pagados, con sello, huérfanos y dentro de 24 horas | Cumple | `cierre` en la CLI. En la web, «Cierre de hoy» en el tablero y `/cierre/[día]`. |

Puntos opcionales:

| # | Punto | Estado | Por qué |
|---|---|---|---|
| 7 | Firma con el firmador SVFE (JWS) | Parcial | `dte firmar <id>` llama a `svfe-api-firmador` (`LEDGER_FIRMADOR_URL`). Sin URL, firma en local con una clave de prueba (no válida ante Hacienda). Las pruebas usan un servidor falso. No se corrió el firmador real. |
| 8 | Libros de consumidor final y de contribuyentes; cifras de F-07 y F-14 | Cumple | `mes <YYYY-MM>` y `--csv <carpeta>`. |
| 9 | Convención defendida para la referencia de 50 caracteres | Cumple | `BTC-LN\|<sats>sat\|<tasa>\|<12 primeros del hash>`, con prueba de largo. Argumentos en `docs/hallazgos.md`, sección 8. |
| 10 | Credenciales por comercio, con cifrado | Parcial | Varios comercios con sobre cifrado (`comercio registrar`, `comercio lista`) y `LEDGER_CLAVE_MAESTRA`. La demo usa un comercio. Ver `docs/firma-y-comercios.md`. |
| 11 | Contingencia (`tipoOperacion` 2) con cola de reenvío | Simulada (web) | Control del dueño en `/cierre`: documentos con `tipoOperacion` 2, en espera de 24 horas, y reenvío con sello simulado. Falta el canal real y la CLI lo tiene solo como texto. |
| 12 | Recibo para el cliente con QR y versión legible | Cumple, en web y sitio | En `/tickets/[id]` y en el sitio del cierre: versión legible con QR en SVG y enlace a la consulta pública. |
| 13 | Transmisión a la prueba del Ministerio, o un mock | Parcial | Hay un servicio de recepción simulado propio (`src/recepcion-simulada.ts`), no el mock comunitario. Nada sale a la red. |

## Riel de pago: por qué BTCPay y no Blink

El caso sugiere Blink, y su webhook `receive.lightning` trae en un mensaje los sats, el USD, la tasa y la hora.
Por eso el repositorio tiene el fixture de ese webhook y el adaptador `src/pagos/blink.ts`, con pruebas.

Los productos del grupo cobran con **BTCPay Server** autoalojado (la demo corre en regtest, sin valor). Por eso el
ledger también importa las facturas pagadas de BTCPay (`importar btcpay`, `docs/importar-btcpay.md`). Blink no es el
cobro de los productos del grupo: queda como el riel que pide el caso, con fixtures, y no como camino de producción.
La decisión de cobrar con BTCPay está en el README de la raíz del repositorio, no en este paquete.

## Los esquemas de Hacienda: dos generaciones

Lo verificado en esta revisión, con el SHA-256 de cada archivo, está en `esquemas/README.md`.

- **`caso`** (01 v1, 03 v3): copia de un repositorio comunitario (`espejo-herson`), no del Ministerio. En la factura 01,
  el patrón de `resumen.pagos[].codigo` es `^(0[1-9]||10||99)$`: no admite `11`, y como tiene alternativas vacías
  también acepta la cadena vacía. Por eso el caso pide `99` en 01, y la regla de CacaoLedger rechaza el código vacío.
- **`2026`** (01 v2, 03 v4): los archivos de `ministerio-2026/` son el paquete oficial publicado en `factura.gob.sv`
  (descarga 4399). **En el esquema oficial de 01 v2, el campo `codigo` no tiene patrón, solo `maxLength: 2`.** Por eso
  `11` pasa el esquema. La prueba `src/validar.test.ts` lo fija.

Conclusión: el rechazo del código 11 en 01 es real en el espejo comunitario de v1, pero no en el esquema oficial vigente
que trae el repositorio. Con `2026`, CacaoLedger emite `11` en la factura 01 y avisa de que el servicio de recepción no
se probó. Que Hacienda rechace el 11 en 01 no lo pudimos confirmar contra su servicio, solo contra el esquema.

La web emite siempre con `2026` (`src/emitir.ts`). La CLI usa `caso` por defecto, para mostrar el rechazo.

## La atestación de tasa

Cada pago por Lightning deja un registro con: sats, USD, tasa USD/BTC, fuente de la tasa, momento del pago, hash del
pago y el código de generación del DTE al que pertenece. Cada registro lleva el hash del anterior. `atestacion verificar`
recorre la cadena. Qué prueba y qué no: `docs/atestacion.md`.

- La CLI guarda la cadena en `datos/atestaciones.jsonl`. Cambiar un número de un registro rompe la cadena.
- La web guarda la misma cadena en `ledger_atestaciones` (migración `20261104000099`). Cada registro lleva su hash y el
  del anterior, y «Verificar cadena» en el ticket recalcula todos los hashes desde el contenido guardado.
- Los tickets emitidos antes de que existiera la cadena reciben su registro al abrir el tablero del dueño, en orden de
  creación. Ese orden es el de la venta, pero el registro se escribe en el momento de completar la cadena.
- La tasa es la que informó el riel. No prueba que sea justa.

## El cierre del día

Para un día, cada ticket cae en un solo grupo:

- **emitidos**: con sello (simulado);
- **huérfanos**: cobrados y sin documento válido (sin construir, sin transmitir, o rechazados sin sello);
- **con plazo de 24 horas corriendo**: rechazados, con los minutos que quedan, o vencidos; y, en la web, los documentos
  emitidos durante la caída simulada de Hacienda que esperan transmisión (el plazo cuenta desde el inicio de la caída);
- **abiertos**: creados y sin cobrar.

La pregunta final es «¿Todos los cobros de hoy tienen su sello?». La CLI sale con código 1 si la respuesta es no.

No hay declaración diaria obligatoria: el cierre es un control operativo. El plazo de 24 horas para reenviar un
documento rechazado es **cifra por confirmar** frente a Hacienda.

En la web, el cierre está en `/cierre/[día]` (solo dueño), y el tablero muestra la respuesta de hoy. Sin sesión de
dueño, la página redirige a entrar y no muestra ningún ticket.

## Aplicación web

Next.js 16 en `app/`, en el mismo paquete que la CLI. El acceso usa Clerk (el mismo que los demás sitios de Cacao) y
`usuarios.es_admin` en Supabase.

- Público: `/`, el tablero con cifras agregadas, sin filas de tickets ni causas de error.
- Dueño: `/cierre`, `/cierre/[día]` (con el control SIMULADO de Hacienda), `/tickets`, `/tickets/nueva` (venta en efectivo),
  `/tickets/[id]` (con la cadena de atestaciones), `/tickets/[id]/json`, `/mes`, `/mes/[mes]` y los CSV.

Variables de entorno (solo en el servidor, salvo la clave pública de Clerk):

| Variable | Para qué |
|---|---|
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Clave pública de Clerk. Va al navegador. |
| `CLERK_SECRET_KEY` | Clave secreta de Clerk. Solo en el servidor. |
| `SUPABASE_URL` | Proyecto de Supabase con `ledger_tickets`, `ledger_dtes`, `ledger_candados` y `usuarios`. |
| `SUPABASE_SERVICE_ROLE_KEY` | Clave de servicio de ese proyecto. Solo en el servidor. |
| `LEDGER_BTCPAY_URL`, `LEDGER_BTCPAY_API_KEY`, `LEDGER_BTCPAY_TIENDAS` | Sincronización con BTCPay (solo lectura). |
| `CRON_SECRET` | Secreto del cron de Vercel para `/api/sincronizar`. |

```
npm install
npm run dev          # http://localhost:4325
npm run build && npm start
```

Las migraciones que crean `ledger_dtes` y la reserva de números están en `market/supabase/migrations`
(`20261021000004_ledger_dte.sql` y `20261021000005_ledger_seguridad.sql`). La cadena de atestaciones (`ledger_atestaciones`),
la simulación de Hacienda (`ledger_simulacion`) y el estado `contingencia` están en
`20261104000099_ledger_atestaciones_contingencia.sql`. Esa migración se aplicó solo en el Supabase local. Desde este
repositorio no se verificó que estén aplicadas en el proyecto desplegado: hay que correrla antes de usar la web allí.

Pruebas de la web: `npm test` cubre el acceso, la sincronización con un BTCPay falso, la emisión con la reserva, el
cierre web y el CSV. La página del dueño con sesión iniciada no se probó en un navegador: no hay cuenta de prueba de
Clerk en este repositorio.

## Comandos de la CLI

| Comando | Qué hace |
|---|---|
| `ticket nuevo --desde <archivo>` o `--cliente ... --linea ...` | Crea un ticket con IVA del 13 % incluido. |
| `ticket ver <id>`, `ticket lista` | Muestra un ticket o la lista. |
| `pagar <id> --blink <archivo>` o `pagar <id> --efectivo` | Registra el pago. |
| `importar market <archivo>` | Crea un ticket pagado desde un pedido exportado de CacaoMarket (`docs/importar-market.md`). |
| `importar btcpay [--desde YYYY-MM-DD] [--archivo <json>]` | Crea un ticket pagado por cada factura pagada de BTCPay (`docs/importar-btcpay.md`). |
| `dte construir <id> [--forzar-codigo <código>] [--ambiente 01 --confirmar-produccion]` | Construye el DTE 01 o 03 y lo valida. Escribe la atestación si el pago es Lightning. |
| `dte validar <archivo o id>` | Valida contra el esquema y las reglas propias. |
| `dte firmar <id> [--comercio <id>] [--firmador-url <url>]` | Pide el JWS al firmador SVFE. Opcional. |
| `dte transmitir <id> --simulado` | Completa el ciclo con recepción simulada. No hay transmisión real. |
| `comercio registrar ...`, `comercio lista` | Registra y lista comercios con credenciales cifradas (`LEDGER_CLAVE_MAESTRA`). |
| `atestacion ver <id>`, `atestacion verificar`, `atestacion exportar` | Muestra, verifica o exporta la cadena de tasas. |
| `cierre [YYYY-MM-DD] [--json]` | Cierre del día. `cierre --ayuda` explica el plazo. |
| `mes <YYYY-MM> [--json] [--csv <carpeta>]` | Libros de IVA y cifras para F-07 y F-14. |
| `web [--dia YYYY-MM-DD] [--salida <carpeta>]` | Escribe el sitio estático del cierre (`sitio/`). |
| `demo` | Recorrido completo con datos de prueba. |

Opciones generales: `--esquemas caso|2026` (o `LEDGER_ESQUEMAS`), `--datos <carpeta>` (o `LEDGER_DATOS`), `--json`.

## Límites

- **No transmite a Hacienda.** `dte transmitir` solo usa la recepción simulada. Ningún sello de la demo es válido.
- **El firmador real no se corrió.** La firma se prueba contra un servidor falso con la forma de respuesta esperada.
- **Los pagos de demostración son fixtures.** Siguen la forma del webhook de Blink; no mueven fondos.
- **Los esquemas `2026` no se probaron contra el servicio de recepción.** Solo contra el paquete oficial.
- **No se verifica el dígito del NIT ni del NRC.** Se valida el patrón de cada campo.
- **La contingencia es simulada.** No hay caída real ni transmisión a Hacienda: el sello de la contingencia empieza por `SIMULADO-`.
  La CLI no tiene el control de contingencia.
- **El tipo de contingencia 1 (CAT-008, no disponibilidad del sistema del Ministerio) se eligió por el texto del esquema; el significado del código no se verificó contra la tabla oficial.**
- **La web no firma.** Emite con el esquema `2026` y sin JWS.
- **El cierre web lee los cobros de los últimos 60 días, más todos los pagados o rechazados sin documento.** Un ticket creado hace más de 60 días y cobrado ese mismo día no aparece en la web. La CLI no tiene ese límite.
- **Los libros y anexos CSV cubren solo las ventas de CacaoLedger.** El contador los integra con compras y retenciones antes de presentar el F-07 y el F-14. Los formatos de los CSV de la DGII no están confirmados (ver `docs/hallazgos.md`, sección 12).
- **Plazos y sanciones** (24 horas, 10 días hábiles, pago a cuenta del 1.75 %) están marcados «por confirmar» donde no se verificaron contra una fuente primaria.

## Documentos del repositorio

- `docs/hallazgos.md`: lo comprobado contra los esquemas, la reforma municipal (D.L. 762), redondeos, libros y anexos, y la convención de referencia.
- `docs/estrategia-y-hacienda.md`: límite regulatorio ante la CNAD, custodia de certificados, economía unitaria frente al Art. 239-A CT y consulta a la DGII (sin verificar).
- `docs/atestacion.md`: qué prueba la cadena SHA-256 de tasas USD/BTC y cómo se audita.
- `docs/importar-market.md`, `docs/importar-btcpay.md`: formatos de importación.
- `docs/firma-y-comercios.md`: firmador SVFE, comercios y cifrado AES-256-GCM.
- `docs/web-datos.md`: datos, acceso y sincronización de la web.
- `esquemas/README.md`: origen y huellas SHA-256 de cada esquema.
- `fixtures/README.md`: qué es cada dato de prueba.
