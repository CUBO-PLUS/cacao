# Pagos con BTCPay Server

Los cinco productos de Grupo Cacao cobran con BTCPay Server. BTCPay no custodia dinero: cada tienda recibe en su propia billetera, y la plataforma solo pide facturas y consulta si se pagaron.

En la demostración, BTCPay corre en **regtest**: los bloques y las monedas se generan localmente y no tienen valor. Para pasar a dinero real alcanza con correr el mismo stack en mainnet y cambiar la dirección y las claves. El código de los productos no cambia.

Para llevar el stack a una VM en la nube (Oracle Cloud, siempre gratis), ver [nube/LEEME.md](nube/LEEME.md).

## Qué hay en esta carpeta

| Archivo | Qué hace |
|---|---|
| `docker-compose.yml` | bitcoind, NBXplorer, Postgres, BTCPay, dos nodos LND (Cacao y un comprador de prueba) y la puerta. |
| `billetera/` | La puerta (`puerta`): la billetera de prueba en `/billetera`, y el resto de las rutas pasan a BTCPay. |
| `preparar.sh` | Mina monedas, fondea al comprador y abre un canal Lightning de 5,000,000 sats hacia Cacao. |
| `tunel.ps1` | Abre una dirección pública con Cloudflare Quick Tunnel. La dirección cambia cada vez que arranca. |
| `vigia.ps1` | Vigía: mantiene el stack y el túnel arriba, y publica la dirección actual en Supabase. Lo corre una tarea programada. |
| `vigia-oculto.vbs` | Lanza `vigia.ps1` sin ventana. Es lo que ejecuta la tarea programada. |
| `instalar-vigia.ps1` / `desinstalar-vigia.ps1` | Registran o quitan la tarea programada del vigía. |
| `btcpay.ts` | Cliente de la API Greenfield. Cada producto tiene una copia idéntica. |

## Arrancar

```bash
docker compose -f infra/btcpay/docker-compose.yml up -d
bash infra/btcpay/preparar.sh
powershell -ExecutionPolicy Bypass -File infra/btcpay/tunel.ps1
```

Después, instalá el vigía (sección "Mantenerlo vivo"). Él publica la dirección pública en Supabase, y los productos la leen en cada pedido: no hace falta volver a desplegar Vercel cuando el túnel cambia.

## Por qué Lightning

BTCPay no acepta montos chicos en la cadena: 120 sats están por debajo del límite de polvo (*dust*). Todas las facturas de Cacao son Lightning (`BTC-LN`). En la demostración, las facturas son `lnbcrt…`, y la billetera de prueba las paga desde el nodo del comprador.

## Contrato para los productos

### Variables de entorno

| Variable | Productos | Qué es |
|---|---|---|
| `BTCPAY_URL` | todos | Dirección pública de BTCPay, sin barra final. Es el respaldo: el producto la usa solo si Supabase no tiene una dirección (`url_btcpay()`, en `config_publica`). |
| `SUPABASE_URL` y `SUPABASE_ANON_KEY` | Travel | Para leer la dirección de BTCPay desde Supabase (`travel/src/lib/url-btcpay.ts`). Travel no las tenía antes. Media, Market, Pay y Ledger ya tienen sus claves de Supabase. |
| `BTCPAY_API_KEY` | todos | Clave Greenfield. Cada producto tiene la suya, limitada a sus tiendas. |
| `BTCPAY_STORE_ID` | Media, Travel, Pay | La tienda del producto. Market guarda una tienda por vendedor en la base. |
| `BTCPAY_WEBHOOK_SECRET` | Media, Pay, Market | Secreto con que BTCPay firma los avisos. |

Si falta `BTCPAY_URL` o `BTCPAY_API_KEY`, el producto no cobra y lo dice con un mensaje claro. Nunca simula el pago.

### Metadatos de cada factura

Todo producto escribe estos campos en `metadata` (tipo `MetadatosCacao` en `btcpay.ts`). CacaoLedger los usa para armar el ticket.

| Campo | Ejemplo |
|---|---|
| `producto` | `media`, `travel`, `market` o `pay` |
| `orderId` | El id propio de lo que se paga (cobro, reserva, orden, envío). |
| `itemDesc` | "Historia: El cacao de Izalco" |
| `usdCentavos` | Precio en centavos de dólar, IVA incluido. |
| `cotizacionUsdBtc` | Dólares por bitcoin usados para pasar a sats. |

### Cuándo algo está pagado

Solo cuando BTCPay dice que la factura está `Settled`. El navegador nunca marca un pago.

- **Consulta:** la pantalla de pago pregunta al servidor del producto, y el servidor pregunta a BTCPay (`leerFactura`).
- **Aviso:** BTCPay manda un webhook firmado (`BTCPay-Sig: sha256=<HMAC>`). El producto revisa la firma (`firmaValida`), y después vuelve a leer la factura en BTCPay. El cuerpo del aviso nunca se usa como prueba de pago.
- Los dos caminos terminan en la misma función de la base, que es idempotente: un segundo aviso no paga dos veces.

### Claves

| Clave | Permisos |
|---|---|
| Media, Travel, Pay | Crear y ver facturas, solo de su tienda. |
| Market | Usuario propio, no administrador. Crea y ve facturas de las tiendas de vendedores donde es miembro. |
| Ledger | Ver facturas de todas las tiendas. No crea nada. |

Las claves, los secretos y los ids de las tiendas de la demostración están en `.qa/btcpay-local.json`, que git ignora.

## Seguridad de la demostración

- BTCPay y la billetera de prueba quedan públicos por el túnel. El registro de usuarios está cerrado.
- La billetera de prueba solo paga facturas regtest (`lnbcrt…`) de hasta 1,000,000 sats.
- Nada de esto mueve dinero real. Con dinero real, Cacao Pay es un servicio de remesas y necesita registro ante el BCR.

## Mantenerlo vivo

El túnel cambia de dirección cada vez que arranca, así que el vigía hace tres cosas cada 2 minutos y al entrar a Windows:

1. Levanta Docker Desktop si no responde (espera hasta 4 minutos), y corre `docker compose up -d`.
2. Verifica el contenedor `cacao-tunel`, lo crea si falta, y lee su dirección de `docker logs`. Comprueba que BTCPay responda en `/api/v1/health` por esa dirección.
3. Si la dirección cambió, la guarda en Supabase con `fijar_url_btcpay` (y en `.qa/btcpay-local.json`, campo `urlPublica`). Los productos la leen con `url_btcpay()`, con un caché de 30 segundos.

Cada corrida deja una línea en `infra/btcpay/local/vigia.log` (Docker, stack, túnel, Supabase, dirección y si cambió). Nunca registra claves. Sale con código 0 cuando todo está sano.

Para instalar o quitar la tarea programada (no hace falta ser administrador):

```powershell
powershell -ExecutionPolicy Bypass -File infra\btcpay\instalar-vigia.ps1
powershell -ExecutionPolicy Bypass -File infra\btcpay\desinstalar-vigia.ps1
```

Para correrlo a mano, una vez: `powershell -ExecutionPolicy Bypass -File infra\btcpay\vigia.ps1`.

### Si Docker muestra el error de dockerInference o engine.sock

Docker Desktop a veces no arranca y muestra un error sobre `dockerInference` o `engine.sock`. Suele ser un estado de sesión roto, y se arregla así:

1. Cerrá Docker Desktop del todo (también desde la bandeja).
2. Renombrá las carpetas `%LOCALAPPDATA%\Docker\run` y `%LOCALAPPDATA%\docker-secrets-engine` (por ejemplo, agregales `.viejo`). Si no podés renombrarlas, Docker está todavía abierto.
3. Corré `wsl --shutdown` en PowerShell.
4. Abrí Docker Desktop de nuevo. El vigía lo levanta solo en la siguiente corrida.

No uses "Reset to factory defaults" en Docker Desktop: borra todas las imágenes y los volúmenes, y con ellos la base regtest de la demostración.
