# Después de instalar: pasar los productos a la VM

Para quien administra Cacao (el orquestador y el usuario). Supone que `instalar.sh` terminó bien y que `https://<DOMINIO>` responde.

En los ejemplos, `$BTCPAY` es `https://<DOMINIO>`, sin barra final. Las claves y los secretos no se imprimen ni se pegan en un chat: se guardan donde ya se guardan (Vercel, `market/.env.nube`, el gestor de contraseñas del usuario). Cada paso que publica algo, cambia datos o despliega necesita confirmación del usuario.

## 0. Apagar la vía vieja del PC (antes de tocar Supabase)

El vigía del PC reescribe la dirección de BTCPay en Supabase cada vez que cambia el túnel. Si sigue activo, pisa la dirección nueva.

1. Quitar la tarea programada: `powershell -ExecutionPolicy Bypass -File infra\btcpay\desinstalar-vigia.ps1`. Solo detiene el vigía; el stack local y el túnel siguen.
2. Cerrar el túnel del PC (`infra\btcpay\tunel.ps1`). Pedir confirmación antes de cerrar la ventana o matar el proceso.

## 1. Verificar el nodo

- `curl -sS -o /dev/null -w '%{http_code}' $BTCPAY/` devuelve 200 o un redirect (3xx).
- `curl -sS -o /dev/null -w '%{http_code}' $BTCPAY/billetera` devuelve 200 en regtest y 404 en mainnet.
- En la VM, con `sudo`: `docker compose -f /opt/cacao-btcpay/docker-compose.yml ps` muestra todo "Up". `lnd_comprador` aparece solo en regtest.

## 2. Administrador de BTCPay

1. Abrir `$BTCPAY` y crear la primera cuenta. En una instalación nueva, esa cuenta es la administradora.
2. Cerrar el registro: Server settings > Policies, desactivar la creación de cuentas. El nombre exacto puede variar en 2.4.5.
3. Crear una clave de API de administrador (Account > API Keys, con permisos de administrador). Es la `BTCPAY_ADMIN_KEY` de `tiendas-btcpay.mjs`.

Todas las llamadas siguientes usan `Authorization: token <clave>`, igual que `market/scripts/tiendas-btcpay.mjs`.

## 3. Usuario de Market y clave de Ledger

- **Market:** un usuario propio, no administrador. Crearlo en Server settings > Users, o con `POST $BTCPAY/api/v1/users` (campo `isAdministrator: false`). Su email es `BTCPAY_MARKET_USER`.
- **Ledger:** una clave que solo ve facturas de todas las tiendas, sin crear nada. Si BTCPay no permite una clave que vea todas las tiendas, usar una clave de solo lectura y decírselo al usuario.

## 4. Tiendas de Media, Travel y Pay

Mismos ajustes y llamadas que `market/scripts/tiendas-btcpay.mjs`. Por cada producto (nombre: "Cacao Media", "Cacao Travel", "Cacao Pay"):

```bash
# 1. Store. Keep the "id" of the answer as BTCPAY_STORE_ID.
curl -sS -X POST "$BTCPAY/api/v1/stores" -H "Authorization: token $BTCPAY_ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{"name":"Cacao Media","defaultCurrency":"SATS","speedPolicy":"HighSpeed","invoiceExpiration":900}'

# 2. On-chain wallet and Lightning through the internal node, as the market script does.
curl -sS -X POST "$BTCPAY/api/v1/stores/$ID/payment-methods/BTC-CHAIN/wallet/generate" \
  -H "Authorization: token $BTCPAY_ADMIN_KEY" -H "Content-Type: application/json" \
  -d '{"savePrivateKeys":false,"scriptPubKeyType":"Segwit"}'
curl -sS -X PUT "$BTCPAY/api/v1/stores/$ID/payment-methods/BTC-LN" \
  -H "Authorization: token $BTCPAY_ADMIN_KEY" -H "Content-Type: application/json" \
  -d '{"enabled":true,"config":{"connectionString":"Internal Node"}}'
```

Claves de API (en la UI, Account > API Keys, o con la API si los permisos están claros):

- Media, Travel y Pay: crear y ver facturas, solo de su tienda (`BTCPAY_API_KEY`).

## 5. Webhooks

Para las tiendas de Media, Pay y Market, cada una con su propio secreto nuevo de 64 caracteres hexadecimales (`BTCPAY_WEBHOOK_SECRET`):

```bash
curl -sS -X POST "$BTCPAY/api/v1/stores/$ID/webhooks" -H "Authorization: token $BTCPAY_ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://cacao-media.vercel.app/api/pagos/btcpay","secret":"<secreto>","enabled":true,
       "automaticRedelivery":true,"authorizedEvents":{"everything":false,
       "specificEvents":["InvoiceSettled","InvoiceExpired","InvoiceInvalid"]}}'
```

| Tienda | URL del webhook |
|---|---|
| Media | `https://cacao-media.vercel.app/api/pagos/btcpay` |
| Pay | `https://cacao-pay.vercel.app/api/pagos/btcpay` |
| Market | Lo crea el script del paso 8 (`BTCPAY_MARKET_WEBHOOK_URL`). No hace falta aquí. |

Travel no usa webhook (ver la tabla de variables en `infra/btcpay/README.md`).

## 6. Vercel: variables y despliegue

Por proyecto (nombres de `memory/cacaomarket-hosting.md`). Las variables se cargan con `npx vercel env`, sin imprimir valores:

| Proyecto | Variables |
|---|---|
| `cacaomedia` | `BTCPAY_URL`, `BTCPAY_API_KEY`, `BTCPAY_STORE_ID`, `BTCPAY_WEBHOOK_SECRET` |
| `cacaotravel` | `BTCPAY_URL`, `BTCPAY_API_KEY`, `BTCPAY_STORE_ID` |
| `cacaomarket` | `BTCPAY_URL`, `BTCPAY_API_KEY` (usuario de Market), `BTCPAY_WEBHOOK_SECRET` (el de Market) |
| `cacaopay` | `BTCPAY_URL`, `BTCPAY_API_KEY`, `BTCPAY_STORE_ID`, `BTCPAY_WEBHOOK_SECRET` |
| `cacaoledger` | `BTCPAY_URL`, `BTCPAY_API_KEY` (clave de solo lectura del paso 3) |

Después, desde cada carpeta: `npx vercel deploy --prod --yes`. Antes de `vercel link` (si hace falta), respaldar `.env.local` y `.gitignore`, porque `vercel link` los reescribe. Pedir confirmación antes de desplegar.

## 7. Supabase: fijar la dirección

Requisito: la migración `market/supabase/migrations/20261029000001_config_btcpay.sql` aplicada en el proyecto `sxlbkarwsitgplqbtgju`. Si no lo está, aplicarla con `npx supabase db push --project-ref sxlbkarwsitgplqbtgju` (pedir confirmación).

Con la clave de service role (sin imprimirla):

```bash
curl -sS -X POST "https://sxlbkarwsitgplqbtgju.supabase.co/rest/v1/rpc/fijar_url_btcpay" \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" -d '{"p_url":"https://<DOMINIO>"}'
```

La función exige `https://` y un host sin barra final: `^https://[a-z0-9.-]+$`. Comprobar después con `POST .../rest/v1/rpc/url_btcpay` (clave anon): tiene que devolver la dirección nueva.

## 8. Tiendas de vendedores (Market)

`market/scripts/tiendas-btcpay.mjs` crea una tienda por negocio aprobado que tenga `btcpay_tienda_id` vacío. Las tiendas de los vendedores que ya existen apuntan al BTCPay viejo del PC: hay que confirmar con el usuario si se reinician esos campos a null (es un cambio de datos).

Usar un archivo de entorno temporal fuera del repositorio, con estas variables:

- `BTCPAY_ADMIN_URL=$BTCPAY` (el script usa 127.0.0.1 por defecto)
- `BTCPAY_ADMIN_KEY`, `BTCPAY_MARKET_USER` (email del usuario del paso 3)
- `BTCPAY_MARKET_WEBHOOK_URL=https://cacao-market.vercel.app/api/pagos/btcpay`
- `BTCPAY_MARKET_WEBHOOK_SECRET` (el mismo que `BTCPAY_WEBHOOK_SECRET` en `cacaomarket`)
- `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`

```bash
cd market
node --env-file=<archivo-temporal> scripts/tiendas-btcpay.mjs --dry-run
node --env-file=<archivo-temporal> scripts/tiendas-btcpay.mjs --solo <id-de-un-negocio>
node --env-file=<archivo-temporal> scripts/tiendas-btcpay.mjs
```

Probar primero con `--dry-run` y con un solo negocio. Borrar el archivo temporal al terminar.

## 9. Prueba de punta a punta

1. En `cacao-media.vercel.app`, crear una factura de prueba en sats y pagarla desde `$BTCPAY/billetera` (regtest).
2. Confirmar que la pantalla pasa a pagada, y que el webhook llegó: en BTCPay, Store > Webhooks > Deliveries.
3. Repetir con Pay y con Market.
4. Confirmar que cada factura quedó pagada una sola vez (el webhook repetido no paga dos veces).
5. Confirmar que Ledger muestra las facturas.

## 10. Limpieza y lo que no se hace

- No pasar a mainnet con esta demo: Cacao Pay necesita registro ante el BCR antes de manejar dinero real.
- No borrar nada del PC sin preguntar. Solo se apaga el vigía y el túnel.
- Las claves y secretos del PC dejan de servir cuando la tienda vieja se borra. Revocarlos en el BTCPay del PC solo si el usuario lo pide.
- Confirmar con el usuario que guardó la clave de respaldo (`LEEME.md`, sección Respaldos).

## 11. Lo que todavía no está probado

- Let's Encrypt con sslip.io: el dominio es compartido y el límite de certificados puede frenar el primer arranque. Si pasa, usar un dominio propio.
- Mainnet: crear la billetera Lightning y anotar la semilla en el primer arranque. El comportamiento de la imagen `btcpayserver/lnd` no se verificó sin correrla.
- Mainnet: NBXplorer con nodo podado (`prune=50000`). Probar en una VM aparte antes de usarlo.
- Permisos exactos de las claves de API de BTCPay 2.4.5: confirmarlos en la interfaz al crearlas.
