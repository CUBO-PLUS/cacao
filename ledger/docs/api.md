# API de CacaoLedger (v1)

La API deja que otro sistema del grupo registre sus ventas en CacaoLedger y lea lo que registró. Es de servidor a servidor: no tiene CORS, así que un navegador no puede usarla directamente. Cada cliente tiene su propia clave.

Base: `https://<cacao-cuentas>/api/v1`

## Claves

- Una clave tiene la forma `cl_` seguido de 32 caracteres. Se muestra una sola vez, al crear el cliente.
- Se envía así: `Authorization: Bearer cl_...`
- La base guarda solo el hash SHA-256 de la clave. Una clave revocada se rechaza igual que una desconocida.
- Cada clave tiene un límite de 120 peticiones por minuto. Al pasarlo, la respuesta es 429 con `Retry-After: 60`.

Crear un cliente (con las variables de CacaoLedger, en el servidor):

```sh
node --env-file=.env.local scripts/cliente-api.mjs crear --nombre "Cacao Pay"
node --env-file=.env.local scripts/cliente-api.mjs crear --nombre "Grupo Cacao" --grupo
node --env-file=.env.local scripts/cliente-api.mjs listar
node --env-file=.env.local scripts/cliente-api.mjs revocar cl_XXXXXXXX
```

`--grupo` permite leer el reporte del mes del grupo. Solo debe tenerlo el dueño del libro.

## Registrar una venta

`POST /api/v1/ventas`

Cada petición lleva un encabezado `Idempotency-Key` (entre 8 y 128 caracteres). Repetir la misma clave con el mismo cuerpo devuelve la misma venta y no crea nada nuevo (200). Usar la misma clave con otro cuerpo, o la misma `referencia` con otro cuerpo, da 409.

Cuerpo:

| Campo | Tipo | Notas |
|---|---|---|
| `referencia` | texto, hasta 120 | Identifica la venta en tu sistema. Única por cliente. |
| `producto` | `media`, `travel`, `market`, `pay` o `negocios` | `negocios` es una venta de un negocio que cobra con CacaoPay. |
| `descripcion` | texto, hasta 200 | Una línea. |
| `monto_usd_centavos` | entero mayor que cero | Lo que pagó el cliente, IVA incluido. |
| `medio` | `lightning` o `efectivo` | |
| `pago` | objeto | Solo con `lightning`: `sats` (entero), `tasa` (precio del bitcoin en USD, por ejemplo `"100000.00"`), `factura_id` (la factura de BTCPay) y `hash` (64 caracteres hexadecimales). Con `efectivo` no va. |
| `negocio_id` | UUID | Obligatorio con `producto: "negocios"`. Solo con ese producto. |

Ejemplo, una venta de Market pagada por Lightning:

```sh
curl -X POST https://<cacao-cuentas>/api/v1/ventas \
  -H "Authorization: Bearer cl_XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX" \
  -H "Idempotency-Key: market-pedido-1042" \
  -H "Content-Type: application/json" \
  -d '{
    "referencia": "pedido-1042",
    "producto": "market",
    "descripcion": "Cafe de altura, 250 g",
    "monto_usd_centavos": 452,
    "medio": "lightning",
    "pago": {
      "sats": 4000,
      "tasa": "100000.00",
      "factura_id": "INV123ABC",
      "hash": "0000000000000000000000000000000000000000000000000000000000000000"
    }
  }'
```

Ejemplo, una venta en efectivo:

```sh
curl -X POST https://<cacao-cuentas>/api/v1/ventas \
  -H "Authorization: Bearer cl_XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX" \
  -H "Idempotency-Key: caja-2026-10-30-0007" \
  -H "Content-Type: application/json" \
  -d '{"referencia": "caja-0007", "producto": "pay", "descripcion": "Pupusa de queso", "monto_usd_centavos": 150, "medio": "efectivo"}'
```

Respuesta (201 si es nueva, 200 si ya existía):

```json
{
  "id": "5d0c2f3a-8e0b-4f1e-9a57-2b6c0d1e7a11",
  "estado": "registrada",
  "situacion": "nueva",
  "documento": { "numeroControl": "DTE-01-M001P001-000000000000001", "codigoGeneracion": "...", "estado": "aceptado", "sello": "SIMULADO-...", "observaciones": [] },
  "sinDocumento": null
}
```

- `documento.estado` es `aceptado`, `rechazado` o `pendiente`. Una venta pendiente se emite en la siguiente sincronización.
- Una venta de `negocios` no tiene documento del grupo: `documento` es `null` y `sinDocumento` dice `Sin documento: falta el registro fiscal del negocio`. Esa venta no cuenta en el tablero del grupo, ni en los libros, ni en los archivos F-07 y F-14.
- Una factura de BTCPay es un solo ticket. Si la sincronización con BTCPay ya la importó, la venta se liga a ese mismo ticket: no se crea otro. Lo mismo al revés.

## Leer una venta

`GET /api/v1/ventas/{id}`

Solo el cliente que la registró puede leerla. Otro cliente recibe 404.

```sh
curl https://<cacao-cuentas>/api/v1/ventas/5d0c2f3a-8e0b-4f1e-9a57-2b6c0d1e7a11 \
  -H "Authorization: Bearer cl_XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"
```

## Listar tus ventas

`GET /api/v1/ventas?desde=&hasta=&despues=&limite=`

Las ventas más nuevas primero. `desde` y `hasta` son fechas ISO-8601 (`hasta` no incluido). `limite` va de 1 a 200 (por defecto 50). Para la página siguiente, pasá en `despues` el valor de `despues` de la respuesta.

```sh
curl "https://<cacao-cuentas>/api/v1/ventas?desde=2026-10-01T00:00:00Z&limite=50" \
  -H "Authorization: Bearer cl_XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"
```

Respuesta: `{ "ventas": [ ... ], "despues": "2026-10-30T15:00:00.000Z" }`. `despues` es `null` cuando no hay más páginas.

## Reporte del mes del grupo

`GET /api/v1/reportes/mes/{YYYY-MM}`

Solo para un cliente con `--grupo`. Otro cliente recibe 403. Las cifras son las del libro del mes (las mismas que muestra la página del mes). No incluyen ventas de negocios.

```sh
curl https://<cacao-cuentas>/api/v1/reportes/mes/2026-10 \
  -H "Authorization: Bearer cl_XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"
```

## Errores

Toda respuesta de error tiene esta forma:

```json
{ "error": { "codigo": "IDEMPOTENCIA_CONFLICTO", "mensaje": "Esa clave o esa referencia ya se usó con otra venta." } }
```

| Código | HTTP | Qué pasó |
|---|---|---|
| `NO_AUTORIZADO` | 401 | Falta la clave, es inválida o fue revocada. |
| `NO_PERMITIDO` | 403 | La clave no puede leer ese reporte. |
| `NO_ENCONTRADA` | 404 | No hay una venta tuya con ese id. |
| `DATOS_INVALIDOS` | 400 | El cuerpo o un encabezado no cumple lo que pide la tabla. |
| `IDEMPOTENCIA_CONFLICTO` | 409 | La clave o la referencia ya se usó con otro cuerpo. |
| `DUPLICADO` | 409 | El pago ya tiene otra venta o ticket. |
| `LIMITE` | 429 | Demasiadas peticiones por minuto. |
| `NO_DISPONIBLE` | 503 | La base de datos no respondió. Repetí la misma petición, con la misma `Idempotency-Key`. |
| `INTERNO` | 500 | Falló el servidor. La causa queda en el registro del servidor. |

Ante un 503 o un error de red, repetí la misma petición con la misma `Idempotency-Key`: no se duplica.
