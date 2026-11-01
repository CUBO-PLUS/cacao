# API de CacaoMarket

CacaoMarket tiene pocos endpoints HTTP. La mayoría de las operaciones son acciones de servidor (`'use server'`), que Next llama desde los formularios y los botones. Este documento describe las dos cosas: primero las rutas HTTP, después la capa de servidor que usan esas acciones, las acciones por pantalla y el formato de respuesta común.

Para el modelo de datos ver [base-de-datos.md](base-de-datos.md). Para la regla de escritura y las sesiones ver [arquitectura.md](arquitectura.md).

## Rutas HTTP

Hay cuatro route handlers. Todos viven en `src/app`.

| Método | Ruta | Archivo | Quién la llama |
|---|---|---|---|
| POST | `/api/fotos` | `src/app/api/fotos/route.ts` | Formularios de producto y de servicio, con sesión y negocio. |
| POST | `/api/evento` | `src/app/api/evento/route.ts` | Cualquier visitante. Lo llama el navegador al ver un producto o agregarlo al carrito. |
| POST | `/api/pagos/btcpay` | `src/app/api/pagos/btcpay/route.ts` | BTCPay Server, con la cabecera `btcpay-sig`. |
| POST | `/api/pagos/pay` | `src/app/api/pagos/pay/route.ts` | CacaoPay, con la cabecera `Cacao-Firma`. |

Las respuestas de error de `/api/fotos` tienen forma JSON: `{ "codigo": "...", "mensaje": "..." }`. Las de `/api/evento` no tienen cuerpo.

### `POST /api/fotos`

Sube una foto de producto o de servicio al bucket `productos`.

**Quién puede llamarla:** una sesión iniciada con un negocio registrado. El estado del negocio no importa (puede estar pendiente).

**Petición:** `multipart/form-data` con un solo campo.

| Campo | Tipo | Límites |
|---|---|---|
| `foto` | archivo | Obligatorio. No vacío. Hasta 3 MB (3 × 1024 × 1024 bytes). Solo JPEG, PNG o WebP, revisados por los primeros bytes del archivo. |

**Respuestas:**

| Estado | Cuándo | Cuerpo |
|---|---|---|
| 200 | La foto se guardó. | `{ "url": "<URL pública>" }` |
| 400 | No llegó el formulario, falta el campo `foto` o el archivo está vacío. | `{ "codigo": "DATOS_INVALIDOS", "mensaje": "Elegí una foto para subir." }` |
| 401 | No hay sesión. | `{ "codigo": "NO_AUTORIZADO", "mensaje": "Entrá a tu cuenta para subir fotos." }` |
| 403 | La sesión no tiene negocio. | `{ "codigo": "NO_PERMITIDO", "mensaje": "Primero tenés que registrar tu negocio." }` |
| 413 | La foto pesa más de 3 MB. | `{ "codigo": "DATOS_INVALIDOS", "mensaje": "La foto pesa más de 3 MB. Probá con una más chica." }` |
| 415 | El contenido no es JPEG, PNG ni WebP. | `{ "codigo": "DATOS_INVALIDOS", "mensaje": "Solo podés subir fotos en JPG, PNG o WebP." }` |
| 500 | Storage no aceptó el archivo. | `{ "codigo": "ERROR", "mensaje": "No pudimos guardar la foto. Probá de nuevo en un momento." }` |

La ruta del archivo es `<negocio_id>/<uuid aleatorio>.<jpg|png|webp>`. El servidor no revisa cuántas fotos tiene el producto: eso lo hace `guardar_producto` al guardar.

**Ejemplo.** Con la cookie de sesión del navegador:

```bash
curl -X POST http://localhost:4323/api/fotos \
  -H "Cookie: <cookies de sesión>" \
  -F "foto=@tomate.jpg"
```

Respuesta (200):

```json
{
  "url": "http://127.0.0.1:54321/storage/v1/object/public/productos/5b1e0c7a-3d2f-4e8b-9a61-0f7c2d4e9b13/c8a4f2d1-6e3b-4a7f-b9d0-2e5a1c8f7b64.jpg"
}
```

### `POST /api/evento`

Registra un evento del embudo que ve el navegador. Solo acepta dos eventos.

**Quién puede llamarla:** cualquier visitante. No necesita sesión.

**Petición:** JSON.

| Campo | Tipo | Límites |
|---|---|---|
| `nombre` | string | `vista_producto` o `agrego_carrito`. Cualquier otro valor da 400. |
| `objeto` | string | Id de un producto. Debe ser un UUID. |
| `ruta` | string | Empieza con `/`. Hasta 260 caracteres. Solo se guarda la parte antes de `?`, hasta 200 caracteres. |

**Respuestas:**

| Estado | Cuándo | Cuerpo |
|---|---|---|
| 204 | El evento se registró, o ya existía en esta hora. No revela cuál de los dos casos fue. | Vacío. |
| 400 | Cuerpo que no es JSON, campos inválidos o `ruta` que no empieza con `/`. | Vacío. |

Si el visitante no tiene cookie `cm_sesion`, la respuesta incluye una cookie nueva (`HttpOnly`, `SameSite=lax`, un año).

**Ejemplo:**

```http
POST /api/evento HTTP/1.1
Content-Type: application/json

{"nombre":"vista_producto","objeto":"0b6c1e3a-2f4d-4c8e-9a1b-7d5e6f708192","ruta":"/productos/0b6c1e3a-2f4d-4c8e-9a1b-7d5e6f708192"}
```

```http
HTTP/1.1 204 No Content
Set-Cookie: cm_sesion=<valor>; Path=/; Max-Age=31536000; HttpOnly; SameSite=lax
```

El `Set-Cookie` solo aparece la primera vez que el navegador envía un evento.

### `POST /api/pagos/btcpay`

Aviso de BTCPay Server por cada evento de una tienda. Solo `InvoiceSettled` cuenta. La firma (`btcpay-sig`, HMAC-SHA256 del cuerpo crudo con `BTCPAY_WEBHOOK_SECRET`) solo prueba que BTCPay envió el cuerpo: la factura se vuelve a leer en BTCPay antes de pagar, y si está `Settled` se confirma con `confirmarPagoEnBD`.

| Respuesta | Cuándo |
|---|---|
| 200 | Pagado ahora, o ya resuelto (`ESTADO_INVALIDO` o `FUERA_DE_PLAZO`), o un evento que no hace nada, o una factura que no es de Market. |
| 400 | El cuerpo no es un aviso válido. |
| 401 | La firma no coincide. |
| 503 | Falta `BTCPAY_URL` o `BTCPAY_API_KEY`. |
| 500 | La base no pudo leer el cobro, o `confirmar_pago` falló por otra causa. BTCPay vuelve a enviar. |
| 502 | BTCPay no respondió al leer la factura. BTCPay vuelve a enviar. |

### `POST /api/pagos/pay`

Aviso de CacaoPay sobre un cobro de un cliente de Market. La firma (`Cacao-Firma`: `t=<segundos>,v1=<hex>`, HMAC-SHA256 de `t.cuerpo` con `CACAO_PAY_AVISO_SECRET`, con menos de cinco minutos) es obligatoria; la cabecera `Cacao-Aviso-Id` debe coincidir con el cuerpo. El cobro se vuelve a leer en CacaoPay antes de pagar, y los avisos repetidos se ignoran.

| Respuesta | Cuándo |
|---|---|
| 200 | Procesado, o ya resuelto. |
| 400 | El aviso no coincide o no es válido. |
| 401 | La firma no es válida. |
| 502 | CacaoPay o la base no respondieron. CacaoPay vuelve a enviar. |
| 503 | Falta `CACAO_PAY_URL`, `CACAO_PAY_API_KEY` o `CACAO_PAY_AVISO_SECRET`. |

### Acceso con Clerk

No hay ruta propia para confirmar el acceso. `/entrar` y `/registrarse` muestran los componentes `SignIn` y `SignUp` de `@clerk/nextjs`. Clerk se encarga del código y del enlace, y `sesionActual` lee la sesión con `auth()`. El parámetro `volver` pasa por `destinoSeguro` antes de redirigir.

## Capa de servidor

Todo lo que escribe en la base pasa por `src/servidor/`. Esta capa es interna: la usan las páginas, las acciones y las rutas, no un cliente externo. Todos los archivos tienen `import 'server-only'`, salvo `resultado.ts`, que importan también los componentes de cliente para leer el tipo `Resultado`.

Convenciones que se aplican en todas las tablas:

- **Escrituras:** devuelven `Resultado<T>` (ver [la última sección](#resultadot-y-códigos)). Las funciones de escritura llaman a un `rpc` con `clienteServicio()`.
- **Lecturas:** devuelven los datos y lanzan `Error` si la consulta falla. La página muestra la pantalla de error de Next.
- **"Quién la llama":** dice qué pantalla o acción la usa. "Sesión" significa que la función lee con el cliente del visitante y RLS. "Servicio" significa que usa `clienteServicio()` y filtra por dueño en el código.

### `admin.ts`

Lecturas y acciones del panel de administración. Antes de cada lectura, `exigirAdminBD(actorId)` consulta `usuarios.es_admin` con la clave de servicio, y responde con `notFound()` (404) a quien no es administrador. Las acciones de escritura devuelven `NO_PERMITIDO` en ese caso.

| Función | Qué hace | Quién la llama | Códigos |
|---|---|---|---|
| `inicioDeHoy(ahora?: Date): string` | Medianoche de hoy en El Salvador, como instante. | Páginas de `/admin` (pura). | Ninguno. |
| `paginaDesde(valor?: string): number` | Página pedida en la URL, desde 1. | Páginas de `/admin/ordenes`. | Ninguno. |
| `estadoDesde(valor?: string): EstadoOrden \| null` | Estado pedido en la URL, o nulo si no es válido. | `/admin/ordenes`. | Ninguno. |
| `resumenAdmin(actorId: string): Promise<ResumenAdmin>` | Cifras del panel: negocios pendientes, disputas abiertas, órdenes de hoy, pagos esperando, comisión y circularidad. | `/admin`. | Lanza `Error`. |
| `negociosAdmin(actorId: string): Promise<NegocioAdmin[]>` | Todos los negocios, con su estado y su dueño. | `/admin/negocios`. | Lanza `Error`. |
| `cambiarEstadoNegocio(actorId, negocioId, estado: 'aprobado' \| 'suspendido'): Promise<Resultado<null>>` | Aprueba o suspende un negocio (función `cambiar_estado_negocio`). | `cambiarEstadoNegocioAccion`. | `NO_ENCONTRADA`, `NO_PERMITIDO`, y los de la función SQL. |
| `ordenesAdmin(actorId, filtro: { pagina, estado, tipo? }): Promise<PaginaOrdenes>` | Órdenes paginadas (50 por página), con filtro de estado y de tipo. | `/admin/ordenes`. | Lanza `Error`. |
| `trabajosSinPagar(actorId): Promise<TrabajoSinPagar[]>` | Trabajos hechos que todavía no se pagaron. | `/admin/ordenes`. | Lanza `Error`. |
| `ordenDetalleAdmin(actorId, ordenId): Promise<DetalleOrdenAdmin \| null>` | Una orden completa, con líneas, cobro, mensajes, disputa y auditoría. | `/admin/ordenes/[id]`. | Lanza `Error`. Nulo si no existe. |
| `resolverDisputa(actorId, ordenId, resultado: ResultadoDisputa, nota: string): Promise<Resultado<null>>` | Resuelve una disputa (función `resolver_disputa`). Valida que el resultado sea posible para esa orden. | `resolverDisputaAccion`. | `NO_ENCONTRADA`, `DATOS_INVALIDOS` (resultado desconocido o no posible para la orden), `NO_PERMITIDO`, `ESTADO_INVALIDO`. |
| `disputasAdmin(actorId): Promise<DisputaAdmin[]>` | Disputas, abiertas primero. | `/admin/disputas`. | Lanza `Error`. |
| `serviciosAdmin(actorId): Promise<ServicioAdmin[]>` | Todos los servicios, incluidos los ocultos. | `/admin/servicios`. | Lanza `Error`. |
| `necesidadesAdmin(actorId): Promise<NecesidadAdmin[]>` | Todas las necesidades del tablón, incluidas las ocultas. | `/admin/servicios`. | Lanza `Error`. |
| `ocultarServicio(actorId, servicioId, oculto: boolean): Promise<Resultado<null>>` | Oculta o muestra un servicio (función `ocultar_servicio`). | `ocultarServicioAccion`. | `NO_ENCONTRADA`, `NO_PERMITIDO`, `DATOS_INVALIDOS`. |
| `ocultarNecesidad(actorId, necesidadId, oculta: boolean): Promise<Resultado<null>>` | Oculta o muestra una necesidad (función `ocultar_necesidad`). | `ocultarNecesidadAccion`. | `NO_ENCONTRADA`, `NO_PERMITIDO`, `DATOS_INVALIDOS`. |
| `auditoriaAdmin(actorId): Promise<FilaAuditoria[]>` | Últimos registros de la auditoría. | `/admin/auditoria`. | Lanza `Error`. |
| `embudoAdmin(actorId, desde: string, hasta: string): Promise<PasoEmbudo[]>` | Pasos del embudo de Market en el rango (función `embudo`). | `/admin/embudo`. | Lanza `Error`. |

### `avisos.ts`

Avisos dentro de la aplicación, para la persona que ingresó.

| Función | Qué hace | Quién la llama | Códigos |
|---|---|---|---|
| `misAvisos(usuarioId: string, limite: number): Promise<Aviso[]>` | Avisos no leídos, del más nuevo al más viejo. El límite va de 1 a 50. | `/ordenes`. Sesión. | Lanza `Error`. |
| `contarNoLeidos(usuarioId: string): Promise<number>` | Cuántos avisos no leídos hay. Si la consulta falla, devuelve 0 y registra el error. | `InsigniaAvisos` (barra inferior). Sesión. | Ninguno. |
| `marcarLeidos(usuarioId: string): Promise<Resultado<number>>` | Marca todos los avisos como leídos (función `marcar_avisos_leidos`). Devuelve cuántos cambiaron. | `marcarAvisosLeidos`. | `NO_ENCONTRADA` (id que no es UUID), y los de la base. |

### `catalogo.ts`

Lecturas públicas del catálogo de productos. Usan el cliente del visitante, así que RLS filtra lo que no se puede ver: solo productos activos de negocios aprobados.

| Función | Qué hace | Quién la llama | Códigos |
|---|---|---|---|
| `categorias(): Promise<Categoria[]>` | Categorías de productos, en orden. | Filtros del catálogo y formularios. Público. | Lanza `Error`. |
| `productosDelCatalogo(filtro: { texto?, categoriaId?, negocioId? }): Promise<ProductoCatalogo[]>` | Hasta 120 productos, los más nuevos primero. El texto se limpia de caracteres de patrón y se corta a 80. | `/`, `/negocios/[id]`. Público. | Lanza `Error`. |
| `productoPorId(id: string): Promise<ProductoDetalle \| null>` | Ficha de un producto. Nulo si no existe o no se ve. | `/productos/[id]`. Público. | Lanza `Error`. |
| `negocioPorId(id: string): Promise<NegocioDetalle \| null>` | Negocio con sus productos y su promedio de reseñas. | `/negocios/[id]`. Público. | Lanza `Error`. |
| `resenasDeNegocio(id: string): Promise<Resena[]>` | Últimas 20 reseñas de un negocio. | `/negocios/[id]`. Público. | Lanza `Error`. |
| `cotizacionSegura(): Promise<number \| null>` | Precio del bitcoin en USD, o nulo si ninguna fuente responde. No lanza. | Páginas que muestran USD y sats. | Ninguno. |

### `cotizaciones.ts`

Cotizaciones y ofertas. Las lecturas usan la clave de servicio y filtran por cliente o por negocio en la consulta.

| Función | Qué hace | Quién la llama | Códigos |
|---|---|---|---|
| `misCotizacionesComoCliente(usuarioId: string): Promise<Cotizacion[]>` | Cotizaciones del cliente, hasta 100. Servicio, filtrado por `cliente_id`. | `/cotizaciones`. | Lanza `Error`. |
| `cotizacionesDelNegocio(negocioId: string): Promise<Cotizacion[]>` | Cotizaciones del negocio, hasta 100. Servicio, filtrado por `negocio_id`. | `/mi-negocio/cotizaciones`, `/mi-negocio`. | Lanza `Error`. |
| `cotizacionPara(usuario: { id }, cotizacionId: string): Promise<CotizacionParaUsuario \| null>` | Una cotización con el rol del usuario (`cliente` o `vendedor`). Nula si no es parte. | Sin uso en las páginas actuales. | Lanza `Error`. |
| `solicitarCotizacion(usuarioId, datos: { servicioId, descripcion }): Promise<Resultado<{ id }>>` | El cliente pide precio de un servicio `cotizar`. La descripción tiene de 10 a 1000 caracteres. | `servicios/[id]` (acción `cotizarAccion`). | `DATOS_INVALIDOS`, y los de `solicitar_cotizacion`. |
| `responderCotizacion(usuarioId, cotizacionId, datos: { precioUsdCentavos, mensaje }): Promise<Resultado<{ id }>>` | El negocio responde con un precio y un mensaje. | `responderCotizacionAccion` (mi-negocio). | `DATOS_INVALIDOS`, y los de `responder_cotizacion`. |
| `ofertar(usuarioId, necesidadId, datos: { precioUsdCentavos, mensaje }): Promise<Resultado<{ id }>>` | El negocio hace una oferta en una necesidad. | `ofertarAccion`. | `DATOS_INVALIDOS`, y los de `ofertar`. |
| `retirarCotizacion(usuarioId, cotizacionId): Promise<Resultado<{ id }>>` | El negocio retira una oferta o cotización. | `retirarCotizacionAccion` (cotizaciones y mi-negocio). | `NO_ENCONTRADA`, `NO_PERMITIDO`, `ESTADO_INVALIDO`. |
| `rechazarCotizacion(usuarioId, cotizacionId): Promise<Resultado<{ id }>>` | El cliente rechaza una oferta o cotización. | `rechazarCotizacionAccion`. | `NO_ENCONTRADA`, `NO_PERMITIDO`, `ESTADO_INVALIDO`. |
| `aceptarCotizacion(usuarioId, cotizacionId): Promise<Resultado<{ ordenId }>>` | El cliente acepta. Toma el precio del bitcoin, y la base crea el trabajo en `acordada`. | `aceptarCotizacionAccion`. | `SIN_COTIZACION`, `NO_ENCONTRADA`, `NO_PERMITIDO`, `ESTADO_INVALIDO`, `NEGOCIO_CERRADO`. |

### `cuentas.ts`

Cuentas, perfiles y negocios. Las funciones `normalizarCelular`, `normalizarCorreo`, `destinoSeguro` y `rutaCuenta` son puras.

| Función | Qué hace | Quién la llama | Códigos |
|---|---|---|---|
| `normalizarCelular(texto: string): string \| null` | Ocho dígitos. Acepta espacios, guiones y el prefijo `+503` o `503`. Si no sirve, nulo. | Ninguno desde el ingreso con Clerk. | Ninguno. |
| `normalizarCorreo(texto: string): string \| null` | Correo en minúsculas, de hasta 254 caracteres. Si no parece un correo, nulo. | Ninguno desde el ingreso con Clerk. | Ninguno. |
| `destinoSeguro(volver): string` | Solo acepta rutas del propio sitio. Si no, `/`. Rechaza `/entrar`. | `entrar`, `registrarse`, `cuenta`. | Ninguno. |
| `rutaCuenta(volver: string): string` | `/cuenta` con el destino en `volver`. | `entrar`. | Ninguno. |
| `actualizarPerfil(usuarioId, nombre): Promise<Resultado<{ nombre }>>` | Cambia el nombre de la cuenta (2 a 80 caracteres). | `guardarNombre` (`/cuenta`). | `DATOS_INVALIDOS`, `NO_ENCONTRADA`, y los de `actualizar_perfil`. |
| `solicitarNegocio(usuarioId, datos: DatosNegocio): Promise<Resultado<Negocio>>` | Registra el negocio. Nace pendiente. | `solicitar` (`/mi-negocio`). | `DATOS_INVALIDOS` (nombre, descripción, ubicación, Lightning Address), y los de `solicitar_negocio`. |
| `actualizarNegocio(usuarioId, datos: DatosNegocio & { abierto }): Promise<Resultado<Negocio>>` | Edita el negocio. No cambia el estado. | `actualizar` (`/mi-negocio`). | `DATOS_INVALIDOS`, y los de `actualizar_negocio`. |
| `cambiarAbierto(usuarioId, abierto: boolean): Promise<Resultado<Negocio>>` | Abre o cierra la tienda, sin tocar el resto de los datos. | `alternarAbierto` (`/mi-negocio`). | `NO_ENCONTRADA`, `DATOS_INVALIDOS`, y los de `actualizar_negocio`. |
| `miNegocio(usuarioId): Promise<Resultado<Negocio \| null>>` | El negocio del usuario, o nulo si no tiene. Sesión (RLS). | `/mi-negocio`, acciones de mi-negocio. | `NO_ENCONTRADA` (id que no es UUID), `ERROR`. |

### `disputas.ts`

| Función | Qué hace | Quién la llama | Códigos |
|---|---|---|---|
| `abrirDisputa(ordenId, usuarioId, motivo, evidencia): Promise<Resultado<null>>` | El comprador abre una disputa. Motivo de 10 a 1000 caracteres; evidencia de hasta 1000. | `abrirDisputaComprador` (orden). | `NO_ENCONTRADA`, `DATOS_INVALIDOS`, y los de `abrir_disputa`. |
| `marcarReembolso(ordenId, usuarioId): Promise<Resultado<null>>` | El vendedor marca el reembolso que pagó fuera de la app. | `marcarReembolsoVendedor`. | `NO_ENCONTRADA`, y los de `marcar_reembolso`. |
| `confirmarReembolso(ordenId, usuarioId): Promise<Resultado<null>>` | El comprador confirma que recibió el reembolso. | `confirmarReembolsoComprador`. | `NO_ENCONTRADA`, y los de `confirmar_reembolso`. |

### `eventos.ts`

Analítica del embudo. Nunca lanzan: un fallo se registra en la consola y la compra sigue.

| Función | Qué hace | Quién la llama | Códigos |
|---|---|---|---|
| `registrarEvento(evento: EventoARegistrar): Promise<void>` | Llama a `registrar_evento` con el sitio `market`. | Acciones y páginas que registran un paso del embudo. | Ninguno. |
| `sesionDeVisita(): Promise<string \| null>` | Lee la cookie `cm_sesion` si existe y tiene formato válido. No escribe cookies, así que es segura en componentes de servidor. | `/ordenes/[id]/pagar` (paso `vio_pago`). | Ninguno. |
| `sesionDeVisitaCreando(): Promise<string>` | Lee la cookie o crea una nueva. Escribe cookies, así que solo se usa en acciones y route handlers. | `/api/evento`, `crearPedido`. | Ninguno. |
| `sesionDePago(sesion: string \| null, ordenId: string): string` | La sesión de un pago. Si no hay cookie, usa `orden-<id>`. | `confirmarPagoEnBD`. | Ninguno. |

### `mantenimiento.ts`

| Función | Qué hace | Quién la llama | Códigos |
|---|---|---|---|
| `barrer(): Promise<void>` | Llama a `expirar_ordenes` y `cerrar_ordenes`. Registra los errores y nunca lanza. | `misCompras`, `ventasDe`, `detalleDeOrden`, `estadoDePago`. | Ninguno. |

### `mensajes.ts`

| Función | Qué hace | Quién la llama | Códigos |
|---|---|---|---|
| `mensajesDe(ordenId, sesion: Sesion): Promise<Mensaje[] \| null>` | Los últimos 200 mensajes de la orden, del más viejo al más nuevo. Nulo si el usuario no es parte. | `/ordenes/[id]`. | Lanza `Error`. |
| `enviarMensaje(ordenId, usuarioId, texto): Promise<Resultado<Mensaje>>` | Escribe un mensaje de 1 a 1000 caracteres. Una orden `expirada` queda en solo lectura en la capa de servidor. | `enviarMensajeAccion`. | `NO_ENCONTRADA`, `DATOS_INVALIDOS`, `ESTADO_INVALIDO` (orden expirada), y los de `enviar_mensaje`. |

### `necesidades.ts`

El tablón. Las funciones que reciben un cliente (`leer...`) existen para que las pruebas y las páginas usen el mismo código.

| Función | Qué hace | Quién la llama | Códigos |
|---|---|---|---|
| `nombresDeUsuarios(ids: string[]): Promise<Map<string, string>>` | Nombres de usuarios, sin teléfono. Servicio. | Páginas del tablón. | Lanza `Error`. |
| `tablon(filtro: { categoriaId? }): Promise<Necesidad[]>` | Necesidades abiertas y no ocultas, hasta 60, de la más nueva a la más vieja. | `/necesito`. Sesión. | Lanza `Error`. |
| `leerTablon(db, filtro): Promise<Necesidad[]>` | Lo mismo, con un cliente dado. | `tablon`. | Lanza `Error`. |
| `necesidadPublica(id): Promise<Necesidad \| null>` | Una necesidad pública. Nula si no existe o no es visible. | `/necesito/[id]`. | Lanza `Error`. |
| `leerNecesidadPublica(db, id): Promise<Necesidad \| null>` | Lo mismo, con un cliente dado. | `necesidadPublica`. | Lanza `Error`. |
| `necesidadParaUsuario(necesidadId, usuario: { id }): Promise<NecesidadParaUsuario \| null>` | La necesidad con lo que puede hacer quien pregunta: el autor ve todas las ofertas, y un negocio aprobado ve su propia oferta. Servicio, con las reglas en el código. | `/necesito/[id]`. | Lanza `Error`. |
| `misNecesidades(usuarioId): Promise<Necesidad[]>` | Todas las necesidades de la cuenta, en cualquier estado. Servicio. | `/cotizaciones`. | Lanza `Error`. |
| `publicarNecesidad(usuarioId, datos: DatosNecesidad): Promise<Resultado<{ id }>>` | Publica una necesidad (título de 4 a 100, descripción de hasta 1000, presupuesto opcional). | `publicarNecesidadAccion`. | `DATOS_INVALIDOS`, y los de `publicar_necesidad`. |
| `cancelarNecesidad(usuarioId, necesidadId): Promise<Resultado<{ id }>>` | El autor cancela una necesidad abierta. | `cancelarNecesidadAccion`. | `DATOS_INVALIDOS`, y los de `cancelar_necesidad`. |

### `ordenes.ts`

| Función | Qué hace | Quién la llama | Códigos |
|---|---|---|---|
| `crearPedido(usuarioId, entrada: unknown): Promise<Resultado<{ ordenId }>>` | Valida el carrito (UUID, de 1 a 50 líneas, cantidades de 1 a 99, modo de entrega, clave de hasta 100 caracteres), toma el precio del bitcoin, llama a `crear_orden` y, si la orden está `creada`, pide el cobro. Registra `inicio_pedido`. Si el cobro falla, la orden queda `creada` y la pantalla de pago lo reintenta. | `hacerPedido` (`/carrito`). | `DATOS_INVALIDOS`, `SIN_COTIZACION`, y los de `crear_orden`. |
| `revisarCarrito(entrada: unknown): Promise<Resultado<RevisionCarrito>>` | Nombre, precio, stock y disponibilidad de los productos del carrito, y el precio del bitcoin. Las líneas inválidas se omiten sin bloquear las demás. Público. | `revisarCarrito` (acción) y `CarritoCliente`. | `DATOS_INVALIDOS` (si el carrito no es una lista). |

### `pagos.ts`

Los cobros. Detalle en [pagos.md](pagos.md).

| Función | Qué hace | Quién la llama | Códigos |
|---|---|---|---|
| `confirmarPagoEnBD(ordenId, actorId \| null, sesion \| null): Promise<{ message } \| null>` | Llama a `confirmar_pago` y registra el evento `pago` si la orden es de productos. Devuelve el error de la base sin convertirlo, para que el llamador decida. | `confirmarPagoManual`, `estadoDePago`, `simularPago`. | Ninguno propio. |
| `asegurarCobro(ordenId): Promise<Resultado<null>>` | Crea el cobro de una orden `creada`, o de un trabajo `hecha` con la cotización del momento. Si ya hay un cobro vigente, no hace nada. | `crearPedido`, `reintentarCobro`, `reiniciarCobro`, `/ordenes/[id]/pagar`. | `NO_ENCONTRADA`, `ESTADO_INVALIDO`, `SIN_COTIZACION`, `SIN_DIRECCION`, `NO_DISPONIBLE`, `ERROR`, y los de `registrar_cobro` y `registrar_cobro_servicio`. |
| `estadoDePago(ordenId, usuarioId): Promise<Resultado<EstadoPago>>` | Estado de la orden para la pantalla de pago. Antes de contestar, llama a `barrer()`. Si el cobro es verificable y la factura se pagó, confirma el pago. Solo el comprador recibe respuesta. | `estadoDePagoAccion` (la pantalla lo llama cada 3 segundos). | `NO_ENCONTRADA` (también para quien no es el comprador), y `ERROR`. |
| `reintentarCobro(ordenId, usuarioId): Promise<Resultado<EstadoPago>>` | Si la orden está `creada`, crea el cobro que faltaba y devuelve el estado. | `reintentarCobroAccion`. | `NO_ENCONTRADA`, y los de `asegurarCobro`. |
| `reiniciarCobro(ordenId, usuarioId): Promise<Resultado<EstadoPago>>` | Solo para trabajos `hecha` (cuando venció la solicitud). Pide una solicitud nueva con la cotización actual. | `reiniciarCobroAccion`. | `NO_ENCONTRADA`, y los de `asegurarCobro`. |
| `simularPago(ordenId, usuarioId): Promise<Resultado<null>>` | Demostración: confirma el pago de una orden cuyo cobro es del proveedor `falso`. Cualquier otro proveedor da `NO_PERMITIDO`. | `simularPagoAccion`. | `NO_ENCONTRADA`, `NO_PERMITIDO`, y los de `confirmar_pago`. |

### `pedidos.ts`

Órdenes, desde los dos lados de la transacción. Las lecturas usan la sesión y RLS, salvo que se indique lo contrario.

| Función | Qué hace | Quién la llama | Códigos |
|---|---|---|---|
| `esUuid(valor: string): boolean` | Revisa si un valor es UUID. | Varias. | Ninguno. |
| `largo(texto: string): number` | Largo en caracteres (no en unidades de código), como cuenta la base. | Varias. | Ninguno. |
| `misCompras(usuarioId): Promise<ResumenOrden[]>` | Las compras del usuario, hasta 500, de la más nueva a la más vieja. Llama a `barrer()`. | `/ordenes`. Sesión. | Lanza `Error`. |
| `ventasDe(negocioId): Promise<ResumenOrden[]>` | Las ventas del negocio, hasta 500. Llama a `barrer()`. | `/mi-negocio/ordenes`. Sesión. | Lanza `Error`. |
| `cobradoHoy(negocioId): Promise<{ sats, usdCentavos, cantidad }>` | Lo cobrado hoy: órdenes con `pagada_en` desde medianoche de El Salvador. | `/mi-negocio/ordenes`. Sesión. | Lanza `Error`. |
| `accesoAOrden(ordenId, sesion: Sesion): Promise<RolOrden \| null>` | El rol del usuario en la orden (`comprador` o `vendedor`), o nulo. | Usada por `mensajesDe`. | Lanza `Error`. |
| `detalleDeOrden(ordenId, sesion: Sesion): Promise<DetalleOrden \| null>` | Detalle completo para las partes. Llama a `barrer()`. Si el comprador consulta un pedido de productos `pagada` o `lista`, lee el código de entrega con servicio. | `/ordenes/[id]`, `/ordenes/[id]/recibo`. | Lanza `Error`. Nulo si no es parte. |
| `paraAcciones(detalle: DetalleOrden): OrdenParaAcciones` | Los datos con los que se decide qué botones se ven. Pura. | Páginas de orden. | Ninguno. |
| `ejecutarRpc(llamada): Promise<Resultado<null>>` | Convierte el error de un `rpc` en `Resultado`. | Acciones de transición. | Los de la base, por `desdeError`. |
| `confirmarPagoManual(ordenId, usuarioId): Promise<Resultado<null>>` | El vendedor confirma un pago manual. | `confirmarPago` (acción). | `NO_ENCONTRADA`, y los de `confirmar_pago`. |
| `marcarLista(ordenId, usuarioId): Promise<Resultado<null>>` | El vendedor marca el pedido como lista. | `marcarOrdenLista`. | `NO_ENCONTRADA`, y los de `marcar_lista`. |
| `marcarHecha(ordenId, usuarioId): Promise<Resultado<null>>` | El vendedor marca el trabajo como hecho. | `marcarTrabajoHecho`. | `NO_ENCONTRADA`, y los de `marcar_hecha`. |
| `cancelarOrden(ordenId, usuarioId, motivo): Promise<Resultado<null>>` | Cancela un trabajo acordado (cualquiera) o un pedido antes de pagar (el comprador). El motivo tiene de 4 a 300 caracteres. | `cancelarTrabajo`, `cancelarPedido`. | `NO_ENCONTRADA`, `DATOS_INVALIDOS`, y los de `cancelar_orden`. |
| `referenciaDeCobro(ordenId): Promise<string \| null>` | Referencia del proveedor, para el recibo. Servicio. Solo después de revisar el rol. | `/ordenes/[id]/recibo`. | Lanza `Error`. |
| `marcarEntregada(ordenId, usuarioId): Promise<Resultado<null>>` | El comprador confirma que recibió el pedido. | `confirmarEntregaComprador`. | `NO_ENCONTRADA`, y los de `marcar_entregada`. |
| `simularEntregaDemo(ordenId, usuarioId): Promise<Resultado<null>>` | El comprador simula la entrega de un pedido de un negocio de demostración. | `simularEntregaDeDemo`. | `NO_ENCONTRADA`, `NO_PERMITIDO` (no es el comprador, o el negocio no es de demostración), `ESTADO_INVALIDO` (no está pagado ni listo). |
| `entregarConCodigo(ordenId, usuarioId, codigo): Promise<Resultado<null>>` | El vendedor confirma la entrega con los seis dígitos. Ignora los espacios. | `entregarConCodigoVendedor`. | `CODIGO_INCORRECTO` (formato), `NO_ENCONTRADA`, y los de `marcar_entregada` (código que no coincide). |
| `crearResena(ordenId, usuarioId, puntuacion, comentario): Promise<Resultado<null>>` | El comprador deja una reseña. Puntuación de 1 a 5; comentario de hasta 500 caracteres en la capa de servidor (la base permite 600). | `enviarResena`. | `DATOS_INVALIDOS`, `NO_ENCONTRADA`, y los de `crear_resena`. |

### `productos.ts`

Productos del negocio. Las lecturas usan la clave de servicio y filtran por negocio, porque el dueño también necesita ver los productos pausados, que RLS no le muestra al público.

| Función | Qué hace | Quién la llama | Códigos |
|---|---|---|---|
| `categorias()` | Reexportación de `catalogo.ts`. | Formularios de producto. | Lanza `Error`. |
| `misProductos(negocioId): Promise<ProductoMio[]>` | Todos los productos del negocio: activos primero, luego por nombre. Servicio. | `/mi-negocio/productos`. | Lanza `Error`. |
| `miProducto(negocioId, productoId): Promise<ProductoMio \| null>` | Un producto del negocio. Nulo si es de otro negocio. Servicio. | `/mi-negocio/productos/[id]`. | Lanza `Error`. |
| `guardarProducto(usuarioId, datos: DatosProducto): Promise<Resultado<{ id }>>` | Crea o edita un producto. Revisa precio (hasta $10,000.00), stock (hasta 100,000), categoría y fotos (hasta 4, de bucket propio o de `/productos/`). Revalida el catálogo. | `guardarProductoAccion`. | `NO_PERMITIDO` (sin negocio), `DATOS_INVALIDOS`, `NO_ENCONTRADA`, y los de `guardar_producto`. |
| `cambiarStock(usuarioId, productoId, stock): Promise<Resultado<{ stock }>>` | Cambia solo el stock. Lee el producto y lo vuelve a guardar con los demás datos iguales. | `cambiarStockAccion`. | `DATOS_INVALIDOS`, `NO_PERMITIDO`, `NO_ENCONTRADA`, y los de `guardar_producto`. |
| `cambiarActivo(usuarioId, productoId, activo): Promise<Resultado<{ activo }>>` | Pausa o activa un producto. Mismo mecanismo que `cambiarStock`. | `cambiarActivoAccion`. | `DATOS_INVALIDOS`, `NO_PERMITIDO`, `NO_ENCONTRADA`, y los de `guardar_producto`. |

### `resultado.ts`

| Función | Qué hace |
|---|---|
| `exito<T>(dato: T): Resultado<T>` | Devuelve `{ ok: true, dato }`. |
| `fallo(codigo: string, mensaje: string): Resultado<never>` | Devuelve `{ ok: false, codigo, mensaje }`. |
| `desdeError(error: unknown): Resultado<never>` | Convierte un error de la base o del servidor en `Resultado`. Si el texto tiene la forma `CODIGO: frase`, usa el código y la frase. Si no, devuelve `ERROR` con una frase genérica y registra el detalle en la consola. |

### `servicios.ts`

Servicios publicados. El catálogo usa el cliente del visitante. Las listas del negocio usan la clave de servicio, filtradas por negocio.

| Función | Qué hace | Quién la llama | Códigos |
|---|---|---|---|
| `categoriasServicio(): Promise<CategoriaServicio[]>` | Categorías de servicios. | Formularios y filtros. Público. | Lanza `Error`. |
| `leerCatalogo(db, filtro: { busqueda?, categoriaId? }): Promise<ServicioCatalogo[]>` | Servicios visibles, con búsqueda y categoría. | `catalogoServicios`. | Lanza `Error`. |
| `catalogoServicios(filtro): Promise<ServicioCatalogo[]>` | Lo mismo, con el cliente del visitante. | `/servicios`. Público. | Lanza `Error`. |
| `leerServicioPublico(db, id): Promise<ServicioDetalle \| null>` | Ficha de un servicio con sus reseñas. | `servicioPublico`. | Lanza `Error`. |
| `servicioPublico(id): Promise<ServicioDetalle \| null>` | Lo mismo, con el cliente del visitante. | `/servicios/[id]`. Público. | Lanza `Error`. |
| `misServicios(negocioId): Promise<ServicioMio[]>` | Todos los servicios del negocio. Servicio. | `/mi-negocio/servicios`. | Lanza `Error`. |
| `miServicio(negocioId, servicioId): Promise<ServicioMio \| null>` | Un servicio del negocio. Servicio. | `/mi-negocio/servicios/[id]`. | Lanza `Error`. |
| `guardarServicio(usuarioId, datos: DatosServicio): Promise<Resultado<{ id }>>` | Crea o edita un servicio. El negocio debe estar aprobado. Revisa título, descripción, zona, categoría, precio (de $0.01 a $10,000.00) y unidad. Acepta una sola foto. | `guardarServicioAccion`. | `DATOS_INVALIDOS`, y los de `guardar_servicio`. |
| `cambiarActivoServicio(usuarioId, servicioId, activo): Promise<Resultado<{ activo }>>` | Pausa o activa un servicio. | `cambiarActivoServicioAccion`. | `DATOS_INVALIDOS`, `NO_PERMITIDO`, `NO_ENCONTRADA`, y los de `guardar_servicio`. |
| `contratarServicio(usuarioId, datos: { servicioId, nota, clave }): Promise<Resultado<{ ordenId }>>` | Contrata un servicio de precio fijo. Toma el precio del bitcoin, y la base crea el trabajo en `acordada`. La clave se combina con el id del servicio. | `contratarAccion` (`/servicios/[id]`). | `DATOS_INVALIDOS`, `SIN_COTIZACION`, y los de `contratar_servicio`. |

### `sesion.ts`

| Función | Qué hace | Quién la llama |
|---|---|---|
| `sesionActual(): Promise<Sesion \| null>` | Usuario, admin y negocio del visitante. Valida el token con Auth. Una lectura por petición (`cache()`). | Casi todas las páginas y acciones. |
| `exigirSesion(volver?): Promise<Sesion>` | Si no hay sesión, redirige a `/entrar?volver=...`. | Páginas que piden sesión. |
| `exigirVendedor(volver?): Promise<SesionVendedor>` | Como `exigirSesion`, y además redirige a `/mi-negocio` si no hay negocio. | Páginas de vendedor. |
| `exigirAdmin(): Promise<Sesion>` | Si no es administrador, responde 404 con `notFound()`. | Páginas de `/admin`. |

### `supabase.ts`

| Función | Qué hace | Quién la llama |
|---|---|---|
| `clienteSesion()` | Cliente de Supabase con las cookies del visitante. RLS aplica. Llama a `connection()`, así que solo funciona dentro de una petición. | Lecturas de sesión y de público. |
| `clienteServicio()` | Cliente con la clave de servicio. Sin RLS. Desactiva la deduplicación de GET de Next. | Escrituras (`rpc`) y lecturas de servicio, siempre después de revisar la sesión o el rol. |

## Acciones de servidor por pantalla

Cada acción vive en un `acciones.ts` de su pantalla. Todas revisan la sesión primero (`sesionActual`, `exigirSesion` o `exigirAdmin`), y después llaman a una función de `src/servidor/`. Las que devuelven `Resultado` lo hacen; las que devuelven `EstadoAccion` (formularios con `useActionState`) convierten el error en un mensaje.

| Pantalla | Archivo | Acción | Llama a |
|---|---|---|---|
| Carrito | `src/app/carrito/acciones.ts` | `revisarCarrito(lineas)` | `revisarCarrito` (público). |
| Carrito | | `hacerPedido(entrada)` | `sesionActual` → `crearPedido` → `crear_orden`, `registrar_cobro`. |
| Entrar | `src/app/entrar/page.tsx` | Componente `SignIn` de Clerk | `sesionActual` (si ya hay sesión, redirige). |
| Cuenta | `src/app/cuenta/acciones.ts` | `guardarNombre(previo, datos)` | `exigirSesion` → `actualizarPerfil` → `actualizar_perfil`. |
| Cuenta | | `cerrarSesion()` | Cierra la sesión solo en este navegador (`signOut` con `scope: 'local'`). |
| Mi negocio | `src/app/mi-negocio/acciones.ts` | `solicitar(previo, datos)` | `exigirSesion` → `solicitarNegocio` → `solicitar_negocio`. |
| Mi negocio | | `actualizar(previo, datos)` | `exigirSesion` → `miNegocio` y `actualizarNegocio` → `actualizar_negocio`. |
| Mi negocio | | `alternarAbierto(previo, datos)` | `exigirSesion` → `cambiarAbierto` → `actualizar_negocio`. |
| Productos | `src/app/mi-negocio/productos/acciones.ts` | `guardarProductoAccion(datos)` | `sesionActual` → `guardarProducto` → `guardar_producto`. |
| Productos | | `cambiarStockAccion(productoId, stock)` | `cambiarStock` → `guardar_producto`. |
| Productos | | `cambiarActivoAccion(productoId, activo)` | `cambiarActivo` → `guardar_producto`. |
| Servicios | `src/app/mi-negocio/servicios/acciones.ts` | `guardarServicioAccion(previo, datos)` | `sesionActual` → `guardarServicio` → `guardar_servicio`. |
| Servicios | | `cambiarActivoServicioAccion(servicioId, activo)` | `cambiarActivoServicio` → `guardar_servicio`. |
| Cotizaciones (negocio) | `src/app/mi-negocio/cotizaciones/acciones.ts` | `responderCotizacionAccion(previo, datos)` | `sesionActual` → `responderCotizacion` → `responder_cotizacion`. |
| Cotizaciones (negocio) | | `retirarCotizacionAccion(previo, cotizacionId)` | `retirarCotizacion` → `retirar_cotizacion`. |
| Cotizaciones (cliente) | `src/app/cotizaciones/acciones.ts` | `aceptarCotizacionAccion(previo, datos)` | `sesionActual` → `aceptarCotizacion` → `aceptar_cotizacion`. Redirige a la orden. |
| Cotizaciones (cliente) | | `rechazarCotizacionAccion(previo, datos)` | `rechazarCotizacion` → `rechazar_cotizacion`. |
| Cotizaciones (cliente) | | `retirarCotizacionAccion(previo, datos)` | `retirarCotizacion` → `retirar_cotizacion`. |
| Tablón | `src/app/necesito/acciones.ts` | `publicarNecesidadAccion(previo, datos)` | `sesionActual` → `publicarNecesidad` → `publicar_necesidad`. |
| Tablón | | `ofertarAccion(previo, datos)` | `ofertar` → `ofertar` (SQL). |
| Tablón | | `cancelarNecesidadAccion(previo, datos)` | `cancelarNecesidad` → `cancelar_necesidad`. |
| Servicio | `src/app/servicios/[id]/acciones.ts` | `contratarAccion(previo, datos)` | `contratarServicio` → `contratar_servicio`. Redirige a la orden. |
| Servicio | | `cotizarAccion(previo, datos)` | `solicitarCotizacion` → `solicitar_cotizacion`. Redirige a `/cotizaciones`. |
| Orden | `src/app/ordenes/[id]/acciones.ts` | `confirmarPago(ordenId)` | `transicion` → `confirmarPagoManual` → `confirmar_pago`. |
| Orden | | `marcarOrdenLista(ordenId)` | `marcarLista` → `marcar_lista`. |
| Orden | | `marcarTrabajoHecho(ordenId)` | `marcarHecha` → `marcar_hecha`. |
| Orden | | `cancelarTrabajo(ordenId, motivo)` | `cancelarOrden` → `cancelar_orden`. |
| Orden | | `cancelarPedido(ordenId, motivo)` | `cancelarOrden` → `cancelar_orden`. |
| Orden | | `confirmarEntregaComprador(ordenId)` | `marcarEntregada` → `marcar_entregada`. |
| Orden | | `simularEntregaDeDemo(ordenId)` | `simularEntregaDemo` → `simular_entrega_demo`. Solo el botón "Simular entrega" de un pedido de demostración. |
| Orden | | `entregarConCodigoVendedor(ordenId, codigo)` | `entregarConCodigo` → `marcar_entregada`. |
| Orden | | `enviarResena(ordenId, puntuacion, comentario)` | `crearResena` → `crear_resena`. |
| Orden | | `abrirDisputaComprador(ordenId, motivo, evidencia)` | `abrirDisputa` → `abrir_disputa`. |
| Orden | | `marcarReembolsoVendedor(ordenId)` | `marcarReembolso` → `marcar_reembolso`. |
| Orden | | `confirmarReembolsoComprador(ordenId)` | `confirmarReembolso` → `confirmar_reembolso`. |
| Orden | | `enviarMensajeAccion(ordenId, texto)` | `enviarMensaje` → `enviar_mensaje`. |
| Pago | `src/app/ordenes/[id]/pagar/acciones.ts` | `estadoDePagoAccion(ordenId)` | `estadoDePago` (llama a `barrer`, consulta el proveedor y, si corresponde, `confirmar_pago`). |
| Pago | | `reintentarCobroAccion(ordenId)` | `reintentarCobro` → `asegurarCobro` → `registrar_cobro`. |
| Pago | | `reiniciarCobroAccion(ordenId)` | `reiniciarCobro` → `asegurarCobro` → `registrar_cobro_servicio`. |
| Pago | | `simularPagoAccion(ordenId)` | `simularPago` → `confirmar_pago` (solo proveedor `falso`). |
| Avisos | `src/app/ordenes/acciones.ts` | `marcarAvisosLeidos()` | `sesionActual` → `marcarLeidos` → `marcar_avisos_leidos`. |
| Administración | `src/app/admin/acciones.ts` | `cambiarEstadoNegocioAccion(previo, datos)` | `exigirAdmin` → `cambiarEstadoNegocio` → `cambiar_estado_negocio`. |
| Administración | | `resolverDisputaAccion(previo, datos)` | `exigirAdmin` → `resolverDisputa` → `resolver_disputa`. |
| Administración | | `ocultarServicioAccion(previo, datos)` | `exigirAdmin` → `ocultarServicio` → `ocultar_servicio`. |
| Administración | | `ocultarNecesidadAccion(previo, datos)` | `exigirAdmin` → `ocultarNecesidad` → `ocultar_necesidad`. |

Los campos de los formularios (`FormData`) se leen con el nombre del campo en el formulario, por ejemplo `negocio` y `estado` en `cambiarEstadoNegocioAccion`, o `orden`, `resultado` y `nota` en `resolverDisputaAccion`. Los valores se validan antes de la base, con la misma regla que la función SQL.

## `Resultado<T>` y códigos

Toda función de escritura devuelve:

```ts
type Resultado<T> = { ok: true; dato: T } | { ok: false; codigo: string; mensaje: string };
```

`mensaje` es la frase en español que la base escribió después de los dos puntos del error (`CODIGO: frase`). La pantalla la muestra tal cual. Un error que no tiene esa forma se convierte en `ERROR`, con una frase genérica, y el detalle queda en el registro del servidor.

| Código | Origen | Significado |
|---|---|---|
| `NO_ENCONTRADA` | Base y servidor | El objeto no existe, o la persona no es parte de él. Se responde igual en los dos casos. |
| `NO_PERMITIDO` | Base y servidor | El rol de la persona no permite la acción. Por ejemplo, un comprador que quiere marcar una orden como lista, o un negocio sin registrar. |
| `ESTADO_INVALIDO` | Base y servidor | El objeto no está en un estado que permita la acción. |
| `DATOS_INVALIDOS` | Base y servidor | Un valor no cumple un largo, un rango, un formato o una lista de opciones. |
| `FUERA_DE_PLAZO` | Base | Se pasó el plazo de pago, o la ventana de 48 horas para disputar. |
| `SIN_STOCK` | Base | No hay unidades suficientes de un producto. |
| `NEGOCIO_CERRADO` | Base | La tienda está cerrada (`abierto = false`) o no está aprobada. |
| `CODIGO_INCORRECTO` | Base y servidor | El código de entrega no tiene seis dígitos o no coincide. |
| `SIN_COTIZACION` | Servidor | No se pudo obtener el precio del bitcoin. Ninguna orden nueva se crea sin precio. |
| `SIN_DIRECCION` | Servidor | El negocio no tiene una Lightning Address válida para cobrar. |
| `NO_DISPONIBLE` | Servidor | El proveedor de cobro (`nwc` o `blink`) todavía no tiene adaptador. |
| `NO_SESION`, `SIN_SESION` | Servidor | La acción se llamó sin sesión. Se pide volver a entrar. |
| `NO_AUTORIZADO` | Route handler | `/api/fotos` sin sesión (401). |
| `ERROR` | Servidor | Falla inesperada. El detalle queda en el registro del servidor. |

Las funciones de lectura no usan `Resultado`. Lanzan `Error` y la página muestra la pantalla de error. Las excepciones son `contarNoLeidos` (devuelve 0), `cotizacionSegura` (devuelve nulo), `registrarEvento` (no lanza nunca) y `barrer` (registra el error y sigue).
