# CacaoLedger en la web: datos, acceso y sincronización

La capa de datos sirve tanto a la CLI (archivos JSON en `datos/`) como a la aplicación web (Supabase).
Las pantallas están en `app/` (Next.js); importan estos módulos y no repiten la lógica de datos.

## Acceso

- Clerk, la misma app que `pay/`: `proxy.ts` (clerkMiddleware), `app/layout.tsx` (ClerkProvider en es-MX),
  `app/entrar`, `app/registrarse` y `app/continuar` (volver a la página pedida tras entrar).
- `src/servidor/sesion.ts`: `sesionActual()` lee la cuenta de Clerk, vincula el usuario con `vincular_clerk`
  (service role; solo un teléfono o correo verificado por Clerk puede vincular una fila existente) y lee
  `usuarios.es_admin`. Va con `cache()`: una consulta por petición.
- `src/servidor/acceso.ts`: funciones puras. `decidirAcceso(sesion, volver)` devuelve `permitir`, `entrar` (con
  destino) o `denegar`. También `destinoSeguro` (solo rutas de este sitio) y las rutas de entrar y continuar.
- `accesoDeDueno(volver)` (páginas) redirige a `/entrar` sin sesión, y `respuestaSinAcceso(volver)` (rutas) devuelve
  303 o 403. Se llama antes de leer el libro.
- Público: `/` con agregados (`resumen` de `src/tablero.ts`), sin filas de tickets ni causas de error.
- Dueño: `/tickets`, `/tickets/[id]`, `/tickets/[id]/json`, `/mes`, `/mes/[mes]`, `/mes/[mes]/csv/[libro]` y la
  acción "Sincronizar ahora" (que vuelve a comprobar la sesión).

## Tablas (migraciones `20261021000002`, `000004` y `000005`)

| Tabla | Para qué |
|---|---|
| `ledger_tickets` | Un ticket por fila. `datos` guarda el objeto `Ticket` completo; las demás columnas son para filtrar y ordenar (`estado`, `producto`, `origen_plataforma`, `origen_numero`, `total_centavos`, `sats`, `payment_hash`, `pagado_en`, `buscar`). |
| `ledger_correlativos` | Último número usado por serie del DTE (para `ledger_siguiente_correlativo`, que la web ya no llama para emitir). |
| `ledger_sincronizaciones` | Una fila por corrida con BTCPay. Se escribe al empezar (`termino` nulo) y se completa al terminar. `emitidos` y `rechazados` son nulos en las corridas sin emisión. |
| `ledger_dtes` | Un documento por ticket (`ticket_id` único). `estado` es `reservado` (fila de reserva, sin documento), `aceptado` o `rechazado`. `correlativo` guarda el número tomado de la serie al reservar. `numero_control` es un marcador `RESERVADO-<codigo>` hasta que se completa. |
| `ledger_candados` | Candado de arriendo (lease): `nombre` (pk), `hasta` y `dueno`. Para que dos corridas no se pisen. |

Todas tienen RLS activado, sin permisos para `anon` ni `authenticated`, y permisos para `service_role`.
Las funciones son `security definer` con `search_path` fijado, y solo las ejecuta `service_role`.

Funciones:

- `ledger_guardar_ticket(p_ticket jsonb)`: crea o reemplaza un ticket por `id`. Calcula el total desde las líneas
  (misma regla que `src/dinero.ts`). Lanza `DUPLICADO: ...` y no escribe nada si: otro ticket tiene el mismo hash
  de pago o el mismo origen; el mismo `id` existe con otro origen o pago; o un insert concurrente choca con un
  índice único.
- `ledger_siguiente_correlativo(p_serie text)`: devuelve el siguiente número de la serie, de forma atómica.
- `ledger_reservar_dte(p_ticket, p_serie, p_tipo, p_codigo)`: en una sola transacción inserta la fila `reservado`
  (único por `ticket_id`) y toma el correlativo de la serie. Devuelve `null` si el ticket ya tiene fila, y entonces
  no toma número.
- `ledger_tomar_candado(p_nombre, p_dueno, p_segundos)`: devuelve `true` si el candado estaba libre o vencido.
  Usa `insert ... on conflict do update ... where hasta < now()`. No usa candados de sesión de Postgres: PostgREST
  ejecuta cada rpc en su propia transacción.
- `ledger_soltar_candado(p_nombre, p_dueno)`: suelta el candado solo a su dueño. Devuelve `false` si no era suyo.

## Interfaces (TypeScript)

- `src/almacen/tipos.ts`: `AlmacenTickets` (`guardar`, `porId`, `porOrigen`, `porHash`, `listar`) y
  `FiltrosTickets`. El límite por defecto es 50 y el máximo 500. La paginación es por clave: `despues` (creado) y
  `despuesId` (id). El orden es `creado desc, id desc`, así que dos tickets con el mismo instante no se repiten ni
  se saltan.
- `src/almacen/archivos.ts`: `almacenArchivos(datos)`, sobre los JSON de la CLI (mismo orden y cursor).
- `src/almacen/supabase.ts`: `createAlmacenSupabase({ url, clave, fetch? })`, sobre PostgREST con `fetch`.
  El cursor por id se valida con la forma `TK-AAAAMMDD-XXXX` antes de armar el filtro.
- `src/almacen/dtes.ts`: `AlmacenDtes` con tres operaciones:
  - `porTicket(ticketId)`: la fila del ticket o `null`.
  - `reservar({ ticketId, serie, tipoDte, codigoGeneracion })`: número o `null` (ver `ledger_reservar_dte`).
  - `completar(registro)`: escribe el documento en la fila reservada (filtra por `codigo_generacion` y
    `estado = reservado`). Devuelve `false` si la fila ya no está reservada.
- `src/correlativos-supabase.ts`: sin uso desde la emisión web. Queda con su prueba y no lo llama nadie en `src/`.
- `src/servidor/candado.ts`: `tomarCandado` y `soltarCandado` sobre las funciones de arriba.
- `src/emitir.ts`: `emitirTicket(almacen, dtes, ticket, { ahora, esquemas?, emisor? })` y
  `emitirPagados(almacen, dtes, { ahora, esquemas?, limite? })`.

## Importación desde BTCPay

`src/btcpay.ts` (`importarFacturaBtcpay(almacen, factura, ahora)`) aplica las reglas por factura. Valida que
`usdCentavos` sea un entero entre 1 y 2147483647 (la columna `total_centavos` es un entero de 32 bits), y que
`orderId` tenga como mucho 200 caracteres.

`src/sincronizar.ts` (`sincronizarBtcpay(almacen, config, opciones)`) lee las facturas pagadas de cada tienda y
llama a esa regla por factura. Un error por factura (distinto de `DUPLICADO`) no detiene la corrida: esa factura
queda en `omitidas` con el mensaje, y se sigue con las demás. Devuelve `nuevas`, `repetidas`, `omitidas` (con
motivo), `porProducto` y `tiendasTruncadas`. Si se pasa `registrar`, recibe una fila con los conteos o el error.

Límite: BTCPay devuelve como máximo 200 facturas pagadas por tienda y llamada, las más recientes primero.
El cliente no tiene `skip` ni fecha de fin. Si una tienda devuelve 200, aparece en `tiendasTruncadas`
y sus facturas más antiguas no se leyeron; hay que volver a correr con `desde` más reciente.

## Candado y registro de cada corrida

`src/servidor/sincronizacion.ts`, en `sincronizarSiHaceFalta`:

1. Lee la última fila. Si una corrida sigue abierta (sin `termino`) hace menos de 120 s, responde "en curso".
   Si la última fila es de hace menos del umbral, responde sin correr.
2. Toma el candado `sincronizar` por 120 s. Si no lo consigue, responde "en curso" sin correr.
3. Escribe la fila de la corrida (`empezo`, sin `termino`).
4. Corre importación y emisión. Al terminar completa la fila y suelta el candado. El candado se suelta cuando termina
   el trabajo, aunque la página ya haya dejado de esperar por el límite de 6 s.

Si el candado no se puede tomar por un error de red, la corrida falla con un mensaje para el servidor y el público
ve la línea genérica.

## Emisión de documentos

`src/emitir.ts` hace en la web los mismos pasos que `dte construir` y `dte transmitir --simulado` de la CLI:
reserva el número, construye el documento, lo valida con los esquemas, pide la recepción simulada
(`src/recepcion-simulada.ts`) y deja el ticket `emitido` (sello simulado) o `rechazado`. Usa las mismas funciones
puras (`construirDte`, `validarDte`, `recibir`, `adjuntarDte`, `aceptarDte`, `rechazarDte`).

Diferencias con la CLI, a propósito:

- **El número se reserva antes de construir, y solo si el ticket no tiene fila.** `ledger_reservar_dte` escribe la
  fila `reservado` y toma el correlativo en la misma transacción. Un ticket con fila no toma número nuevo.
  Hacienda tolera huecos en la numeración solo con invalidación: un documento rechazado conserva su número, y su
  fila dice `rechazado`. Es una limitación de demostración.
- **Una fila `reservado` se completa en la siguiente corrida** con el correlativo y el código que ya tiene. El
  documento se escribe con `completar`, que solo toca filas `reservado`: dos corridas que llegaran a completar la
  misma fila no producen dos documentos.
- **Todos los tickets de la web usan el esquema `2026`** (`generacionParaTicket` en `src/emitir.ts`). El esquema
  `caso` es un espejo comunitario con un umbral de receptor de USD 200 que no está en el esquema del Ministerio, y
  no acepta el código 11 (Bitcoin) en una factura 01. La vista previa de la página del ticket usa el mismo esquema.
  La CLI no cambia: sigue con `LEDGER_ESQUEMAS` o `caso`.
- **Solo ambiente `00`** (prueba). El documento se guarda en `ledger_dtes`; el ticket apunta a él con
  `dte.archivo = "ledger_dtes/<codigo>"`, porque la web no tiene carpeta `datos/`.
- El código de generación de la reserva sale de `codigoGeneracionNuevo("<ticket>|reserva")`, así que cada ticket
  tiene el suyo sin depender del número.

Idempotencia: un ticket `emitido` o `rechazado` no se toca. Un ticket `pagado` con fila `aceptado` o `rechazado` no
recibe número nuevo: su ticket se completa desde la fila (caso de reparación). Un ticket `pagado` con fila
`reservado` termina el documento con el número que ya tiene.

Orden de escritura: la reserva, después el documento (`completar`), después el ticket (`guardar`). Si el último paso
falla, el ticket queda `pagado` con su fila completa; la siguiente corrida lo completa desde la fila sin tomar otro
número.

Lote: `sincronizarBtcpay` llama a `emitirPagados` después de importar, con `listar({ estado: "pagado", limite: 50 })`.
Un ticket que falla queda `pagado`, se registra en el log del servidor y se vuelve a intentar en la siguiente corrida;
no detiene al resto.

Límites de la emisión:

- Tickets que fallan de forma repetida (más de 50 a la vez) ocupan el lote y frenan el resto. No hay marca de
  "reintentar después".
- Un ticket que falló al construirse se rechaza con la razón en `motivo`; no se reintenta.
- El sello es simulado. Ninguna llamada sale de la red.
- Los esquemas de `esquemas/` se leen en tiempo de ejecución; `next.config.ts` (`outputFileTracingIncludes`) los incluye
  en el despliegue. Sin eso, la validación fallaría en Vercel.

## Libros del mes y CSV

`src/mes.ts` arma los libros y las cifras. Las celdas de texto que empiezan con `=`, `+`, `-`, `@`, tabulador o
retorno se escriben con un apóstrofe delante (`celdaCsv`), salvo que sean importes con formato numérico. Se citan
en `"` cuando hace falta. Los supuestos del F-14 (base sin IVA), el estado de los anexos del F-07 y el sello
simulado se muestran en el bloque "Supuestos" de `/mes`.

Citas: el pago a cuenta del F-14 es Art. 151 CT, por confirmar. El plazo del F-07 es "dentro de los primeros 10
días hábiles del mes siguiente", por confirmar.

## Tablero

`src/tablero.ts`: `resumen(tickets, ahora)` calcula hoy, los últimos siete días, el mes, el desglose por producto y
por riel del mes, y los últimos 30 días. Usa días de El Salvador. Un cobro cuenta en el día de `pago.momento`. Solo
cuentan los tickets con pago. La página pública muestra solo estas cifras.

## Pruebas

`npm test` corre: el almacén de archivos y de Supabase con `fetch` falso (incluido el cursor con id); el candado
con una rpc falsa; el almacén de documentos (reserva, completar, 409); la sincronización con un BTCPay falso, incluida
la factura que falla sola; el control de acceso (`decidirAcceso`, `destinoSeguro`); la emisión en memoria (orden,
segunda llamada sin cambios, dos corridas a la vez con un solo documento, reserva sin número consumido, fila reservada
completada con su número, reparación, rechazo, esquema 2026); el CSV con escape de fórmulas. Las migraciones SQL no
se han ejecutado contra Postgres en este entorno: hay que probarlas en el proyecto antes de aplicarlas.
