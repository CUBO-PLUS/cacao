# CacaoLedger en la web: datos y sincronización

La capa de datos sirve tanto a la CLI (archivos JSON en `datos/`) como a la aplicación web (Supabase).
Las pantallas están en `app/` (Next.js); importan estos módulos y no repiten la lógica de datos.

## Tablas (`market/supabase/migrations/20261021000002_ledger.sql` y `20261021000004_ledger_dte.sql`)

| Tabla | Para qué |
|---|---|
| `ledger_tickets` | Un ticket por fila. `datos` guarda el objeto `Ticket` completo; las demás columnas son para filtrar y ordenar (`estado`, `producto`, `origen_plataforma`, `origen_numero`, `total_centavos`, `sats`, `payment_hash`, `pagado_en`, `buscar`). |
| `ledger_correlativos` | Último número usado por serie del DTE. |
| `ledger_sincronizaciones` | Registro de cada sincronización con BTCPay. Desde la migración 000004 tiene `emitidos` y `rechazados` (nulos en las corridas sin emisión). |
| `ledger_dtes` | Un documento por ticket: `codigo_generacion` (pk), `ticket_id` (índice único), `tipo_dte`, `numero_control` (único), `ambiente`, `estado` (`aceptado` o `rechazado`), `sello` (solo si fue aceptado), `motivo` (observaciones, si fue rechazado), `documento` (JSON) y `creado_en` (el momento de la recepción). |

Todas tienen RLS activado, sin permisos para `anon` ni `authenticated`, y permisos para `service_role`.
Las funciones son `security definer` y solo las ejecuta `service_role`.

- `ledger_guardar_ticket(p_ticket jsonb)`: crea o reemplaza un ticket por `id`. Calcula el total desde
  las líneas (misma regla que `src/dinero.ts`). Si otro ticket tiene el mismo hash de pago o el mismo
  origen, lanza `DUPLICADO: ...` y no escribe nada.
- `ledger_siguiente_correlativo(p_serie text)`: devuelve el siguiente número de la serie, de forma atómica.

## Interfaces (TypeScript)

- `src/almacen/tipos.ts`: `AlmacenTickets` (`guardar`, `porId`, `porOrigen`, `porHash`, `listar`) y
  `FiltrosTickets`. El límite por defecto es 50 y el máximo 500. `despues` es el cursor por
  `creado` (paginación por clave, no por número de página).
- `src/almacen/archivos.ts`: `almacenArchivos(datos)`, sobre los JSON de la CLI.
- `src/almacen/supabase.ts`: `createAlmacenSupabase({ url, clave, fetch? })`, sobre PostgREST con `fetch`.
  La clave es la de servicio: va solo en el servidor.
- `src/correlativos.ts`: `FuenteCorrelativos` (`ultimo`, `guardar`), `siguienteCorrelativo(fuente, serie)` y
  `correlativosArchivo(datos)`, la versión de hoy. Un número se registra solo después de validar el
  documento, como antes.
- `src/correlativos-supabase.ts`: `correlativosSupabase({ url, clave, fetch? })` con `tomarCorrelativo(serie)`,
  sobre la función `ledger_siguiente_correlativo`. No tiene `guardar`: la función consume el número en la
  misma llamada que lo devuelve (ver "Emisión de documentos").
- `src/almacen/dtes.ts`: `AlmacenDtes` (`porTicket`, `insertar`) y `createAlmacenDtesSupabase`, sobre
  `ledger_dtes`. `insertar` rechaza un segundo documento del mismo ticket con un mensaje legible.
- `src/emitir.ts`: `emitirTicket(almacen, dtes, correlativos, ticket, { ahora, esquemas?, emisor? })` y
  `emitirPagados(almacen, dtes, correlativos, { ahora, esquemas?, limite? })`.

## Importación desde BTCPay

`src/btcpay.ts` (`importarFacturaBtcpay(almacen, factura, ahora)`) aplica las reglas por factura.
`src/sincronizar.ts` (`sincronizarBtcpay(almacen, config, opciones)`) lee las facturas pagadas de cada
tienda y llama a esa regla por factura. Devuelve `nuevas`, `repetidas`, `omitidas` (con motivo),
`porProducto` y `tiendasTruncadas`. Si se pasa `registrar`, escribe una fila del registro con los
conteos o el error. Un error de BTCPay se registra y se vuelve a lanzar.

Límite: BTCPay devuelve como máximo 200 facturas pagadas por tienda y llamada, las más recientes primero.
El cliente no tiene `skip` ni fecha de fin. Si una tienda devuelve 200, aparece en `tiendasTruncadas`
y sus facturas más antiguas no se leyeron; hay que volver a correr con `desde` más reciente.

## Emisión de documentos

`src/emitir.ts` hace en la web los mismos pasos que `dte construir` y `dte transmitir --simulado` de la CLI:
construye el documento, lo valida con los esquemas, toma el número de control, pide la recepción simulada
(`src/recepcion-simulada.ts`) y deja el ticket `emitido` (sello simulado) o `rechazado`. Usa las mismas
funciones puras (`construirDte`, `validarDte`, `recibir`, `adjuntarDte`, `aceptarDte`, `rechazarDte`).

Diferencias con la CLI, a propósito:

- **El número se toma antes de construir.** `ledger_siguiente_correlativo` lo consume en la misma llamada,
  así que un documento que se rechaza conserva su número, y su fila dice `rechazado`. La CLI no consume el
  número de un documento que no pasa la validación. Hacienda tolera huecos en la numeración solo con
  invalidación: es una limitación de demostración, no del modelo.
- **La generación de esquema depende del pago.** Un cobro Lightning se emite con `2026`: los esquemas `caso`
  no aceptan el código 11 (Bitcoin) en una factura 01, y la forma de pago caería en 99 (ver README, "Las
  trampas del caso"). Los demás tickets siguen el valor por defecto de la CLI (`LEDGER_ESQUEMAS`, o `caso`).
  El emisor es el mismo fixture que usa la vista previa de cada generación.
- **Solo ambiente `00`** (prueba). El documento se guarda en `ledger_dtes`; el ticket apunta a él con
  `dte.archivo = "ledger_dtes/<codigo>"`, porque la web no tiene carpeta `datos/`.

Idempotencia: un ticket que ya está `emitido` o `rechazado` no se toca. Un ticket `pagado` con fila en
`ledger_dtes` no recibe número nuevo: su ticket se completa desde la fila (caso de reparación, ver abajo).

Orden de escritura: primero la fila en `ledger_dtes` (su índice único por `ticket_id` impide que dos
sincronizaciones emitan el mismo ticket), después el ticket. Si la segunda escritura falla, el ticket queda
`pagado` con su fila; la siguiente corrida lo completa desde la fila sin tomar otro número.

Lote: `sincronizarBtcpay` llama a `emitirPagados` después de importar, con `listar({ estado: "pagado", limite: 50 })`.
Un ticket que falla queda `pagado`, se registra en el log del servidor y se vuelve a intentar en la
siguiente corrida; no detiene al resto. El registro de sincronización recibe `emitidos` y `rechazados`
(solo cuando la corrida emitió), y la línea de estado del tablero muestra "N documentos emitidos".

Límites de la emisión:

- Tickets que fallan de forma repetida (más de 50 a la vez) ocupan el lote y frenan el resto. Hoy no hay
  marca de "reintentar después".
- Un ticket que falló al construirse se rechaza con la razón en `motivo`; no se reintenta.
- La emisión corre dentro de la misma espera de 6 s de la página. Si se pasa, la página muestra el error de
  tiempo, pero la emisión sigue hasta terminar.
- No se escribe el registro de atestación de la CLI (tasa de cambio de los cobros Lightning).
- El sello es simulado. Ninguna llamada sale de la red.
- Los esquemas de `esquemas/` se leen en tiempo de ejecución; `next.config.ts` (`outputFileTracingIncludes`)
  los incluye en el despliegue. Sin eso, la validación fallaría en Vercel.

## Tablero

`src/tablero.ts`: `resumen(tickets, ahora)` calcula hoy, los últimos siete días, el mes, el desglose
por producto y por riel del mes, y los últimos 30 días. Usa días de El Salvador. Un cobro cuenta en el
día de `pago.momento`. Solo cuentan los tickets con pago.

## Pruebas

`npm test` corre las pruebas de almacén (archivos y Supabase con `fetch` falso), la sincronización con
un BTCPay falso, el tablero, la numeración y la emisión (`src/emitir.test.ts`, con almacén, tabla de
documentos y correlativos en memoria: emisión en orden, segunda llamada sin cambios, lote, rechazo de un
ticket inválido, reparación y el registro con conteos). Las migraciones SQL no se han ejecutado contra
Postgres en este entorno: falta probarlas en el proyecto antes de aplicarlas. La migración 000004 agrega
columnas al registro de sincronización, así que debe aplicarse antes del despliegue; si no, el registro de
cada corrida no se escribe (la sincronización sigue, y el error queda en el log del servidor).
