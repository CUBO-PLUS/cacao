# Base de datos de CacaoMarket

La base es un proyecto de Supabase con Postgres 17. Este documento lista las tablas, los tipos enumerados, quién puede leer cada una, las funciones que escriben y los códigos de error. Sale de las diez migraciones de `supabase/migrations/`, en el orden en que se aplican.

Tres reglas gobiernan el esquema:

- **Las sesiones solo leen.** Cada tabla tiene RLS activado. Las políticas dan `SELECT`, y no hay políticas de escritura. Las escrituras pasan por funciones.
- **Las funciones de escritura son `SECURITY DEFINER`** y solo las puede ejecutar `service_role`, que usa el servidor después de revisar la sesión. Tienen `set search_path = public`.
- **Los permisos son explícitos.** En un proyecto alojado, `anon` y `authenticated` no tienen nada por defecto. Cada permiso de lectura está escrito en una migración, y las columnas sensibles no tienen permiso.

## Migraciones

| Archivo | Qué hace |
|---|---|
| `20261012000001_esquema.sql` | Enums base, tablas de Market, RLS de lectura, políticas, trigger de perfil y bucket `productos`. |
| `20261012000002_funciones.sql` | Funciones de escritura de productos y órdenes, disputas, chat, negocios, perfil, avisos y la vista de circularidad. |
| `20261012000003_privilegios.sql` | Revoca todos los permisos de `anon` y `authenticated` y los da de nuevo, uno por uno. |
| `20261013000001_servicios_tipos.sql` | Valores nuevos de `estado_orden` y `resultado_disputa`, y los enums de servicios. |
| `20261013000002_servicios.sql` | Tablas de servicios, necesidades y cotizaciones; trabajos; funciones del tablón y de los trabajos. |
| `20261013000003_montos_con_separador.sql` | Los montos dentro de los avisos llevan separador de miles (`$2,100.00`). |
| `20261014000001_tipos.sql` | Valor `cancelado` de `estado_cobro` y los enums de Media y Pay. |
| `20261014000002_eventos.sql` | Tablas `eventos_permitidos` y `eventos`, y las funciones `registrar_evento` y `embudo`. Compartidas. |
| `20261014000003_media.sql` | Tablas y funciones de Cacao Media. |
| `20261014000004_cancelar_orden.sql` | El comprador cancela una orden de productos antes de pagar. Reemplaza `cancelar_orden`. |
| `20261014000005_pay.sql` | Tablas y funciones de CacaoPay. |
| `20261014000006_eventos_trabajos.sql` | Pasos del embudo de trabajos (`vio_pago_trabajo`, `pago_trabajo`). |
| `20261019000001_media_cerrado.sql` | Texto cerrado de las historias pagas de Cacao Media. |
| `20261019000002_clerk.sql` | Entrada con Clerk: `usuarios.clerk_id`, `vincular_clerk` y `usuario_actual()`. |
| `20261019000003_clerk_endurecer.sql` | Endurece el vínculo con Clerk. |
| `20261020000001_media_btcpay.sql` | Facturas Lightning reales de BTCPay para Cacao Media. |
| `20261020000002_pay_btcpay.sql` | CacaoPay: el envío se paga por Lightning con BTCPay. |
| `20261020000003_market_btcpay.sql` | Agrega `btcpay` a `tipo_proveedor` y la tienda de BTCPay por negocio (`btcpay_tienda_id`, sin permiso de lectura para sesiones). |
| `20261021000001_pay_cobro.sql` | CacaoPay: cobro de un envío con enlace. |
| `20261021000002_ledger.sql` | CacaoLedger en la web: tickets, correlativos y registro de sincronización con BTCPay. |
| `20261021000003_pay_destinatario.sql` | CacaoPay: el destinatario encuentra sus envíos; un envío pagado no se cancela. |
| `20261021000004_ledger_dte.sql` | CacaoLedger: documentos tributarios de tickets pagados. |
| `20261021000005_ledger_seguridad.sql` | CacaoLedger: correcciones de seguridad y de numeración. |
| `20261021000006_pay_seguridad.sql` | CacaoPay: reglas de seguridad del dinero. |
| `20261029000001_config_btcpay.sql` | La dirección pública de BTCPay se lee de la base en tiempo de ejecución. |
| `20261030000001_pay_devolucion.sql` | CacaoPay: devolución al remitente cuando nadie reclama un envío pagado. |
| `20261030000002_btcmap.sql` | Negocios de demostración: `negocios.btcmap_id` (un vendedor con id es un perfil de demostración). |
| `20261031000001_pay_api.sql` | CacaoPay: API de cobros (v1). Media, Travel y Market cobran por Pay. |
| `20261031000050_pay_avisos.sql` | CacaoPay: avisos en una cola durable (`pay_avisos`). |
| `20261101000001_pay_api_producto.sql` | CacaoPay: el producto de un cliente de la API queda ligado al cliente. |
| `20261101000002_pay_negocios.sql` | CacaoPay para negocios: cobros en mostrador, además de la API. |
| `20261102000001_ledger_api.sql` | API de CacaoLedger (v1) y los avisos de Pay a Ledger. |
| `20261103000001_pay_datos.sql` | CacaoPay: datos que el cliente guarda con su cobro para reconstruir su registro. Pay no los lee. |
| `20261104000001_ledger_atestaciones_contingencia.sql` | CacaoLedger: cadena de atestaciones de tasa, interruptor de contingencia simulado y estado de contingencia de un documento. Lo agregó otra sesión de trabajo sobre Ledger; no pertenece a la función de demostración. |
| `20261104000010_demo_entrega.sql` | `simular_entrega_demo`: el comprador de un pedido de un negocio de demostración lo pasa a `entregada`. |

Las migraciones que agregan valores a un enum (`alter type ... add value`) están en su propio archivo, y los valores se usan en uno posterior. Postgres no deja usar un valor nuevo en la misma transacción que lo agrega.

## Enums

| Tipo | Valores |
|---|---|
| `estado_negocio` | `pendiente`, `aprobado`, `suspendido` |
| `estado_orden` | `creada`, `esperando_pago`, `pagada`, `lista`, `entregada`, `cerrada`, `expirada`, `disputada`, `resuelta`, `acordada`, `hecha`, `cancelada` |
| `modo_entrega` | `recogida`, `entrega_vendedor` |
| `tipo_proveedor` | `manual`, `falso`, `nwc`, `blink`, `btcpay` |
| `estado_cobro` | `pendiente`, `pagado`, `expirado`, `cancelado` |
| `estado_disputa` | `abierta`, `resuelta` |
| `resultado_disputa` | `reembolso_total`, `reembolso_parcial`, `sin_reembolso`, `corresponde_pagar`, `no_corresponde_pagar` |
| `tipo_orden` | `productos`, `servicio` |
| `tipo_precio` | `fijo`, `cotizar` |
| `estado_necesidad` | `abierta`, `asignada`, `cancelada`, `vencida` |
| `estado_cotizacion` | `solicitada`, `ofrecida`, `aceptada`, `rechazada`, `retirada`, `vencida` |

Los enums de otras aplicaciones están en [la sección de tablas compartidas](#tablas-de-las-otras-aplicaciones).

## Tablas

### `usuarios`

Un perfil por cuenta de Auth. Lo crea el trigger `al_crear_usuario`.

| Columna | Tipo | Significado |
|---|---|---|
| `id` | uuid | Igual al id de `auth.users`. Clave primaria. |
| `telefono` | text | Único. Teléfono o correo de la cuenta. Ninguna sesión lo lee. |
| `nombre` | text | Nombre que se muestra. Hasta 80 caracteres. |
| `es_admin` | boolean | Administrador de la aplicación. |
| `creado_en` | timestamptz | Momento del alta. |

### `negocios`

Una tienda por cuenta. Vende productos y servicios.

| Columna | Tipo | Significado |
|---|---|---|
| `id` | uuid | Clave primaria. |
| `usuario_id` | uuid | Dueño. Único: una cuenta, un negocio. |
| `nombre` | text | Entre 2 y 80 caracteres. |
| `descripcion` | text | Hasta 600 caracteres. |
| `ubicacion` | text | Hasta 160 caracteres. |
| `estado` | `estado_negocio` | Nace `pendiente`. Solo un administrador lo cambia. |
| `abierto` | boolean | Si la tienda recibe pedidos. |
| `tipo_proveedor_pago` | `tipo_proveedor` | Cómo cobra. Nace `manual`. La aplicación no tiene forma de cambiarlo. El script de datos de prueba lo pone en `falso`. |
| `lightning_address` | text | Dirección `usuario@dominio` que valida la expresión regular de la tabla. |
| `credencial_pago_cifrada` | text | Reservada para los adaptadores `nwc` y `blink`. Ningún código la escribe. Nunca sale a una sesión. |
| `creado_en` | timestamptz | Momento del alta. |

### `categorias`

| Columna | Tipo | Significado |
|---|---|---|
| `id` | smallint | Identidad generada. |
| `nombre` | text | Único. |
| `orden` | smallint | Orden de aparición. |

### `productos`

| Columna | Tipo | Significado |
|---|---|---|
| `id` | uuid | Clave primaria. |
| `negocio_id` | uuid | Negocio que lo vende. Se borra con el negocio. |
| `categoria_id` | smallint | Categoría. |
| `nombre` | text | Entre 2 y 80 caracteres. |
| `descripcion` | text | Hasta 600 caracteres. |
| `unidad` | text | Qué es una unidad de stock: "libra", "docena", "bolsa de 1 libra". Entre 1 y 40 caracteres. |
| `precio_usd_centavos` | integer | Precio por unidad en centavos de dólar. Mayor que cero. |
| `stock` | integer | Unidades disponibles. Nunca negativo. |
| `activo` | boolean | Si está a la venta. Un producto inactivo no aparece en el catálogo. |
| `fotos` | text[] | URL públicas del bucket `productos`. |
| `creado_en` | timestamptz | Momento del alta. |

### `ordenes`

Una orden de productos o un trabajo. Comparten la tabla. Las columnas que solo aplican a un tipo quedan vacías en el otro.

| Columna | Tipo | Significado |
|---|---|---|
| `id` | uuid | Clave primaria. |
| `numero` | bigint | Número corto que se dice en voz alta ("orden 1042"). Identidad que empieza en 1001. Único. |
| `comprador_id` | uuid | Usuario que compra o contrata. |
| `negocio_id` | uuid | Negocio que vende o presta el servicio. |
| `estado` | `estado_orden` | Estado actual. Ver [arquitectura.md](arquitectura.md#ciclo-de-vida-de-una-orden). |
| `total_usd_centavos` | integer | Total en centavos. Mayor que cero. |
| `total_sats` | bigint | Total en sats. Mayor que cero. Se fija al crear un pedido de productos. En un trabajo es provisional hasta que se pide el pago, y ahí se vuelve a calcular con la cotización de ese momento. |
| `cotizacion_usd_btc` | numeric(14,2) | Dólares por bitcoin usados para convertir. Mayor que cero. |
| `modo_entrega` | `modo_entrega` | Obligatorio en productos. Vacío en trabajos. |
| `codigo_entrega` | text | Seis dígitos. Solo productos. Se genera al pagar. Sesiones no lo leen. |
| `comision_teorica_sats` | bigint | Comisión teórica del 1 % en sats, redondeada hacia arriba. Se guarda y se suma en el panel de administración. Ningún flujo la cobra. |
| `clave_idempotencia` | text | Clave que manda el navegador para no duplicar la orden. Sesiones no la leen. |
| `tipo` | `tipo_orden` | `productos` (por defecto) o `servicio`. |
| `creada_en`, `pagada_en`, `lista_en`, `entregada_en`, `cerrada_en`, `expirada_en`, `disputada_en`, `resuelta_en`, `hecha_en`, `cancelada_en` | timestamptz | Momento de cada transición. |
| `motivo_cancelacion` | text | Motivo de la cancelación de un trabajo o de un pedido. |

Reglas: `unique (comprador_id, clave_idempotencia)`. `ordenes_modo_entrega_de_productos`: un pedido de productos tiene modo de entrega. `ordenes_sin_codigo_de_servicio`: un trabajo no tiene código de entrega.

### `lineas_orden`

Copia de los productos o servicios de una orden. Como guarda el nombre y el precio, un cambio posterior en el producto no reescribe el historial.

| Columna | Tipo | Significado |
|---|---|---|
| `id` | uuid | Clave primaria. |
| `orden_id` | uuid | Orden. Se borra con la orden. |
| `producto_id` | uuid | Producto, si es una orden de productos. Vacío en trabajos. |
| `servicio_id` | uuid | Servicio, si es un trabajo de precio fijo o cotizado. |
| `nombre` | text | Nombre en el momento de la compra. |
| `unidad` | text | Unidad en el momento de la compra. En un trabajo de precio fijo, la unidad del servicio. En un trabajo nacido de una cotización, "trabajo". |
| `cantidad` | integer | Mayor que cero. |
| `precio_usd_centavos` | integer | Precio unitario en el momento de la compra. |

Regla: `lineas_orden_como_mucho_uno`. Una línea tiene como mucho un producto o un servicio. Un trabajo nacido de una necesidad no tiene ninguno: su necesidad se encuentra por `cotizaciones.orden_id`.

### `cobros`

Solicitud de pago de una orden. Hay como mucho una por orden (`orden_id` único). Un trabajo que vence y se vuelve a pedir reemplaza la fila.

| Columna | Tipo | Significado |
|---|---|---|
| `id` | uuid | Clave primaria. |
| `orden_id` | uuid | Orden. Único. |
| `proveedor` | `tipo_proveedor` | Adaptador que creó el cobro. |
| `referencia_externa` | text | Referencia del proveedor. Sesiones no la leen. |
| `bolt11` | text | Factura Lightning del monto exacto, si el proveedor la dio. |
| `destino` | text | Lightning Address del vendedor, cuando no hay factura. |
| `verificar_url` | text | URL LUD-21 para saber si la factura se pagó. Sesiones no la leen. |
| `estado` | `estado_cobro` | `pendiente`, `pagado`, `expirado` o `cancelado`. |
| `expira_en` | timestamptz | Hasta cuándo se puede pagar. |
| `pagado_en` | timestamptz | Momento del pago. |

### `mensajes`

| Columna | Tipo | Significado |
|---|---|---|
| `id` | uuid | Clave primaria. |
| `orden_id` | uuid | Orden del chat. |
| `autor_id` | uuid | Usuario que escribió. |
| `texto` | text | Entre 1 y 1000 caracteres. |
| `creado_en` | timestamptz | Momento del mensaje. |

### `resenas`

| Columna | Tipo | Significado |
|---|---|---|
| `id` | uuid | Clave primaria. |
| `orden_id` | uuid | Orden reseñada. Único: una reseña por orden. |
| `negocio_id` | uuid | Negocio reseñado. |
| `puntuacion` | smallint | De 1 a 5. |
| `comentario` | text | Hasta 600 caracteres. |
| `creada_en` | timestamptz | Momento de la reseña. |

### `disputas`

| Columna | Tipo | Significado |
|---|---|---|
| `id` | uuid | Clave primaria. |
| `orden_id` | uuid | Orden disputada. Único: una disputa por orden. |
| `motivo` | text | Entre 5 y 1000 caracteres. |
| `evidencia` | text | Hasta 2000 caracteres. |
| `estado` | `estado_disputa` | `abierta` o `resuelta`. |
| `resultado` | `resultado_disputa` | Resultado que decidió el administrador. |
| `nota_resolucion` | text | Nota del administrador. |
| `resuelta_por` | uuid | Administrador que resolvió. |
| `creada_en`, `resuelta_en` | timestamptz | Momento de apertura y de resolución. |
| `reembolso_marcado_en` | timestamptz | Cuándo el vendedor marcó el reembolso que hizo fuera de la aplicación. |
| `reembolso_confirmado_en` | timestamptz | Cuándo el comprador confirmó que lo recibió. |

### `avisos`

Notas dentro de la aplicación, para una persona.

| Columna | Tipo | Significado |
|---|---|---|
| `id` | uuid | Clave primaria. |
| `usuario_id` | uuid | Destinatario. |
| `tipo` | text | Tipo del aviso: `orden.pagada`, `mensaje`, `oferta.nueva`, etc. |
| `orden_id` | uuid | Orden relacionada, si la hay. |
| `texto` | text | Texto para la persona. |
| `leido` | boolean | Si ya lo vio. |
| `ruta` | text | Página a la que lleva el aviso cuando no hay orden. Hasta 300 caracteres. |
| `creado_en` | timestamptz | Momento del aviso. |

### `auditoria`

Registro de cambios de estado y de acciones administrativas. Solo lo lee un administrador.

| Columna | Tipo | Significado |
|---|---|---|
| `id` | bigint | Identidad generada. |
| `actor_id` | uuid | Usuario que hizo la acción. Vacío si la hizo el sistema. |
| `accion` | text | Por ejemplo `orden.pagada`, `negocio.aprobado`, `oferta.ofrecida`. |
| `entidad` | text | `orden`, `negocio`, `cotizacion`, `necesidad`, `servicio`. |
| `entidad_id` | text | Id de la entidad. |
| `detalle` | jsonb | Datos extra, por ejemplo `{desde, hacia}`. |
| `creado_en` | timestamptz | Momento del registro. |

### `categorias_servicio`

| Columna | Tipo | Significado |
|---|---|---|
| `id` | smallint | Identidad generada. |
| `nombre` | text | Único. |
| `orden` | smallint | Orden de aparición. |

### `servicios`

Un servicio que ofrece un negocio.

| Columna | Tipo | Significado |
|---|---|---|
| `id` | uuid | Clave primaria. |
| `negocio_id` | uuid | Negocio que lo ofrece. |
| `categoria_id` | smallint | Categoría de servicio. |
| `titulo` | text | Entre 2 y 80 caracteres. |
| `descripcion` | text | Hasta 600 caracteres. |
| `zona` | text | Zona donde se presta. Hasta 160 caracteres. |
| `tipo_precio` | `tipo_precio` | `fijo` (se contrata) o `cotizar` (se pide una cotización). |
| `precio_usd_centavos` | integer | Solo en `fijo`. |
| `unidad` | text | Solo en `fijo`, por ejemplo "corte". |
| `activo` | boolean | Si el negocio lo tiene publicado. |
| `oculto` | boolean | Si un administrador lo ocultó. El negocio no puede volver a mostrarlo. |
| `fotos` | text[] | URL de fotos. |
| `creado_en` | timestamptz | Momento del alta. |

Regla: `fijo` exige precio y unidad. `cotizar` no tiene precio ni unidad.

### `necesidades`

Lo que una persona busca, publicado en el tablón. Cualquier cuenta puede publicar.

| Columna | Tipo | Significado |
|---|---|---|
| `id` | uuid | Clave primaria. |
| `usuario_id` | uuid | Quien publica. |
| `categoria_id` | smallint | Categoría de servicio. |
| `titulo` | text | Entre 4 y 100 caracteres. |
| `descripcion` | text | Hasta 1000 caracteres. |
| `zona` | text | Hasta 160 caracteres. |
| `presupuesto_usd_centavos` | integer | Presupuesto opcional. Mayor que cero si existe. |
| `estado` | `estado_necesidad` | `abierta`, `asignada`, `cancelada` o `vencida`. |
| `oculta` | boolean | Si un administrador la ocultó. |
| `creada_en` | timestamptz | Momento de la publicación. |
| `vence_en` | timestamptz | Catorce días después de publicarla, por defecto. |

### `cotizaciones`

Una oferta de precio. Nace de dos caminos: un cliente pide precio de un servicio `cotizar`, o un negocio ofrece precio a una necesidad. Cada cotización tiene exactamente uno de los dos.

| Columna | Tipo | Significado |
|---|---|---|
| `id` | uuid | Clave primaria. |
| `negocio_id` | uuid | Negocio que responde u ofrece. |
| `cliente_id` | uuid | Quien pidió el precio o publicó la necesidad. |
| `servicio_id` | uuid | Servicio, si la cotización nació de un servicio. |
| `necesidad_id` | uuid | Necesidad, si la cotización nació de una necesidad. |
| `descripcion_cliente` | text | Descripción del trabajo que escribió el cliente. |
| `precio_usd_centavos` | integer | Precio que ofrece el negocio. |
| `mensaje` | text | Mensaje del negocio. Hasta 600 caracteres. |
| `estado` | `estado_cotizacion` | Estado de la oferta. |
| `orden_id` | uuid | Trabajo que nació al aceptarla. |
| `creada_en`, `respondida_en` | timestamptz | Momentos de creación y de respuesta. |

Reglas: `unique (necesidad_id, negocio_id)`, una oferta por negocio y necesidad. Una cotización `ofrecida` o `aceptada` tiene precio. Una `aceptada` tiene orden.

## Relaciones

- `usuarios` 1 a 0..1 `negocios` (por `negocios.usuario_id`).
- `negocios` 1 a N `productos`, `servicios` y `ordenes`.
- `productos` N a 1 `categorias`. `servicios` N a 1 `categorias_servicio`. `necesidades` N a 1 `categorias_servicio`.
- `ordenes` 1 a N `lineas_orden`, 1 a 0..1 `cobros`, 1 a N `mensajes`, 1 a 0..1 `resenas`, 1 a 0..1 `disputas`.
- `lineas_orden` N a 0..1 `productos`, y N a 0..1 `servicios`.
- `necesidades` 1 a N `cotizaciones`. `cotizaciones` N a 0..1 `servicios`, y N a 0..1 `ordenes` (la orden que nació al aceptar la cotización).
- `avisos` N a 1 `usuarios`, y N a 0..1 `ordenes`.
- `eventos` N a 0..1 `usuarios`, y N a 1 `eventos_permitidos`.

## Unicidad y verificaciones que importan

- `usuarios.telefono` único. Un teléfono, una cuenta.
- `negocios.usuario_id` único. `negocios.lightning_address` con formato `usuario@dominio.xx`, en minúsculas.
- `ordenes.numero` único. `ordenes (comprador_id, clave_idempotencia)` único: así una doble pulsación crea una sola orden.
- `cobros.orden_id` único, `resenas.orden_id` único y `disputas.orden_id` único: una por orden.
- `productos.stock >= 0` y `precio_usd_centavos > 0`.
- `ordenes.total_sats > 0` y `total_usd_centavos > 0`.
- `servicios`: el precio existe solo en el tipo `fijo`.
- `cotizaciones`: exactamente uno de `servicio_id` y `necesidad_id`, y `unique (necesidad_id, negocio_id)`.
- `eventos`: solo sitios `media`, `market` o `pay`. Un índice único por sitio, evento, sesión, objeto y hora.

## Quién lee cada tabla

Las sesiones (`anon` y `authenticated`) solo tienen `SELECT`. El servidor usa `service_role`, que tiene todo.

| Tabla | Quién puede leer filas | Columnas que una sesión no lee |
|---|---|---|
| `usuarios` | La propia cuenta, quien compró o vendió algo conmigo (para ver el nombre), y el administrador. | `telefono`. Lee solo `id`, `nombre`, `es_admin`, `creado_en`. |
| `negocios` | Cualquiera, si está aprobado. El dueño ve el suyo en cualquier estado. El administrador ve todos. | `credencial_pago_cifrada`. |
| `categorias`, `categorias_servicio` | Cualquiera. | Ninguna. |
| `productos` | Cualquiera, si está activo y el negocio está aprobado. El dueño ve los suyos. El administrador ve todos. | Ninguna. |
| `ordenes` | El comprador, el dueño del negocio y el administrador. | `codigo_entrega`, `clave_idempotencia`. |
| `lineas_orden`, `cobros`, `mensajes`, `disputas` | Quien puede ver la orden (comprador, vendedor o administrador). | En `cobros`: `referencia_externa` y `verificar_url`. |
| `resenas` | Cualquiera. | Ninguna. |
| `avisos` | Solo el destinatario. | Ninguna. |
| `auditoria` | Solo el administrador. | Ninguna. |
| `servicios` | Cualquiera, si está activo, no oculto y el negocio está aprobado. El dueño ve los suyos. El administrador ve todos. | Ninguna. |
| `necesidades` | Cualquiera, si está abierta y no oculta. El autor y el administrador ven todas. | Ninguna. |
| `cotizaciones` | El cliente, el dueño del negocio y el administrador. | Ninguna. |
| `eventos_permitidos`, `eventos`, `media_*`, `pay_*` | Nadie. Solo `service_role`. | No aplica. |

Las tablas de `ordenes`, `usuarios`, `negocios` y `cobros` tienen permisos por columna, no por tabla. Por eso una consulta de sesión que pide una columna prohibida falla. `select *` en esas tablas no funciona desde el navegador.

## Funciones

Todas las funciones de escritura se llaman con `service_role` desde `src/servidor/`. Ningún rol de sesión puede ejecutarlas (`revoke execute ... from public, anon, authenticated`). Los errores se lanzan como `CODIGO: frase en español`, con `errcode = 'P0001'`. Ver [códigos](#códigos-de-error).

### Ayudantes de las políticas

- `es_admin() returns boolean`: si el usuario de la sesión es administrador.
- `mi_negocio_id() returns uuid`: id del negocio del usuario de la sesión, o nulo.
- `puede_ver_orden(p_orden_id uuid) returns boolean`: si el usuario de la sesión es comprador, dueño del negocio o administrador.
- `crear_usuario() returns trigger`: trigger sobre `auth.users`. Crea la fila de `usuarios` con el teléfono, el correo o el id.

### Ayudantes privados

Ningún rol los ejecuta, ni siquiera `service_role`. Solo los llaman otras funciones.

- `_exigir_admin(p_actor uuid) returns void`: lanza `NO_PERMITIDO` si el actor no es administrador.
- `_rol_en_orden(p_orden ordenes, p_actor uuid) returns text`: `comprador`, `vendedor` o nulo.
- `_codigo_entrega() returns text`: seis dígitos aleatorios.
- `_texto_valido(p_texto text, p_min int, p_max int, p_mensaje text) returns text`: recorta el texto y revisa su largo.
- `_correo_lightning(p_direccion text) returns text`: normaliza y valida una Lightning Address. Vacía da nulo.
- `_usd_texto(p_centavos integer) returns text`: "$2,100.00".
- `_texto_aviso(p_estado estado_orden, p_numero bigint, p_para text) returns text`: texto del aviso de un pedido de productos, para `comprador` o `vendedor`.
- `_texto_aviso_servicio(p_tipo tipo_orden, p_estado estado_orden, p_numero bigint, p_para text) returns text`: texto del aviso, con los casos de trabajos y de pedidos cancelados.
- `_transicion_orden(p_orden uuid, p_actor uuid, p_desde estado_orden[], p_hacia estado_orden, p_ambas_partes boolean default false) returns ordenes`: la única forma de cambiar el estado de una orden. Bloquea la fila, revisa el estado de partida, pone la fecha de la transición, escribe una fila de auditoría y un aviso para la otra parte. Si `p_actor` es nulo, lo hizo el sistema. `p_ambas_partes` avisa a las dos partes.

### Órdenes y pagos

- `crear_orden(p_comprador uuid, p_negocio uuid, p_lineas jsonb, p_modo modo_entrega, p_clave text, p_cotizacion numeric, p_comision_bps integer default 100) returns ordenes`: crea un pedido de productos de una sola tienda, con hasta 50 líneas. Bloquea los productos en orden de id, revisa el stock, descuenta el stock, fija el total en sats (redondeado hacia arriba) y calcula la comisión. Si ya existe una orden con el mismo comprador y clave, la devuelve sin tocar el stock.
- `registrar_cobro(p_orden uuid, p_proveedor tipo_proveedor, p_referencia text, p_bolt11 text, p_destino text, p_verificar_url text, p_expira_en timestamptz) returns cobros`: guarda el cobro de una orden `creada` y la pasa a `esperando_pago`.
- `confirmar_pago(p_orden uuid, p_actor uuid) returns ordenes`: confirma el pago de un cobro pendiente. Con `p_actor` nulo lo hace el sistema. Con un actor, solo el vendedor. Lanza `FUERA_DE_PLAZO` si el cobro venció. En un trabajo, la orden pasa a `pagada` y, en la misma llamada, a `entregada`. En productos genera el código de entrega y pasa a `pagada`.
- `expirar_ordenes() returns integer`: vence los cobros pendientes que pasaron de plazo. Los pedidos de productos pasan a `expirada` y devuelven el stock. Los trabajos vuelven a `hecha`. Los pedidos `creada` sin cobro después de 10 minutos también expiran. Al final llama a `vencer_necesidades`. Devuelve cuántas órdenes movió.
- `marcar_lista(p_orden uuid, p_actor uuid) returns ordenes`: el vendedor pasa un pedido de `pagada` a `lista`.
- `marcar_entregada(p_orden uuid, p_actor uuid, p_codigo text) returns ordenes`: pasa de `lista` a `entregada`. El comprador no necesita código. El vendedor debe enviar el código de entrega, y se compara con el guardado.
- `simular_entrega_demo(p_orden uuid, p_actor uuid) returns ordenes`: solo el comprador, solo en un pedido de productos cuyo negocio tiene `btcmap_id`, y solo desde `pagada` o `lista`. Lo pasa a `entregada` sin código. Cualquier otro caso da `NO_PERMITIDO` o `ESTADO_INVALIDO`. Solo `service_role` la ejecuta.
- `cerrar_ordenes() returns integer`: pasa a `cerrada` las órdenes entregadas hace más de 48 horas que no tienen disputa.
- `crear_resena(p_orden uuid, p_actor uuid, p_puntuacion integer, p_comentario text) returns resenas`: el comprador deja una reseña, una sola, cuando la orden está `entregada` o `cerrada`. Si estaba `entregada`, la pasa a `cerrada`.
- `abrir_disputa(p_orden uuid, p_actor uuid, p_motivo text, p_evidencia text) returns disputas`: el comprador abre una disputa en `pagada`, `lista`, `entregada` (dentro de 48 horas) o `hecha` (en un trabajo). La orden pasa a `disputada`.
- `resolver_disputa(p_orden uuid, p_actor uuid, p_resultado resultado_disputa, p_nota text) returns disputas`: solo administrador. Un trabajo nunca pagado admite `corresponde_pagar` (vuelve a `hecha`) o `no_corresponde_pagar` (pasa a `cancelada`). Los demás admiten los tres resultados de dinero.
- `marcar_reembolso(p_orden uuid, p_actor uuid) returns disputas`: el vendedor marca que hizo el reembolso, fuera de la aplicación. Solo si el resultado es un reembolso.
- `confirmar_reembolso(p_orden uuid, p_actor uuid) returns disputas`: el comprador confirma que lo recibió.
- `enviar_mensaje(p_orden uuid, p_actor uuid, p_texto text) returns mensajes`: escribe en el chat de una orden en la que el actor es parte. Rechaza los trabajos cancelados. Avisa a la otra parte.
- `cancelar_orden(p_orden uuid, p_actor uuid, p_motivo text) returns ordenes`: en un pedido de productos, solo el comprador, antes de pagar. Marca el cobro como `cancelado` y devuelve el stock. En un trabajo `acordada`, cualquiera de las dos partes, y si nació de una necesidad que sigue vigente, la reabre.
- `registrar_cobro_servicio(p_orden uuid, p_proveedor tipo_proveedor, p_referencia text, p_bolt11 text, p_destino text, p_verificar_url text, p_expira_en timestamptz, p_cotizacion_btc numeric) returns cobros`: para un trabajo `hecha`. Recalcula los sats con la cotización que llega, reemplaza el cobro anterior y pasa el trabajo a `esperando_pago`.
- `marcar_hecha(p_orden uuid, p_actor uuid) returns ordenes`: el vendedor pasa un trabajo de `acordada` a `hecha`.

### Negocios, productos y perfil

- `solicitar_negocio(p_usuario uuid, p_nombre text, p_descripcion text, p_ubicacion text, p_lightning_address text) returns negocios`: registra el negocio de la cuenta. Nace `pendiente`. Una cuenta, un negocio.
- `actualizar_negocio(p_usuario uuid, p_nombre text, p_descripcion text, p_ubicacion text, p_lightning_address text, p_abierto boolean) returns negocios`: el dueño cambia sus datos y si la tienda está abierta. No cambia el estado.
- `cambiar_estado_negocio(p_negocio uuid, p_actor uuid, p_estado estado_negocio) returns negocios`: solo administrador. Aprueba, suspende o devuelve a pendiente. Avisa al dueño.
- `guardar_producto(p_usuario uuid, p_producto uuid, p_categoria integer, p_nombre text, p_descripcion text, p_unidad text, p_precio integer, p_stock integer, p_activo boolean, p_fotos text[]) returns productos`: crea un producto (si `p_producto` es nulo) o edita uno del propio negocio. Hasta 6 fotos.
- `actualizar_perfil(p_usuario uuid, p_nombre text) returns usuarios`: cambia el nombre de la cuenta.
- `marcar_avisos_leidos(p_usuario uuid) returns integer`: marca como leídos los avisos del usuario. Devuelve cuántos cambiaron.

### Servicios y tablón

- `guardar_servicio(p_usuario uuid, p_servicio uuid, p_categoria integer, p_titulo text, p_descripcion text, p_zona text, p_tipo_precio tipo_precio, p_precio integer, p_unidad text, p_activo boolean, p_fotos text[]) returns servicios`: crea o edita un servicio del negocio aprobado. Un servicio `cotizar` no guarda precio ni unidad.
- `ocultar_servicio(p_servicio uuid, p_actor uuid, p_oculto boolean) returns servicios`: solo administrador.
- `publicar_necesidad(p_usuario uuid, p_categoria integer, p_titulo text, p_descripcion text, p_zona text, p_presupuesto integer) returns necesidades`: publica una necesidad en el tablón.
- `cancelar_necesidad(p_necesidad uuid, p_usuario uuid) returns necesidades`: solo el autor, mientras está abierta. Rechaza las ofertas que quedaban.
- `ocultar_necesidad(p_necesidad uuid, p_actor uuid, p_oculta boolean) returns necesidades`: solo administrador.
- `vencer_necesidades() returns integer`: pasa a `vencida` las necesidades cuyo plazo venció y cierra sus ofertas abiertas. Lo llama `expirar_ordenes`.
- `solicitar_cotizacion(p_cliente uuid, p_servicio uuid, p_descripcion text) returns cotizaciones`: el cliente pide precio de un servicio `cotizar`. Avisa al negocio.
- `responder_cotizacion(p_cotizacion uuid, p_actor uuid, p_precio integer, p_mensaje text) returns cotizaciones`: el negocio responde con un precio.
- `ofertar(p_usuario uuid, p_necesidad uuid, p_precio integer, p_mensaje text) returns cotizaciones`: el negocio hace una oferta en una necesidad abierta. Si retiró una antes, la reutiliza.
- `retirar_cotizacion(p_cotizacion uuid, p_actor uuid) returns cotizaciones`: el negocio retira una oferta o una cotización que todavía no aceptaron.
- `rechazar_cotizacion(p_cotizacion uuid, p_actor uuid) returns cotizaciones`: el cliente rechaza una oferta o una cotización.
- `aceptar_cotizacion(p_cotizacion uuid, p_actor uuid, p_cotizacion_btc numeric) returns ordenes`: el cliente acepta. Nace un trabajo `acordada`. Si la oferta era de una necesidad, la necesidad pasa a `asignada` y las demás ofertas se rechazan.
- `contratar_servicio(p_cliente uuid, p_servicio uuid, p_nota text, p_clave text, p_cotizacion_btc numeric) returns ordenes`: el cliente contrata un servicio de precio fijo. Nace un trabajo `acordada`. La nota se guarda como primer mensaje del chat. Con la misma clave, devuelve el trabajo que ya existe.

### Eventos (compartidas)

- `registrar_evento(p_sitio text, p_nombre text, p_sesion text, p_usuario uuid, p_ruta text, p_objeto text, p_valor integer) returns void`: guarda un evento permitido. Si ya existe el mismo evento en la misma hora para la sesión y el objeto, no hace nada.
- `embudo(p_sitio text, p_desde timestamptz, p_hasta timestamptz) returns table (nombre, etiqueta, orden, sesiones, eventos, valor_usd_centavos)`: un renglón por paso del sitio, con sesiones distintas, eventos y valor, dentro del rango `[desde, hasta)`.

### Métricas

- `circularidad_red() returns table (sats_cobrados, sats_regastados, indice, negocios, negocios_que_compran, porcentaje)`: cuánto de lo cobrado por los negocios se gasta de nuevo dentro de la red. Solo `service_role`.
- Vista `circularidad_negocios (negocio_id, nombre, sats_cobrados, sats_regastados, indice)`: lo mismo, por negocio. Solo `service_role`. Cuenta las órdenes pagadas, listas, entregadas, cerradas y resueltas.

## Códigos de error

Cada error de una función lleva un código al principio del mensaje. La capa de servidor lo separa y lo entrega en `Resultado`. Ver [api.md](api.md#resultadot-y-códigos).

| Código | Cuándo aparece |
|---|---|
| `NO_ENCONTRADA` | La orden, el negocio, el producto o la cuenta no existen, o la persona no es parte de ellos. Se responde igual que si no existieran. |
| `NO_PERMITIDO` | La persona existe, pero su rol no permite la acción (por ejemplo, un comprador que quiere marcar una orden como lista). |
| `ESTADO_INVALIDO` | La orden o el registro no está en un estado que permita la acción. |
| `DATOS_INVALIDOS` | Un valor no cumple un largo, un rango o un formato. |
| `FUERA_DE_PLAZO` | Se pasó el plazo de pago, o de disputa (48 horas). |
| `SIN_STOCK` | Un producto no tiene unidades suficientes. |
| `NEGOCIO_CERRADO` | La tienda está cerrada o no aprobada. |
| `CODIGO_INCORRECTO` | El código de entrega que dio el vendedor no coincide. |

Las funciones usan también mensajes con otros códigos de la capa de servidor (`SIN_COTIZACION`, `NO_SESION`, etc.). Esos no vienen de la base: ver [api.md](api.md#resultadot-y-códigos).

## Tablas de las otras aplicaciones

Estas tablas están en el mismo proyecto de Supabase. Market no las usa, y su documentación está en cada aplicación. Ninguna sesión las lee.

- **Cacao Media** (`media_`): `media_lectores` (lectores anónimos), `media_cobros` (facturas simuladas por historia), `media_accesos` (acceso permanente por historia). Funciones: `media_lector`, `media_crear_cobro`, `media_pagar_cobro`, `media_fallar_cobro`, `media_vencer_cobros`, `media_resumen`. Enum: `media_estado_cobro` (`pendiente`, `pagada`, `vencida`, `fallida`).
- **CacaoPay** (`pay_`): `pay_tasas` (tasas de cambio), `pay_tarifas` (comisiones por forma de entrega), `pay_transferencias` (envíos), `pay_historial` (cambios de estado de cada envío). Funciones: `pay_crear_transferencia`, `pay_procesar`, `pay_completar`, `pay_fallar`, `pay_cancelar`, `pay_resumen`. Enums: `pay_estado`, `pay_moneda`, `pay_entrega`.
- **Compartidas:** `eventos_permitidos` y `eventos`, con las funciones `registrar_evento` y `embudo`. Ver [arquitectura.md](arquitectura.md#analítica-y-embudo).

## Agregar una migración

1. Creá el archivo con el nombre y la fecha de hoy:

   ```bash
   npx supabase migration new nombre_en_minusculas
   ```

2. Escribí el SQL en el archivo nuevo. Cada función nueva lleva `security definer`, `set search_path = public`, y sus permisos explícitos:

   ```sql
   revoke execute on function public.mi_funcion(uuid) from public, anon, authenticated;
   grant execute on function public.mi_funcion(uuid) to service_role;
   ```

   Si la migración agrega una tabla, también activá RLS y da solo los `SELECT` que hagan falta, con la lista de columnas.

3. Si agregás un valor a un enum, va en una migración propia, y el valor se usa en otra posterior.

4. Aplicá la migración en local:

   ```bash
   npx supabase migration up
   ```

5. Para el proyecto alojado, enlazá la carpeta con el proyecto una vez, y después aplicá las migraciones pendientes. El comando pide la contraseña de la base de datos: escribila en la terminal y no la pongas en ningún archivo ni comando.

   ```bash
   npx supabase link --project-ref <REFERENCIA_DEL_PROYECTO>
   npx supabase db push
   ```

   `<REFERENCIA_DEL_PROYECTO>` es el identificador del proyecto en el panel de Supabase.

Un proyecto alojado no tiene permisos por defecto. Si una función o tabla nueva no tiene su `grant`, la aplicación falla con un error de permisos, aunque en local funcione.
