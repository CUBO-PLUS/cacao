# CacaoMarket

CacaoMarket es un mercado de productos y servicios locales en El Salvador. Se paga en sats por Lightning. Cada cobro pasa por CacaoPay, el motor de pagos del grupo, que crea la factura en la tienda de BTCPay del negocio y avisa a Market cuando se paga (ver [docs/pagos.md](docs/pagos.md#cacaopay)). La aplicación no guarda dinero. En la versión de demostración las facturas son de bitcoin de prueba (regtest), sin valor: no se mueve dinero real.

Cada orden guarda una comisión teórica del 1 % para la plataforma, que el panel de administración suma pero ningún flujo cobra todavía. Cómo encaja en el modelo del grupo: [docs/business-model.md](../docs/business-model.md).

CacaoMarket es parte del grupo Cacao, junto con Cacao Media, Cacao Travel, CacaoPay y CacaoLedger. Media, Market y Pay comparten un mismo proyecto de Supabase: las tablas de Market no llevan prefijo, las de Media empiezan con `media_`, las de Pay con `pay_`, y `eventos` es compartida.

Versión en línea: https://cacao-market.vercel.app

## Qué se puede hacer

- Comprar productos de varios negocios. El carrito se separa por tienda y cada tienda genera su propia orden.
- Contratar servicios a precio fijo, o pedir una cotización y aceptar la oferta.
- Publicar una necesidad en el tablón y recibir ofertas de los negocios.
- Vender: registrar el negocio, publicar productos y servicios, responder cotizaciones y marcar pedidos y trabajos.
- Administrar: aprobar negocios, resolver disputas, ocultar publicaciones y revisar órdenes, auditoría y embudo de ventas.

El ingreso es con Clerk: en `/entrar` se entra con celular o correo, y en `/registrarse` se crea la cuenta. Ya no hay cuentas de demostración. El rol de administración sale de `usuarios.es_admin`.

## Requisitos

- Node.js 24. `package.json` no declara `engines`; el proyecto usa los tipos de Node 24.
- Docker, para Supabase local.
- Supabase CLI. No está en `devDependencies`: se usa con `npx supabase`, que la descarga la primera vez.

## Cómo correrla en local

1. Entrá a la carpeta `market` del repositorio e instalá las dependencias:

   ```bash
   npm ci
   ```

2. Levantá Supabase local. La primera vez descarga las imágenes de Docker y puede tardar varios minutos:

   ```bash
   npx supabase start
   ```

3. Copiá `.env.example` como `.env.local`. Con `npx supabase status` obtené la URL de la API y las claves `anon` y `service_role`, y pegalas en `.env.local`. Poné también `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` y `CLERK_SECRET_KEY` con las claves de desarrollo de tu aplicación en Clerk.

4. Aplicá las migraciones de `supabase/migrations`. El comando solo aplica las que faltan:

   ```bash
   npx supabase migration up
   ```

5. Cargá los datos de prueba. Se puede correr dos veces sin problema:

   ```bash
   node --env-file=.env.local scripts/sembrar.mjs
   ```

6. Arrancá la aplicación. Queda en http://localhost:4323:

   ```bash
   npm run dev
   ```

Para entrar en local, usá un usuario de prueba creado en el panel de Clerk. Los números 7000 0001 a 7000 0009 y el código 123456 ya no sirven. Para tener rol de administración, marcá `es_admin = true` en la fila de `usuarios` enlazada por `clerk_id`.

## Variables de entorno

Los valores van en `.env.local`, que no se sube al repositorio. Cambiar una variable `NEXT_PUBLIC_*` exige reiniciar `npm run dev`.

- `NEXT_PUBLIC_SUPABASE_URL`: dirección de la API de Supabase.
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`: clave pública (anon) del proyecto.
- `SUPABASE_SERVICE_ROLE_KEY`: clave de servicio. Solo la usan el servidor y los scripts.
- `PRECIO_FIJO_USD_BTC`: precio fijo del bitcoin en USD. Si tiene un número positivo, no se consultan Coinbase ni Kraken.
- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`: clave pública de Clerk para `/entrar` y `/registrarse`.
- `CLERK_SECRET_KEY`: clave secreta de Clerk. La usa solo el servidor.
- `NEXT_PUBLIC_DEMO`: modo demo. Ya no abre cuentas de demostración en `/entrar`.
- `MARKET_URL`: dirección de la aplicación para las pruebas de navegador. Por defecto, http://localhost:4323.

## Pruebas

Las pruebas de base de datos y de navegador necesitan las variables de `.env.local`, por eso se corren con `--env-file`.

- Unitarias, no necesitan Supabase: `npx vitest run src`
- De base de datos, necesitan Supabase local: `node --env-file=.env.local node_modules/vitest/vitest.mjs run tests/db`
- Todas las de Vitest: `node --env-file=.env.local node_modules/vitest/vitest.mjs run`
- De navegador, necesitan `npm run dev` en otra terminal y la base sembrada: `node --env-file=.env.local node_modules/@playwright/test/cli.js test`. Para una sola prueba, agregá su ruta, por ejemplo `tests/e2e/compra.spec.ts`.

Antes de subir cambios, corré `npm run lint` y `npm run check` (verificación de tipos).

## Estructura

- `src/app`: rutas (App Router), páginas, acciones de servidor (`acciones.ts`) y route handlers (`api/` y `auth/`).
- `src/componentes`: piezas de interfaz compartidas.
- `src/servidor`: capa de servidor. Es la única que escribe en la base.
- `src/lib`: reglas sin efectos: dinero, estados de orden, carrito, servicios, adaptadores de pago, precio del bitcoin y direcciones Lightning.
- `src/proxy.ts`: refresca la sesión en cada petición.
- `src/tipos/db.ts`: tipos de las tablas y funciones de la base.
- `supabase/`: configuración local, migraciones y plantilla del correo de acceso.
- `scripts/`: datos de prueba (`sembrar.mjs`) y fotos de prueba.
- `tests/`: pruebas de base de datos (`db/`) y de navegador (`e2e/`). Las unitarias están junto al código, en `src/lib`.
- `public/`: íconos y fotos de los productos de prueba.

## Documentación

- [Arquitectura](docs/arquitectura.md): capas, regla de escritura, sesiones, tiempo real, ciclo de las órdenes y decisiones de seguridad.
- [Base de datos](docs/base-de-datos.md): tablas, enums, permisos de lectura, funciones y códigos de error.
- [API](docs/api.md): rutas HTTP, capa de servidor y acciones de servidor.
- [Pagos](docs/pagos.md): diseño de los cobros, adaptadores y cómo conectar un procesador real.
