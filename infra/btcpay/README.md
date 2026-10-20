# Pagos con BTCPay Server

Los cinco productos de Grupo Cacao cobran con BTCPay Server. BTCPay no custodia dinero: cada tienda recibe en su propia billetera, y la plataforma solo pide facturas y consulta si se pagaron.

En la demostración, BTCPay corre en **regtest**: los bloques y las monedas se generan localmente y no tienen valor. Para pasar a dinero real alcanza con correr el mismo stack en mainnet y cambiar la dirección y las claves. El código de los productos no cambia.

## Qué hay en esta carpeta

| Archivo | Qué hace |
|---|---|
| `docker-compose.yml` | bitcoind, NBXplorer, Postgres, BTCPay, dos nodos LND (Cacao y un comprador de prueba) y la puerta. |
| `billetera/` | La puerta (`puerta`): la billetera de prueba en `/billetera`, y el resto de las rutas pasan a BTCPay. |
| `preparar.sh` | Mina monedas, fondea al comprador y abre un canal Lightning de 5,000,000 sats hacia Cacao. |
| `tunel.ps1` | Abre una dirección pública con Cloudflare Quick Tunnel. La dirección cambia cada vez que arranca. |
| `btcpay.ts` | Cliente de la API Greenfield. Cada producto tiene una copia idéntica. |

## Arrancar

```bash
docker compose -f infra/btcpay/docker-compose.yml up -d
bash infra/btcpay/preparar.sh
powershell -ExecutionPolicy Bypass -File infra/btcpay/tunel.ps1
```

Después, la dirección pública va en `BTCPAY_URL` de cada proyecto de Vercel, y cada proyecto se vuelve a desplegar.

## Por qué Lightning

BTCPay no acepta montos chicos en la cadena: 120 sats están por debajo del límite de polvo (*dust*). Todas las facturas de Cacao son Lightning (`BTC-LN`). En la demostración, las facturas son `lnbcrt…`, y la billetera de prueba las paga desde el nodo del comprador.

## Contrato para los productos

### Variables de entorno

| Variable | Productos | Qué es |
|---|---|---|
| `BTCPAY_URL` | todos | Dirección pública de BTCPay, sin barra final. |
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
