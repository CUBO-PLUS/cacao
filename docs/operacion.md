# Cómo continuar el trabajo

Guía práctica para retomar el proyecto en cualquier computadora: qué instalar, cómo correr cada producto, cómo probar, cómo publicar y qué quedó pendiente.

## Los productos

| Producto | Carpeta | Tecnología | Puerto local | En vivo |
|---|---|---|---|---|
| Cacao | `cacao/` | HTML estático | no usa | https://cacao-grupo.vercel.app |
| Cacao Media | raíz (`src/`) | Astro 7 | 4321 | https://cacao-media.vercel.app |
| Cacao Travel | `travel/` | Astro 7 | 4322 | https://cacao-travel.vercel.app |
| CacaoMarket | `market/` | Next.js 16 y Supabase | 4323 | https://cacao-market.vercel.app |
| CacaoPay | `pay/` | Next.js 16 y Supabase | 4324 | https://cacao-pay.vercel.app |
| CacaoLedger | `ledger/` | Next.js 16 (web) y Node 24 (terminal) | `ledger_` | https://cacao-cuentas.vercel.app |

Media, Market y Pay comparten una base de datos de Supabase. Sus migraciones viven en `market/supabase/migrations/`: las tablas de Market no llevan prefijo, las de Media empiezan con `media_`, las de Pay con `pay_`, y `eventos` es común.

## Qué instalar

- Node 24.
- Docker Desktop, para la base de datos local.
- La CLI de Vercel y la de Supabase se usan con `npx`; no hace falta instalarlas.

Después de clonar, instalar dependencias en cada carpeta que se vaya a usar:

```bash
npm install
```

(en la raíz, en `travel/`, en `market/`, en `pay/` y en `ledger/`)

## Variables de entorno

Media, Market y Pay traen un `.env.example` con los nombres. Los valores no están en el repositorio.

| Producto | Archivo local | Variables |
|---|---|---|
| Media | `.env.local` en la raíz | `CACAO_SECRET`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `PRECIO_FIJO_USD_BTC`, `PUBLIC_DEMO`, `PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY` |
| Travel | `.env.local` en `travel/` | `CACAO_SECRET` (el mismo de Media), `PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, `PUBLIC_MEDIA_URL` opcional |
| Market | `market/.env.local` | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `PRECIO_FIJO_USD_BTC`, `NEXT_PUBLIC_DEMO`, `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY` |
| Pay | `pay/.env.local` | las mismas de Market |
| Ledger | ninguno | no usa |

Para trabajar en local, las llaves de la base salen del comando que la arranca (siguiente sección). `PRECIO_FIJO_USD_BTC=100000` fija el precio del bitcoin para que las pruebas den siempre lo mismo; sin esa variable se consulta el precio real.

## Arrancar todo en local

1. La base de datos, desde `market/`:

   ```bash
   npx supabase start
   ```

   El comando imprime la dirección y las llaves locales. Van en `market/.env.local`, en `pay/.env.local` y, con los nombres de Media, en `.env.local` de la raíz.

2. Datos de muestra, desde `market/`:

   ```bash
   node --env-file=.env.local scripts/sembrar.mjs
   ```

3. Los sitios, cada uno en su terminal y desde su carpeta:

   ```bash
   npm run dev
   ```

4. Ledger corre aparte, sin base ni red:

   ```bash
   npm run demo
   ```

Cuentas de prueba: el ingreso de Market y de Pay es con Clerk, así que se usan usuarios de prueba creados en Clerk. Ya no hay botones de demostración ni el código 123456. Para tener rol de administración, marcá `es_admin = true` en la fila de `usuarios` enlazada por `clerk_id`.

## Pruebas

| Qué | Carpeta | Comando |
|---|---|---|
| Media y Travel, en navegador | raíz | `node --env-file=.env.local node_modules/@playwright/test/cli.js test` |
| Market, unitarias y de base | `market/` | `node --env-file=.env.local node_modules/vitest/vitest.mjs run` |
| Market, en navegador | `market/` | `node --env-file=.env.local node_modules/@playwright/test/cli.js test tests/e2e` |
| Pay, unitarias y de base | `pay/` | `node --env-file=.env.local node_modules/vitest/vitest.mjs run` |
| Pay, en navegador | `pay/` | `node --env-file=.env.local node_modules/@playwright/test/cli.js test tests/e2e` |
| Ledger | `ledger/` | `npm test` |

Las pruebas en navegador necesitan los servidores de desarrollo arriba. Las pruebas de base y de navegador dejan filas en la base local; para dejarla limpia, desde `market/`:

```bash
npx supabase db reset
```

y luego volver a sembrar.

Antes de publicar conviene revisar tipos (el guion existe en cada carpeta) y compilar:

```bash
npm run check
```

```bash
npx next build
```

(el segundo solo en `market/` y `pay/`)

## Cambiar la base de datos

1. Crear un archivo nuevo en `market/supabase/migrations/` con fecha y nombre, por ejemplo `20261020000001_algo.sql`. Nunca editar una migración ya aplicada.
2. Un valor nuevo de un `enum` se agrega en una migración y se usa en la siguiente.
3. Toda tabla nueva lleva `enable row level security` y sus permisos escritos uno por uno. Un proyecto alojado de Supabase da todos los permisos por defecto; ver `20261012000003_privilegios.sql`.
4. Toda función nueva es `security definer`, con `set search_path = public`, sin permiso de ejecución para `public`, `anon` ni `authenticated`, y con permiso para `service_role`.
5. Aplicar en local, desde `market/`:

   ```bash
   npx supabase migration up --local
   ```

6. Regenerar los tipos y copiarlos a Pay:

   ```bash
   npx supabase gen types typescript --local > src/tipos/db.ts
   ```

7. Subir al proyecto alojado, con su referencia y su contraseña:

   ```bash
   npx supabase db push --project-ref <referencia> -p <contraseña> --yes
   ```

8. Después de subir, comprobar con una llave pública y con una sesión de prueba que no se puede leer ni escribir lo que no corresponde.

## Publicar

Subir a GitHub no publica. Cada producto se publica desde su carpeta con la CLI de Vercel, con sesión iniciada en la cuenta del proyecto:

```bash
npx vercel deploy --prod --yes
```

- Si responde `fetch failed`, repetir el comando.
- `vercel link` puede reescribir `.env.local` y `.gitignore` de la carpeta. Respaldarlos antes y restaurarlos después.
- Un proyecto de Next.js creado vacío necesita `vercel.json` con `"framework": "nextjs"`; sin eso responde 404.
- Las variables de cada proyecto se cargan en Vercel con `npx vercel env add NOMBRE production`.
- El sitio de Ledger se genera con `npm run sitio` y se publica igual.

Orden recomendado cuando cambian varias cosas: migraciones, datos de muestra, Media y Travel, Market, Pay, Ledger. Después de publicar, abrir cada sitio y recorrer su flujo principal.

## Qué quedó pendiente

- **Entregables estratégicos** de cada reto: investigación de mercado, usuarios, estrategia de precios, indicadores y recomendación final. No están en este repositorio.
- **Ingreso por correo** en Market y Pay: funciona en local con código; en el proyecto alojado del plan gratis el correo trae un enlace y no se probó con una dirección real.
- **Ledger:** el cliente del firmador y el sobre cifrado por comercio están en el programa. La transmisión real al Ministerio no. El detalle está en `ledger/docs/firma-y-comercios.md`.

## Documentación de cada producto

- Media y Travel: `README.md` en la raíz.
- Market: `market/README.md` y `market/docs/` (arquitectura, base de datos, API, pagos).
- Pay: `pay/README.md`.
- Ledger: `ledger/README.md` y `ledger/docs/` (hallazgos, atestación, importar órdenes de Market).
- La página de la empresa: `cacao/README.md`.
- Diseños: `docs/diseno/`.
