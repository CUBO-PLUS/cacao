# Referencia de API, Acciones de Servidor y Funciones de Base de Datos

CacaoPay sigue la regla de seguridad de todo el grupo Cacao: **el navegador nunca lee ni escribe directamente en las tablas de transferencias**. Las vistas son Server Components de Next.js, los formularios invocan Server Actions (`'use server'`), la capa `src/servidor/` valida la sesión y los datos de entrada, y las mutaciones se ejecutan en PostgreSQL mediante funciones `security definer` invocadas únicamente con `service_role`.

## 1. Rutas HTTP y páginas de la aplicación (`src/app/`)

| Ruta | Método / Tipo | Acceso | Descripción |
|---|---|---|---|
| `/` | `GET` (Server Component) | Público | Portada con el cotizador interactivo (`Cotizador`), resumen de garantías y enlace a `/hacienda`. |
| `/hacienda` | `GET` (Server Component) | Público | Marco tributario de El Salvador (LISR Art. 3 num. 4 para valores del exterior, IVA 13% en F-07, Pago a Cuenta 1.75% en F-14 v17, DTE en CacaoLedger y normas del BCR/UIF). |
| `/entrar` | `GET` | Público | Ingreso con el componente `<SignIn />` de Clerk (celular o correo). Vuelve a `volver` si ya hay nombre; si falta, lleva a `/cuenta`. |
| `/registrarse` | `GET` | Público | Alta con el componente `<SignUp />` de Clerk. Al terminar pasa por `/entrar` para seguir al destino `volver`. |
| `/enviar` | `GET` / Server Actions | Con sesión | Flujo de envío en tres pasos: monto y vía de entrega, datos del destinatario y confirmación con clave de idempotencia. |
| `/envios` | `GET` (Server Component) | Con sesión | Historial paginado (20 por página) de las transferencias enviadas por la persona en sesión. |
| `/envios/[id]` | `GET` / Server Actions | Remitente o Admin | Detalle completo del envío, línea de tiempo, acciones según estado, desglose tributario (DGII · BCR) y comprobante imprimible. Si entra el destinatario, redirige a `/recibidos/[id]`. |
| `/recibidos` | `GET` (Server Component) | Con sesión | Historial paginado de las transferencias dirigidas al teléfono o correo de la persona en sesión, sin mostrar la comisión. |
| `/recibidos/[id]` | `GET` (Server Component) | Destinatario | Vista del destinatario con monto a recibir, estado en tiempo real y nota del remitente, sin mostrar la comisión. |
| `/rastrear` | `GET` | Público | Buscador por código de transferencia (`CP-XXXX-XXXX`). |
| `/t/[codigo]` | `GET` (Server Component) | Público | Seguimiento público sin cuenta: muestra solo el monto a recibir, la vía de entrega, el primer nombre del destinatario, el estado y la línea de tiempo. |
| `/cuenta` | `GET` / Server Actions | Con sesión | Edición del nombre visible y cierre de sesión local. |
| `/admin` | `GET` (Server Component) | Administradora | Resumen del período por estado y tabla de liquidación tributaria (F-07 y F-14 v17) sobre envíos entregados. |
| `/admin/envios` | `GET` (Server Component) | Administradora | Lista paginada de todos los envíos con filtro por estado y contactos enmascarados. |
| `/admin/envios/[id]` | `GET` / Server Action | Administradora | Inspección administrativa de un envío y acciones para procesarlo, marcarlo como entregado o marcarlo como fallido con motivo. |
| `/admin/embudo` | `GET` (Server Component) | Administradora | Embudo de conversión (`vio_cotizacion`, `inicio_envio`, `creo_envio`, `envio_completado`) con sesiones, eventos y monto en USD. |
| `/admin/tarifas` | `GET` (Server Component) | Administradora | Tabla de comisiones por forma de entrega, código `CAT-017` para DTE y tipos de cambio guardados en `pay_tasas`. |

## 2. Tipo de respuesta estándar (`src/servidor/resultado.ts`)

Todas las funciones de mutación y lectura protegida devuelven el tipo discriminado `Resultado<T>`:

```ts
export type Resultado<T> =
  | { ok: true; dato: T }
  | { ok: false; codigo: string; mensaje: string };
```

### Códigos de error

| Código | Cuándo se devuelve |
|---|---|
| `DATOS_INVALIDOS` | Monto fuera de rango (`$1.00` a `$3,000.00`), teléfono o correo mal formado, motivo de fallo fuera de 4 a 200 caracteres, moneda o entrega inválida, o discrepancia entre los montos enviados y el recálculo de la base de datos. |
| `NO_PERMITIDO` | Intento de enviarse dinero a sí mismo, acción reservada a administración, o intento de usar botones de simulación cuando `NEXT_PUBLIC_DEMO` no es `1`. |
| `NO_ENCONTRADA` | La transferencia o la cuenta no existe, o pertenece a otra persona (se devuelve el mismo mensaje para no revelar la existencia de un identificador ajeno). |
| `ESTADO_INVALIDO` | Transición no permitida por la máquina de estados (por ejemplo, cancelar un envío que ya está `procesando` o completar uno que ya terminó). |
| `SIN_COTIZACION` | Las fuentes de precio de Bitcoin (Coinbase y Kraken) no respondieron o difieren en más del 2% al cotizar un envío por Lightning. |
| `ERROR` | Falla inesperada de red o de base de datos; el detalle técnico queda en el registro del servidor y la persona recibe un mensaje claro en español. |

## 3. Capa de servidor (`src/servidor/`)

### 3.1 Cotización, tarifas y tasas (`src/servidor/tasas.ts`)

- `tarifas(): Promise<Record<Entrega, Tarifa>>`
  Lee `pay_tarifas` desde Supabase y devuelve `{ fijoCentavos, porcentajeBps, minutosEstimados }` para `lightning`, `cuenta` y `efectivo`. Si la lectura falla, usa las constantes de respaldo (`TARIFAS`).
- `tarifasDetalle(): Promise<TarifaDetalle[]>`
  Devuelve la lista completa de formas de entrega con su descripción.
- `tasaEurUsd(): Promise<{ tasa: number; fuente: string; actualizadaEn: string }>`
  Lee el par `EUR/USD` de `pay_tasas` (sembrado en `1.08`).
- `tasasDeCambio(): Promise<TasaDeCambio[]>`
  Devuelve todos los pares almacenados en `pay_tasas` para `/admin/tarifas`.
- `cotizarEnServidor(entrada: EntradaCotizacion): Promise<Resultado<Cotizacion & { validaHasta: string }>>`
  Calcula la cotización oficial en el servidor leyendo `pay_tarifas`, `pay_tasas` y, si `entrega === 'lightning'`, el precio de Bitcoin en vivo (`cotizacionUsdBtc()`). Devuelve la cotización con una vigencia de 5 minutos (`validaHasta`).

### 3.2 Transferencias (`src/servidor/transferencias.ts`)

- `crearEnvio(usuarioId: string, datos: DatosNuevoEnvio): Promise<Resultado<{ id: string; codigo: string }>>`
  Valida nombre (2 a 80 caracteres), contacto (celular salvadoreño de 8 dígitos con o sin `+503`, o correo electrónico), nota (hasta 200 caracteres) y clave de idempotencia (1 a 100 caracteres). Vuelve a cotizar en el servidor con `cotizarEnServidor`, invoca la función RPC `pay_crear_transferencia` y registra el evento `creo_envio`.
- `procesarEnvio(usuarioId: string, envioId: string): Promise<Resultado<CambioEnvio>>`
  Pasa una transferencia de `creada` a `procesando` invocando `pay_procesar`. Permitido al remitente o a una administradora.
- `cancelarEnvio(usuarioId: string, envioId: string): Promise<Resultado<CambioEnvio>>`
  Pasa una transferencia de `creada` a `cancelada` invocando `pay_cancelar`. Permitido únicamente al remitente antes de que salga el envío.
- `simularCompletar(actor: { id: string; esAdmin: boolean }, envioId: string): Promise<Resultado<CambioEnvio>>`
  Pasa una transferencia de `procesando` a `completada` invocando `pay_completar` y registra el evento `envio_completado`. Permitido siempre a una administradora y, en modo demostración (`NEXT_PUBLIC_DEMO=1`), al remitente de su propio envío.
- `simularFallar(actor: { id: string; esAdmin: boolean }, envioId: string, motivo: string): Promise<Resultado<CambioEnvio>>`
  Pasa una transferencia en `creada` o `procesando` a `fallida` con un motivo obligatorio de 4 a 200 caracteres invocando `pay_fallar`.
- `misEnvios(usuarioId: string, opciones?: { pagina?: number }): Promise<PaginaEnvios>`
  Devuelve las transferencias enviadas por `usuarioId`, ordenadas por `creada_en desc`, con contactos enmascarados.
- `recibidos(usuarioId: string, opciones?: { pagina?: number }): Promise<PaginaEnvios>`
  Devuelve las transferencias cuyo `destinatario_id` coincide con `usuarioId`.
- `envioPara(usuario: { id: string; esAdmin: boolean }, envioId: string): Promise<EnvioDetalle | null>`
  Devuelve el detalle y el historial de una transferencia si el usuario es su remitente, su destinatario o administradora (verificada en la base con `esAdministrador`). Oculta `destinatarioContacto` cuando el rol es `destinatario`.
- `rastreo(codigo: string): Promise<RastreoPublico | null>`
  Normaliza el código `CP-XXXX-XXXX` y selecciona únicamente las columnas públicas (`COLUMNAS_RASTREO`): código, estado, moneda y monto de destino, vía de entrega, primer nombre del destinatario, fecha de creación e historial. Nunca selecciona remitente, contacto, comisión ni nota.

### 3.3 Monitor administrativo (`src/servidor/monitor.ts`)

Cada función verifica primero en la base de datos que `usuarios.es_admin` sea `true` para `actorId`:

- `todosLosEnvios(actorId: string, opciones?: { estado?: EstadoEnvio; pagina?: number }): Promise<Resultado<PaginaEnvios>>`
- `resumenEnvios(actorId: string, desde: Date, hasta: Date): Promise<Resultado<ResumenEstado[]>>`
- `embudoPay(actorId: string, desde: Date, hasta: Date): Promise<Resultado<PasoEmbudo[]>>`
- `tarifasYTasas(actorId: string): Promise<Resultado<{ tarifas: TarifaDetalle[]; tasas: TasaDeCambio[] }>>`

### 3.4 Sesiones, cuentas y eventos (`src/servidor/sesion.ts`, `cuentas.ts`, `eventos.ts`)

- `sesionActual(): Promise<Sesion | null>`: toma `auth()` y `currentUser()` de Clerk, llama `vincular_clerk` con el teléfono E.164 y el correo principales y el nombre, y lee `id, nombre, es_admin` de `usuarios` con el cliente de servicio.
- `exigirSesion(volver?: string): Promise<Sesion>`: redirige a `/entrar` si no hay sesión activa.
- `exigirAdmin(volver: string): Promise<Sesion>`: exige sesión y responde `404` (`notFound()`) si la persona no es administradora.
- `actualizarPerfil(usuarioId: string, nombre: string): Promise<Resultado<{ nombre: string }>>`: actualiza el nombre visible invocando `actualizar_perfil`.
- `registrarEvento(datos: DatosEvento): Promise<void>`: registra pasos del embudo en la tabla compartida `eventos` con `p_sitio = 'pay'`.

## 4. Acciones de servidor (`acciones.ts`)

| Archivo | Acción | Entrada | Efecto |
|---|---|---|---|
| `src/app/enviar/acciones.ts` | `cotizarAccion` | `{ montoCentavos, monedaOrigen, entrega }` | Devuelve `Resultado<{ cotizacion, usdBtc }>` calculado en el servidor. |
| `src/app/enviar/acciones.ts` | `registrarVisitaCotizacion` | ninguna | Registra el evento `vio_cotizacion` con la cookie de visita. |
| `src/app/enviar/acciones.ts` | `registrarInicioEnvio` | ninguna | Registra el evento `inicio_envio`. |
| `src/app/enviar/acciones.ts` | `crearEnvioAccion` | `FormData` | Crea la transferencia con `crearEnvio` y redirige a `/envios/[id]`. |
| `src/app/envios/[id]/acciones.ts` | `procesarEnvioAccion` | `envioId: string` | Ejecuta `procesarEnvio` y refresca la ruta. |
| `src/app/envios/[id]/acciones.ts` | `cancelarEnvioAccion` | `envioId: string` | Ejecuta `cancelarEnvio` y refresca la ruta. |
| `src/app/envios/[id]/acciones.ts` | `simularCompletarAccion` | `envioId: string` | Ejecuta `simularCompletar` y refresca la ruta. |
| `src/app/envios/[id]/acciones.ts` | `simularFallarAccion` | `envioId: string, motivo: string` | Ejecuta `simularFallar` y refresca la ruta. |
| `src/app/envios/[id]/acciones.ts` | `estadoDeEnvioAccion` | `envioId: string` | Devuelve el estado actual para el sondeo en vivo cuando el envío está `procesando`. |
| `src/app/admin/envios/[id]/acciones.ts` | `ejecutarAccion` | `FormData` (`envio`, `accion`, `motivo`) | Ejecuta `procesar`, `completar` o `fallar` como administradora y revalida `/admin`. |
| `src/app/cuenta/acciones.ts` | `guardarNombre` | `FormData` | Guarda el nombre de la cuenta y revalida el layout. |
| `src/app/cuenta/BotonSalir.tsx` | `BotonSalir` | ninguna | Cliente. Cierra la sesión del dispositivo con `signOut` de Clerk y redirige a `/`. |

## 5. Módulos puros (`src/lib/`)

- `src/lib/cotizacion.ts`: `cotizar(entrada)`, `formatoMonto(valor, moneda)`, `TARIFAS`, `TASA_EUR_USD`, `MINIMO_CENTAVOS` (`100`), `MAXIMO_CENTAVOS` (`300_000`).
- `src/lib/transferencias.ts`: `accionesPosibles(estado, rol)`, `descripcionDeEstado(estado, rol)`, `normalizarCodigo(texto)`, `esCodigo(texto)`, `normalizarContacto(texto)`, `enmascararContacto(contacto)`, `aUsdCentavos(monto, moneda, eurUsd)`.
- `src/lib/dinero.ts`: `formatoUsd(centavos)`, `formatoSats(sats)`, `usdCentavosASats(centavos, cotizacionUsdBtc)`.
- `src/lib/hacienda.ts`: `desglosarComisionUsd(comisionUsdCentavos)` y `desgloseTributarioEnvio(entrada)` para el cálculo del principal recibido (valores del exterior, Art. 3 num. 4 LISR; alcance para remesas no confirmado), base gravada sin IVA (supuesto de cálculo), débito fiscal de IVA del 13% (F-07), Pago a Cuenta del 1.75% (F-14 v17, Art. 151 CT) y código `CAT-017`.

## 6. Funciones RPC de PostgreSQL (`market/supabase/migrations/20261014000005_pay.sql`)

Todas las tablas (`pay_tasas`, `pay_tarifas`, `pay_transferencias`, `pay_historial`) tienen `row level security` activado y permisos revocados para `anon` y `authenticated`. Solo `service_role` puede ejecutar estas funciones:

| Función SQL | Firma | Qué garantiza |
|---|---|---|
| `pay_crear_transferencia` | `(p_remitente, p_destinatario_nombre, p_destinatario_contacto, p_moneda_origen, p_monto_origen, p_moneda_destino, p_entrega, p_tasa, p_tasa_fuente, p_comision, p_monto_destino, p_nota, p_clave)` | Bloquea el usuario con `for update`, verifica idempotencia por `(remitente_id, clave_idempotencia)`, recalcula comisión, neto y monto destino con `_pay_calcular`, enlaza `destinatario_id` si el contacto pertenece a un usuario registrado, impide autoenvíos, genera el código único `CP-XXXX-XXXX` y escribe en `pay_transferencias`, `pay_historial` y `auditoria`. |
| `pay_procesar` | `(p_transferencia, p_actor)` | Bloquea la fila con `for update`, verifica que el actor sea el remitente o administradora y que el estado sea `creada`, y avanza a `procesando`. |
| `pay_completar` | `(p_transferencia, p_actor)` | Verifica que el estado sea `procesando` y que el actor sea administradora (o `null` para el simulador en modo demo) y avanza a `completada`. |
| `pay_fallar` | `(p_transferencia, p_actor, p_motivo)` | Verifica motivo de 4 a 200 caracteres y estado `creada` o `procesando`, y avanza a `fallida`. |
| `pay_cancelar` | `(p_transferencia, p_actor)` | Verifica que el actor sea el remitente y que el estado sea `creada`, y avanza a `cancelada`. |
| `pay_resumen` | `(p_desde, p_hasta)` | Agrupa por `estado` los envíos creados en `[p_desde, p_hasta)`, convirtiendo los montos y comisiones en `EUR` a centavos de `USD` con la tasa guardada en `pay_tasas`. |

## 7. API de cobros v1 (`/api/v1/`)

Cacao Pay cobra por Lightning para los demás productos del grupo (Media, Travel y Market). Cada producto llama a esta API desde su servidor, con su propia clave. La API crea la factura en BTCPay, lee su estado y avisa cuando cambia. **No hay CORS**: ningún navegador puede llamarla, y la clave nunca debe llegar a una página.

Las rutas terminan en barra, como el resto de la aplicación (`trailingSlash`). Sin la barra, el servidor responde 308.

| Método y ruta | Qué hace |
|---|---|
| `POST /api/v1/cobros/` | Crea un cobro. Exige `Idempotency-Key`. Responde 201 si es nuevo y 200 si es una repetición. |
| `GET /api/v1/cobros/{id}/` | Lee el cobro. Pide a BTCPay su estado mientras el cobro no esté pagado. Otra clave recibe 404. |
| `POST /api/v1/cobros/{id}/cancelar/` | Cancela un cobro pendiente. Un cobro pagado responde 409. |
| `POST /api/v1/btcpay/aviso/` | Webhook de BTCPay. Lo llama BTCPay, firmado con `BTCPay-Sig`. |
| `GET` o `POST /api/v1/avisos/procesar/` | Envía los avisos pendientes. Exige `Authorization: Bearer` con `PAY_AVISOS_SECRET`. Lo llama el cron de Vercel una vez al día. |

### Autenticación y límites

Cada petición lleva `Authorization: Bearer cp_...`. Sin clave, con una clave que no existe o con una clave revocada: 401. Cada clave puede hacer 120 peticiones por minuto; pasado el límite responde 429 con `Retry-After`.

Las claves se crean con `scripts/cliente-api.mjs` y se muestran una sola vez. En la base solo queda su hash SHA-256.

### Crear un cobro

Campos del cuerpo (JSON). Cualquier campo que no esté en esta lista responde 400.

| Campo | Tipo | Regla |
|---|---|---|
| `monto` | entero | En centavos de dólar si `moneda` es `USD` (100 a 1000000). En sats si es `SATS` (1 a 100000000). |
| `moneda` | texto | `USD` o `SATS`. |
| `descripcion` | texto | 1 a 200 caracteres. Aparece en el ticket de CacaoLedger. |
| `referencia` | texto | 1 a 120 caracteres. Es el id del producto para lo que se cobra (`orderId`). |
| `producto` | texto | `media`, `travel`, `market` o `pay`. |
| `tienda` | texto | Opcional. Solo si la clave puede elegir tienda y la tienda está asignada a esa clave. |
| `vence_en_segundos` | entero | Opcional. De 300 a 86400. Por defecto, 3600. |
| `aviso_url` | texto | Opcional. Dirección `https` donde Pay avisa los cambios de estado (ver "Avisos"). |
| `datos` | objeto JSON | Opcional. Hasta 2000 bytes (con las claves ordenadas). Pay lo guarda tal cual y lo devuelve solo al cliente que lo mandó, en la respuesta de crear y de leer. Pay no lo interpreta, no lo manda a BTCPay ni en los avisos. Sirve para que el cliente reconstruya su propio registro (por ejemplo, una reserva) a partir del cobro. |

El servidor calcula los sats con el precio del bitcoin en ese momento y los guarda. El navegador nunca decide el monto en sats.

```bash
curl -s https://pay.cacaomedia.example/api/v1/cobros/ \
  -H "Authorization: Bearer $CACAO_PAY_CLAVE" \
  -H "Idempotency-Key: pedido-1042-intento-1" \
  -H "Content-Type: application/json" \
  -d '{"monto": 2500, "moneda": "USD", "descripcion": "Pupusas para la mesa 4", "referencia": "pedido-1042", "producto": "market", "aviso_url": "https://market.ejemplo.com/cacao/avisos"}'
```

Respuesta (201):

```json
{
  "id": "6f1c2a1e-0b7d-4a55-9e0e-3c2d8f7a9b10",
  "estado": "pendiente",
  "factura": "lnbc250n1p...",
  "sats": 25000,
  "usd_centavos": 2500,
  "expira_en": "2026-10-31T01:30:00+00:00",
  "enlace_pago": "https://btcpay.cacaomedia.example/i/AbC123...",
  "pago_tardio": false,
  "datos": null
}
```

**Idempotencia.** `Idempotency-Key` tiene de 8 a 128 caracteres (letras, números, `-` y `_`).

- La misma clave con el mismo cuerpo devuelve el cobro original (200, con `Idempotent-Replayed: true`). No se hace otra factura.
- La misma clave con otro cuerpo responde 409 `IDEMPOTENCIA_CONFLICTO`. Los `datos` forman parte del cuerpo: la misma clave con otros `datos` también responde 409. El orden de las claves de `datos` no cambia nada.
- Si otra petición con la misma clave todavía está creando la factura, responde 409 `IDEMPOTENCIA_EN_CURSO`. Repetir en un momento.
- Si BTCPay rechaza la factura (error 4xx), no queda ninguna factura y la clave vuelve a quedar libre.
- Si no hubo respuesta de BTCPay, la clave queda reservada. Repetir la misma petición después de un minuto encuentra la factura que BTCPay ya hizo, en vez de hacer otra.

### Leer y cancelar

```bash
curl -s https://pay.cacaomedia.example/api/v1/cobros/6f1c2a1e-0b7d-4a55-9e0e-3c2d8f7a9b10/ \
  -H "Authorization: Bearer $CACAO_PAY_CLAVE"

curl -s -X POST https://pay.cacaomedia.example/api/v1/cobros/6f1c2a1e-0b7d-4a55-9e0e-3c2d8f7a9b10/cancelar/ \
  -H "Authorization: Bearer $CACAO_PAY_CLAVE"
```

Estados: `pendiente`, `pagado`, `vencido` y `cancelado`.

- Un cobro queda `pagado` solo cuando BTCPay dice que la factura está pagada (`Settled`). Pay vuelve a leerlo en BTCPay; el cuerpo de un aviso nunca se usa como prueba.
- Cancelar primero le pide a BTCPay que invalide la factura, la vuelve a leer, y solo entonces cancela. Si la factura se pagó mientras tanto, el cobro queda `pagado` y la cancelación se rechaza con 409.
- Un pago que llega a un cobro ya cancelado no cambia su estado: queda con `pago_tardio: true`, y hay que devolverlo.
- Un cobro pagado no se cancela (409 `ESTADO_INVALIDO`).

### Avisos

Cuando un cobro pasa a `pagado`, `vencido` o `cancelado` y tiene `aviso_url`, Pay hace un `POST` a esa dirección:

```json
{"aviso": "0b7d4a55-...", "tipo": "cobro.estado", "id": "6f1c2a1e-...", "estado": "pagado"}
```

La cabecera `Cacao-Firma` tiene la forma `t=<segundos>,v1=<hex>`. `v1` es el HMAC-SHA256, con el secreto del cliente, del texto `<t>.<cuerpo>`. Para verificar un aviso:

1. Calcular el HMAC del texto `t + "." + cuerpo` con el secreto del cliente, y compararlo con `v1` en tiempo constante.
2. Rechazar si `t` se aleja más de 300 segundos de la hora actual (aviso repetido).
3. Antes de actuar, leer el cobro con `GET /api/v1/cobros/{id}/`. El aviso solo dice que hay un cambio.

```js
import { createHmac, timingSafeEqual } from 'node:crypto';

export function avisoValido(cabecera, cuerpo, secreto) {
  const m = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(cabecera ?? '');
  if (!m || Math.abs(Date.now() / 1000 - Number(m[1])) > 300) return false;
  const esperada = createHmac('sha256', secreto).update(`${m[1]}.${cuerpo}`, 'utf8').digest();
  const recibida = Buffer.from(m[2], 'hex');
  return recibida.length === esperada.length && timingSafeEqual(recibida, esperada);
}
```

**Cabecera `Cacao-Aviso-Id`.** Cada intento lleva el id del aviso en esa cabecera, igual que el campo `aviso` del cuerpo. La entrega es *al menos una vez*: si el receptor respondió y Pay no llegó a registrarlo, el aviso puede llegar dos veces con el mismo id. El receptor debe descartar un id que ya procesó.

**Entrega.** Cada aviso es una fila de `pay_avisos`, escrita en la misma operación que el cambio de estado del cobro. Si el proceso se cae justo después del cambio, el aviso sigue en la base y se envía después. Un fallo de aviso nunca cambia el cobro.

**Reintentos.** Un intento fallido (error de red, respuesta distinta de 2xx, redirección o más de 5 segundos) espera 30 segundos, y luego el doble en cada intento, con techo de una hora: 30 s, 1 min, 2 min, 4 min, 8 min, 16 min, 32 min, 1 h, 1 h. Después del décimo intento sin respuesta el aviso queda `muerto` (`entrega = 'muerto'`). Un aviso muerto se conserva en `pay_avisos`, con su último error, y no se borra. Cada intento se firma de nuevo con su hora, así que la tolerancia de 300 segundos se aplica a la hora de cada intento.

**Quién envía.** Justo después del cambio de estado, el mismo proceso envía el aviso con `after()`. Los pendientes los envía `GET` o `POST /api/v1/avisos/procesar/`, con `Authorization: Bearer <PAY_AVISOS_SECRET>`. La comparación es en tiempo constante, y sin el secreto configurado la ruta responde 401. Además, después de cada petición válida a la API, Pay envía hasta tres avisos pendientes, una vez enviada la respuesta. Cada envío toma sus avisos con un reclamo de dos minutos: si el proceso se cae, otro lo toma después, y dos envíos a la vez nunca mandan el mismo aviso.

**Direcciones.** `aviso_url` se revisa al crear el cobro, y otra vez antes de cada intento:

- `https` siempre. `http` solo en desarrollo y solo hacia `localhost` o `127.0.0.1`. En producción nunca.
- Sin usuario ni clave. Sin direcciones IP escritas, en ninguna forma (decimal, hexadecimal, octal o IPv4 mapeada en IPv6). Sin `localhost`, ni nombres `.local` o `.internal`.
- Solo el puerto 443. En desarrollo, la dirección local puede usar cualquier puerto.
- El nombre se resuelve, y **todas** las direcciones deben ser públicas. Quedan fuera las privadas, de bucle, de enlace local, compartidas (100.64.0.0/10), multicast, reservadas, de metadatos de nube y las IPv4 mapeadas en IPv6.
- La revisión se hace también al abrir la conexión: la conexión solo usa las direcciones que pasaron la revisión en ese momento. Así, un nombre que cambia de dirección después de guardar el cobro no lleva a la red interna.
- No se siguen redirecciones: un 3xx es un intento fallido.
- Cinco segundos como máximo por intento. La respuesta no se lee, y nunca se guardan el cuerpo del aviso ni el secreto.

### Tiendas

Cada clave cobra en su tienda por defecto. Con `puede_elegir_tienda`, puede cobrar también en las tiendas asignadas en `pay_api_tiendas`. Cualquier otra tienda responde 403 `NO_PERMITIDO`, y la base de datos lo verifica en `pay_reservar_cobro` aunque la API ya lo haya revisado.

### Errores

Todas las respuestas de error tienen la forma `{"error": {"codigo": "...", "mensaje": "..."}}`.

| Código HTTP | Códigos |
|---|---|
| 400 | `DATOS_INVALIDOS` |
| 401 | `NO_AUTORIZADO` |
| 403 | `NO_PERMITIDO` |
| 404 | `NO_ENCONTRADA` |
| 409 | `IDEMPOTENCIA_CONFLICTO`, `IDEMPOTENCIA_EN_CURSO`, `ESTADO_INVALIDO` |
| 429 | `LIMITE` |
| 502 | `BTCPAY` |
| 503 | `NO_DISPONIBLE`, `SIN_COTIZACION` |
| 500 | `ERROR` |

### Administración de clientes

```bash
node --env-file=.env.local scripts/cliente-api.mjs crear --nombre "Market" [--tienda ID] [--elegir] [--tiendas A,B]
node --env-file=.env.local scripts/cliente-api.mjs listar
node --env-file=.env.local scripts/cliente-api.mjs revocar cp_XXXXXXXX
```

`crear` imprime la clave y el secreto de los avisos una sola vez. `--tienda` es `BTCPAY_STORE_ID` por defecto.

### Variables de entorno

| Variable | Qué es |
|---|---|
| `PAY_BTCPAY_PLATAFORMA_KEY` | Clave de BTCPay con permisos para crear, leer y marcar como `Invalid` facturas en las tiendas de la plataforma (`btcpay.store.cancreateinvoice`, `btcpay.store.canviewinvoices`, `btcpay.store.canmodifyinvoices`). Solo en el servidor. |
| `PAY_BTCPAY_WEBHOOK_SECRET` | Secreto con que BTCPay firma sus avisos (`BTCPay-Sig`). Es el mismo que se configura en el webhook de cada tienda que usa la API. |
| `PAY_AVISOS_SECRET` | Secreto de `Authorization: Bearer` para la ruta que envía los avisos pendientes. Solo en el servidor. |

Para la demostración, `infra/btcpay/local/clave-plataforma.mjs` crea la clave con permisos mínimos y el secreto del webhook, y los escribe en `pay/.env.local` sin mostrarlos. Ese archivo no está en git.

### Pruebas

```bash
node --env-file=.env.local node_modules/vitest/vitest.mjs run tests/db/api-cobros.test.ts
node --env-file=.env.local tests/api/cobros-api.mjs     # con el servidor de desarrollo en el puerto 4324
```

`tests/db/avisos.test.ts` prueba cola de avisos: el cambio y su aviso se escriben juntos, dos remitentes no toman el mismo aviso, un reclamo caído vuelve a tomarse, los reintentos esperan el doble hasta el techo, a los diez intentos el aviso queda `muerto`, y la ruta envía lo que quedó en la tabla sin envío en memoria. `src/servidor/avisos.test.ts` prueba cada forma de dirección rechazada (decimal, hexadecimal, octal, IPv4 mapeada, localhost en producción, metadatos, credenciales, redirección), la revisión al conectar y el secreto de la ruta.

La prueba de extremo a extremo crea dos clientes, cobra, paga desde la billetera de prueba, verifica la firma del aviso con su propia implementación, y comprueba el aislamiento, la cancelación, la autenticación y la firma del webhook.

### Pendiente para producción

- Configurar el webhook de BTCPay en cada tienda que use la API, con `PAY_BTCPAY_WEBHOOK_SECRET`.
- Definir `PAY_BTCPAY_PLATAFORMA_KEY` en el proyecto de Vercel, con los permisos mínimos.
- Aplicar la migración `20261031000001_pay_api.sql` en Supabase antes de desplegar el código.
- Aplicar `20261031000050_pay_avisos.sql` antes del código: añade la cola de avisos y quita `pay_marcar_aviso`.
- Aplicar `20261103000001_pay_datos.sql` antes del código: añade `datos` a `pay_cobros` y cambia la firma de `pay_reservar_cobro`.
- Definir `PAY_AVISOS_SECRET`. Vercel Cron envía `Authorization: Bearer <CRON_SECRET>`, así que `CRON_SECRET` tiene que tener el mismo valor.
- El cron de `vercel.json` (`/api/v1/avisos/procesar/`, `0 7 * * *`) corre una vez al día, que es lo que permite el plan Hobby. En Pro puede correr cada minuto, cambiando el horario. Entre cruces, los reintentos dependen de las peticiones a la API.
- Un cliente nuevo se crea con `scripts/cliente-api.mjs` contra la base de producción, y su clave se entrega por un canal privado.
