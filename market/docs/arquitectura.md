# Arquitectura de CacaoMarket

Este documento describe cómo están armadas las capas de CacaoMarket, por qué están así y cuáles son sus límites conocidos. Los nombres de archivos, funciones y tablas son los del código. La referencia de la base está en [base-de-datos.md](base-de-datos.md), las rutas y funciones de servidor en [api.md](api.md), y el diseño de los cobros en [pagos.md](pagos.md).

## Capas y la regla de escritura

La regla que define todo lo demás: **el navegador nunca escribe en la base de datos.** Toda escritura sigue el mismo camino:

1. Una acción de servidor (`acciones.ts`) o un route handler recibe la petición y revisa la sesión.
2. La acción llama a una función de `src/servidor/`, que es la única capa que habla con la base.
3. Esa función llama a una función de Postgres con `rpc`, usando la clave de servicio (`service_role`).
4. La función de Postgres valida el rol y el estado, cambia las filas, escribe la auditoría y los avisos, y devuelve el resultado.

Las lecturas tienen dos caminos. La mayoría de las páginas públicas y de las pantallas de la sesión leen con el cliente del visitante (clave anónima más sus cookies), y Postgres aplica las políticas de filas (RLS). Otras lecturas usan la clave de servicio, siempre después de revisar la sesión o el rol en el código, y filtran por dueño en la consulta: los paneles de administración, las listas del propio negocio (productos, servicios, cotizaciones y ofertas), los nombres de la otra parte en una orden (que deben verse aunque la tienda esté suspendida) y el código de entrega. Las políticas de RLS solo permiten `SELECT`. Como no hay políticas de `INSERT`, `UPDATE` ni `DELETE`, una sesión no puede escribir aunque lo intente con la API.

```
  +----------------------------+          +------------------------------+
  | Navegador                  |   HTTP   | Servidor Next (market)       |
  | - páginas React            |<-------->| - páginas y componentes      |
  | - Realtime y sondeo        |          | - acciones de servidor       |
  | - solo SELECT, con RLS     |          | - route handlers             |
  +-------------+--------------+          | - src/servidor/ (escribe)    |
                |                         +--------------+---------------+
                | WebSocket (Realtime)                   |
                | y SELECT con la sesión                 | rpc con service_role
                |                                        | (solo despues de
                v                                        |  revisar la sesión)
  +-------------+----------------------------------------v---------------+
  | Supabase                                                             |
  |   Postgres   tablas con RLS, funciones SECURITY DEFINER              |
  |   Auth       teléfono y correo, sesiones en cookies                  |
  |   Realtime   publica cambios de ordenes, mensajes, avisos y cobros   |
  |   Storage    bucket "productos" con las fotos (lectura pública)      |
  +------------------------------------+---------------------------------+
                                       |
                                       | Cobros, solo desde el servidor:    |
                                       | CacaoPay o BTCPay, y LNURL-pay     |
                                       | (LUD-21) a la Lightning Address    |
                                       v
                       +------------------------------------+
                       | Proveedores de cobro               |
                       | CacaoPay (API de cobros, Pay)      |
                       | BTCPay Server (tienda del negocio) |
                       | Lightning Address del vendedor     |
                       +------------------------------------+
```

Las fuentes de precio del bitcoin (Coinbase y Kraken) se consultan también desde el servidor, en `src/lib/precio/fuente.ts`.

Hay dos excepciones que conviene conocer. La primera: el navegador lee directamente en el chat (`mensajes`, cada 10 segundos) con el cliente del navegador, siempre con la sesión y con RLS. La segunda: las fotos se suben por un route handler (`/api/fotos`), no desde el navegador hacia Storage.

## Renderizado

El proyecto usa Next 16 con `cacheComponents: true` (en `next.config.ts`). Las páginas se prerenderizan como una cáscara estática: el encabezado, la navegación y los textos fijos. Todo lo que depende de la petición (cookies, la sesión, los parámetros de búsqueda y la base) va dentro de un `<Suspense>`. Su `fallback` forma parte de la cáscara y el contenido llega en la petición, por streaming. Por eso `params` y `searchParams` son Promesas que se esperan en el componente que los necesita.

Las funciones que leen cookies o el reloj llaman a `connection()` antes de leer, para que Next no las trate como contenido prerenderizable. Es el caso de `clienteSesion()` en `src/servidor/supabase.ts`. El proyecto no usa `'use cache'`: cada petición lee la base. Lo que cambia tras una escritura se refresca con `revalidatePath` en la misma acción (por ejemplo, `transicion` en `ordenes/[id]/acciones.ts` o `revalidarCatalogo` en `servidor/productos.ts`).

## Entrar y sesión

**Entrada con Clerk.** `/entrar` y `/registrarse` muestran los componentes `<SignIn />` y `<SignUp />` de `@clerk/nextjs`, con enrutamiento por ruta. Supabase ya no tiene su propio login: es solo la base. El cliente de Supabase recibe el token de sesión de Clerk (`accessToken`), así que RLS aplica con `public.usuario_actual()`, que compara el claim `sub` con `usuarios.clerk_id`.

**Sesión en el servidor.** `src/proxy.ts` corre `clerkMiddleware()` antes de cada petición y nunca redirige. `sesionActual()` (en `src/servidor/sesion.ts`) lee `auth()` de Clerk. Si hay usuario, llama a la función `vincular_clerk` con el service role, que crea o enlaza la fila de `usuarios` por teléfono o correo, y después lee `usuarios` y `negocios`. El teléfono y el correo salen del usuario de Clerk, no de una tabla. Está envuelta en `cache()`, así que se resuelve una vez por petición.

**Salir.** `BotonSalir` (en `src/app/cuenta`) llama a `signOut` de Clerk desde el cliente. `exigirSesion(volver)`, `exigirVendedor` y `exigirAdmin` redirigen o responden igual que antes.

**Navegador.** `SesionNavegador` entrega el token de Clerk al cliente de Supabase del navegador (`src/lib/supabase-navegador.ts`). Ese cliente lo usa para leer y para Realtime: `canalEnVivo.ts` fija el token antes de suscribirse y lo renueva cada 50 segundos.

## Tiempo real y sondeo

Supabase Realtime publica los cambios de `ordenes`, `mensajes`, `avisos` y `cobros` (la publicación `supabase_realtime`, en la primera migración). Hay tres usos:

- **Chat** (`ordenes/[id]/Chat.tsx`): escucha los `INSERT` de `mensajes` de la orden, agrega el mensaje sin recargar, y cuando cambia la orden (`UPDATE` en `ordenes`) o llega un aviso de la orden que no es de chat, refresca la página con `router.refresh()`. Como respaldo, lee los mensajes nuevos cada 10 segundos.
- **Pantalla de pago** (`ordenes/[id]/pagar/PagoCliente.tsx`): llama a `estadoDePagoAccion` cada 3 segundos mientras la pestaña esté visible, y al volver a mostrarla. Ese llamado también puede confirmar el pago (ver [pagos.md](pagos.md)). Además escucha `UPDATE` de la orden, y cada cambio dispara una lectura nueva. La decisión queda en el servidor.
- **Aviso en la barra** (`avisos`): el contador de no leídos se calcula al cargar la página. No es en vivo.

**Por qué el socket necesita el token.** Realtime solo entrega las filas que el usuario puede leer si el socket lleva su token. Cuando la página abre con la sesión en cookies, el cliente del navegador no lo envía, y los cambios llegarían como anónimos (y RLS los filtraría). `clienteEnVivo()` en `ordenes/[id]/canalEnVivo.ts` pasa el `access_token` al socket antes de unirse al canal, y lo vuelve a pasar en cada cambio de sesión.

## Ciclo de vida de una orden

La tabla `ordenes` guarda dos tipos de orden. Una **orden de productos** (`tipo = 'productos'`) sale del carrito y se paga antes de la entrega. Un **trabajo** (`tipo = 'servicio'`) se acuerda antes, se hace, y se paga después. Comparten la tabla y la función de transición, pero recorren estados distintos. Las dos listas siguen; cada paso indica quién lo mueve y con qué función.

### Orden de productos

| Estado | Cómo se llega | Qué pasa después |
|---|---|---|
| `creada` | El comprador confirma el carrito (`crear_orden`). Descuenta stock. | La pantalla de pago registra el cobro (`registrar_cobro`) y pasa a `esperando_pago`. Si no se registra un cobro en 10 minutos, `expirar_ordenes` la pasa a `expirada` y devuelve el stock. El comprador puede cancelar (`cancelar_orden`). |
| `esperando_pago` | El sistema registra el cobro. | Si el cobro tiene verificación (LUD-21) y el pago está hecho, el servidor lo confirma al consultar la pantalla de pago (`confirmar_pago` sin actor). Si el cobro es manual, el vendedor lo confirma a mano (`confirmar_pago`). Si pasan 600 segundos, `expirar_ordenes` la pasa a `expirada`. El comprador puede cancelar. |
| `pagada` | `confirmar_pago`. | El vendedor la marca como lista (`marcar_lista`). El comprador puede abrir una disputa. En un negocio de demostración el comprador puede simular la entrega (`simular_entrega_demo`), porque ese negocio no marca nada. |
| `lista` | `marcar_lista`. | El comprador confirma que recibió el pedido (`marcar_entregada`, sin código). O el vendedor confirma la entrega con el código de seis dígitos que le muestra el comprador (`entregar_con_codigo`). En un negocio de demostración, el comprador también puede simular la entrega. |
| `entregada` | `marcar_entregada`. | El comprador deja una reseña (`crear_resena`) y la orden pasa a `cerrada`. Si no hay disputa, `cerrar_ordenes` la cierra 48 horas después de la entrega. Durante esas 48 horas se puede abrir disputa. |
| `cerrada` | Reseña o `cerrar_ordenes`. | Fin. |

Ramas: **`cancelada`** (el comprador cancela antes de pagar, y el stock vuelve); **`disputada`** (el comprador abre una disputa desde `pagada`, `lista` o `entregada` dentro de 48 horas); **`resuelta`** (un administrador resuelve la disputa con `resolver_disputa`). Si el resultado es un reembolso, el vendedor lo paga fuera de la aplicación y lo marca (`marcar_reembolso`), y el comprador lo confirma (`confirmar_reembolso`). La aplicación no toca el dinero del reembolso.

### Trabajo (servicio)

| Estado | Cómo se llega | Qué pasa después |
|---|---|---|
| `acordada` | El cliente acepta una cotización (`aceptar_cotizacion`) o contrata un servicio de precio fijo (`contratar_servicio`). | El vendedor marca el trabajo como hecho (`marcar_hecha`). Cualquiera de las dos partes puede cancelar con un motivo (`cancelar_orden`). |
| `hecha` | `marcar_hecha`. | El comprador pide el pago. El servidor registra el cobro con la cotización de ese momento (`registrar_cobro_servicio`), y la orden pasa a `esperando_pago`. Si la solicitud vence, `expirar_ordenes` devuelve el trabajo a `hecha`, y el comprador pide una nueva. |
| `esperando_pago` | `registrar_cobro_servicio`. | Al confirmarse el pago (`confirmar_pago`), el trabajo pasa a `pagada` y, en la misma llamada, a `entregada`. La transición a `pagada` queda en la auditoría y en el aviso. |
| `entregada` | `confirmar_pago` (trabajo). | El cliente deja reseña y la orden pasa a `cerrada`, o `cerrar_ordenes` la cierra a las 48 horas. |
| `cerrada` | Reseña o `cerrar_ordenes`. | Fin. |

Ramas: **`cancelada`** (desde `acordada`, por cualquiera de las dos partes). Si el trabajo vino de una necesidad que todavía no venció, la necesidad vuelve a estar abierta y la cotización queda retirada, para que el mismo negocio pueda ofertar otra vez. **`disputada`** (desde `hecha`, o desde `entregada` dentro de 48 horas). Si el trabajo nunca se pagó, el administrador lo resuelve como `corresponde_pagar` (vuelve a `hecha`) o `no_corresponde_pagar` (pasa a `cancelada`). Si ya se pagó, usa los mismos resultados de dinero que los productos.

## Fotos

- **En la pantalla:** se aceptan hasta 4 fotos por producto y 1 por servicio. Cada archivo pesa como máximo 3 MB.
- **`POST /api/fotos`:** pide una sesión y un negocio registrado (en cualquier estado). Lee los primeros bytes del archivo y acepta solo JPEG, PNG o WebP. El tipo que manda el navegador no cuenta. SVG y GIF quedan fuera a propósito, porque pueden llevar código o animaciones que no se quieren servir.
- **Guardado:** el archivo va al bucket `productos`, en la carpeta del negocio (`<negocio_id>/<uuid>.<extensión>`). El nombre es aleatorio, así que una foto nunca pisa a otra (`upsert: false`). Se guarda con caché de un año.
- **Al guardar el producto o el servicio:** `guardarProducto` y `guardarServicio` revisan cada URL. Debe ser del bucket de este proyecto, dentro de la carpeta del propio negocio, o una foto de prueba de `/productos/`. Cualquier otra URL se rechaza.
- **En la base:** el bucket acepta hasta 5 MiB por archivo y solo JPEG, PNG y WebP. La función `guardar_producto` acepta hasta 6 URL de hasta 500 caracteres. El servidor es más estricto (4 fotos), y por eso el límite que se aplica es el menor.

## Analítica y embudo

La tabla `eventos_permitidos` define los pasos del embudo. Market tiene cinco: `vista_producto` (vio un producto), `agrego_carrito`, `inicio_pedido` (hizo el pedido), `vio_pago` (abrió la pantalla de pago) y `pago`. Cada evento se registra en uno de estos lugares:

- **Desde el navegador**, con `POST /api/evento`: `vista_producto` (al abrir una ficha de producto) y `agrego_carrito`. Solo esos dos aceptan los navegadores. El evento no lleva usuario, y la sesión de visita es una cookie `cm_sesion` (HttpOnly, un año).
- **Desde el servidor**: `inicio_pedido` cuando se crea la orden desde el carrito (`crearPedido`), `vio_pago` al abrir la pantalla de pago (solo si el navegador ya tiene cookie de visita), y `pago` cuando se confirma un pago de producto. Si lo confirma el vendedor o el sistema, la sesión es `orden-<id>`, porque no hay navegador del comprador.

La base guarda una fila por evento, sesión, objeto y hora: un refresco dentro de la misma hora no suma otra vez. Registrar un evento nunca rompe una compra. Si falla, solo se escribe un aviso en el registro del servidor. El administrador ve el embudo en `/admin/embudo`, con un rango de fechas en hora de El Salvador (30 días por defecto, 366 como máximo), leído con `embudo()`.

## Decisiones de seguridad

1. **Permisos explícitos.** Un proyecto alojado de Supabase da permisos por defecto a `anon` y `authenticated` sobre las tablas nuevas de `public`. La primera migración solo agregó reglas, así que dejaba esos permisos abiertos. La migración `20261012000003_privilegios.sql` revoca todo a esos roles y da de nuevo solo lo que la aplicación lee. Lo mismo vale para cada función y tabla nueva: el permiso se da de forma explícita.
2. **Permisos por columna.** Las sesiones no leen `ordenes.codigo_entrega` ni `ordenes.clave_idempotencia`, `negocios.credencial_pago_cifrada`, `cobros.referencia_externa` ni `cobros.verificar_url`, ni el teléfono de `usuarios`. Por eso las consultas del navegador y de las sesiones nombran sus columnas, y `select *` no se usa en esas tablas.
3. **El código de entrega nunca llega al vendedor.** Solo el servidor lo lee, con la clave de servicio, y solo para el comprador, mientras la orden de productos está `pagada` o `lista`. El vendedor escribe el código, y `marcar_entregada` lo compara con el guardado.
4. **Las escrituras se revisan dentro de la base.** Las funciones de escritura solo tienen permiso para `service_role`. Quien llama no puede saltarse la revisión de rol, porque `_rol_en_orden` y `_exigir_admin` corren dentro de Postgres.
5. **Lecturas con la clave de servicio.** Algunas lecturas usan `service_role` para ver filas que RLS no le mostraría a la propia persona, por ejemplo los productos pausados del propio negocio, o los nombres de las contrapartes. Cada una filtra por dueño en la consulta (`eq('negocio_id', ...)`, `eq('cliente_id', ...)` o similar) y se llama solo después de revisar la sesión. Si alguna consulta olvida ese filtro, expone filas de otras personas, así que cada nueva lectura de este tipo debe llevarlo.
6. **Los ids se revisan antes de usarse.** Un id que no es UUID no llega a la base. La capa de servidor lo responde como no encontrado (`esUuid`). Además, `next.config.ts` reescribe las rutas `/productos/:id`, `/negocios/:id`, `/servicios/:id` y `/necesito/:id` cuando el id no es UUID, hacia `/no-existe`, que responde 404 de verdad. Así el código de estado es correcto, porque Next todavía no empezó a enviar la página.
7. **Órdenes de otras personas.** `detalleDeOrden` devuelve `null` a quien no es el comprador ni el vendedor, y la página responde "no encontramos esa orden", igual que si no existiera. Así no se revela que la orden existe. `estadoDePago` hace lo mismo con quien no es el comprador.
8. **Direcciones Lightning.** `fetchSeguro` (en `src/lib/lightning/direccion.ts`) es la única forma de consultar una dirección del vendedor. Acepta solo `https`, sin usuario, contraseña ni puerto, y sin IP ni nombres internos (`.local`, `.internal`, `.lan`, `.home`, `.localhost`, o un nombre sin punto). Resuelve el nombre y rechaza si alguna dirección es privada. No sigue redirecciones, limita la respuesta a 64 KB y corta a los 5 segundos.
9. **Redirecciones.** `destinoSeguro` solo acepta rutas del propio sitio: rechaza URL absolutas, `//`, barras invertidas, caracteres de control y la propia página de entrar.
10. **Teléfonos.** La sesión lee el teléfono y el correo de su propio token, nunca de una tabla. Los demás usuarios no pueden leer el teléfono de nadie.
11. **Clave de servicio.** Vive solo en `src/servidor/` (con `import 'server-only'`) y en los scripts y pruebas, que la cargan con `--env-file`. Nunca se importa desde un componente de cliente.
12. **Lecturas repetidas.** `clienteServicio()` desactiva la deduplicación de peticiones GET que Next hace dentro de una misma renderización. La pantalla de pago lee una fila, la escribe y vuelve a leerla, y necesita la lectura real.
13. **Límites de acceso.** `supabase/config.toml` limita los correos por hora, y los inicios de sesión y las verificaciones de código por dirección IP en ventanas de cinco minutos. El proyecto alojado sube los límites de SMS, de inicio de sesión y de verificación (a 600), porque las cuentas de demostración entran todas desde el mismo servidor.

## Límites conocidos

- **Página con id correcto que no existe.** Responde con estado 200 y el texto de "no encontramos esa orden" (o el equivalente de la página). La 404 real solo se da para ids que no son UUID.
- **Correo en el plan gratuito.** En el proyecto alojado con el plan gratuito, el correo de acceso trae un enlace, no un código. En local trae el código.
- **Cobros de prueba.** Ningún cobro mueve dinero real. Los negocios con tienda de BTCPay cobran en bitcoin de prueba, y con `CACAO_PAY_URL` configurado el cobro pasa por CacaoPay (ver [pagos.md](pagos.md#cacaopay)). Un negocio de demostración sin tienda usa el proveedor `falso`. El cobro manual depende de que la Lightning Address del vendedor responda por LNURL-pay y LUD-21; si no responde, el vendedor confirma el pago a mano.
- **Sin proceso programado.** No hay `pg_cron` ni un proceso que corra solo. Las órdenes vencidas, los cierres de 48 horas y las necesidades vencidas se procesan cuando alguien abre una página que llama a `barrer()` (`src/servidor/mantenimiento.ts`): las órdenes, las compras, las ventas y la pantalla de pago. Si nadie entra, nada vence.
- **Vencimiento de la factura.** El plazo de pago es de 600 segundos desde que se crea el cobro. La aplicación no lee la fecha de vencimiento de la factura Lightning.
- **Precio del bitcoin.** La caché de la cotización vive en memoria, por proceso. En Vercel cada instancia tiene la suya.
- **DNS.** `fetchSeguro` resuelve el nombre para revisar las direcciones, y después `fetch` lo resuelve de nuevo. No hay protección completa contra DNS rebinding.
- **Adaptadores.** `nwc` y `blink` existen en el enum, pero no tienen adaptador: el cobro falla con `NO_DISPONIBLE`. La columna `negocios.credencial_pago_cifrada` está reservada para ellos y ningún código la escribe.
- **Fotos.** El servidor acepta 4 fotos por producto y 1 por servicio. La base permite hasta 6 por producto.
- **Semilla de la base.** `supabase/config.toml` apunta a `./seed.sql`, que no existe en el repositorio. Los datos de prueba los carga `scripts/sembrar.mjs`. Las fotos de prueba las cargan `scripts/fotos-semilla.mjs` y `scripts/fotos-servicios.mjs`. El primero usa `sharp`, que no está en `package.json`.
- **Chat de trabajos cancelados.** La base solo rechaza escribir en el chat de un trabajo cancelado. La capa de servidor además rechaza el chat de las órdenes expiradas. Las dos reglas se aplican por separado.
