# Transmisión al servicio de prueba (svfe-mock-api)

Esta guía explica cómo transmitir los documentos a un servicio de prueba local y activar esa transmisión en el ledger.

El servicio de prueba es el mock comunitario [svfe-mock-api](https://github.com/antonio0x/svfe-mock-api). **No es Hacienda** y sus sellos no tienen validez fiscal. Por eso cada sello que muestran la CLI y la web dice de dónde vino.

## Cómo correrlo

Sin Docker, usando el Postgres local de Supabase (puerto 54322) con una base propia `svfe_mock`:

```powershell
cd svfe-mock-api   # un clon de https://github.com/antonio0x/svfe-mock-api
# .env (no se versiona): PORT=3100 y DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/svfe_mock
npm install
npx prisma generate
npx prisma db push
npm run prisma:seed
npm run build
npm start
```

Con `npm start` la API queda en `http://127.0.0.1:3100`. Para comprobarlo:

```powershell
curl.exe -s http://127.0.0.1:3100/health
```

El usuario de prueba del mock es el NIT `06141234567890`, con la clave `password123`.

## Cómo activarlo en el ledger

La transmisión se activa con variables de entorno. Si falta cualquiera de las cuatro obligatorias, el ledger sigue usando el simulador local, como antes.

| Variable | Qué es |
|---|---|
| `LEDGER_HACIENDA_URL` | Dirección del servicio, por ejemplo `http://127.0.0.1:3100`. |
| `LEDGER_HACIENDA_NIT` | NIT del emisor registrado en el servicio. |
| `LEDGER_HACIENDA_CLAVE` | Clave del emisor en el servicio. |
| `LEDGER_HACIENDA_CLAVE_FIRMA` | Clave privada PEM (PKCS#8) con la que se firma el documento. Se guarda fuera del repositorio. |
| `LEDGER_HACIENDA_TIMEOUT_MS` | Opcional. Tiempo máximo por petición. Por defecto 15000. |

1. Crear una clave de prueba fuera del repositorio:

   ```powershell
   openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out $HOME\clave-firma-prueba.pem
   ```

2. Registrar la clave pública en el mock (hay que hacerlo una vez por clave):

   ```powershell
   cd cacao\ledger
   $env:LEDGER_HACIENDA_URL = "http://127.0.0.1:3100"
   $env:LEDGER_HACIENDA_NIT = "06141234567890"
   $env:LEDGER_HACIENDA_CLAVE = "password123"
   $env:LEDGER_HACIENDA_CLAVE_FIRMA = Get-Content $HOME\clave-firma-prueba.pem -Raw
   npm run hacienda:registrar
   ```

3. Transmitir un ticket pagado. Sin `--simulado`, el documento va al servicio:

   ```powershell
   node src/cli.ts dte transmitir TK-20261102-0102
   ```

   Con `--simulado` se usa siempre el simulador local, aunque las variables estén puestas.

En la web, las mismas variables deben estar en el entorno del servidor. Cada documento emitido se firma con `LEDGER_HACIENDA_CLAVE_FIRMA` y se envía al servicio; el sello que devuelve el mock es el que se guarda y se muestra.

## Qué pasa en cada respuesta

- **Aceptado**: el ticket queda emitido con el sello del mock. Se muestra como "sello de prueba del mock svfe-mock-api (no es de Hacienda)".
- **Rechazado**: el ticket queda rechazado y se muestran las observaciones del mock, campo por campo.
- **Sin respuesta** (tiempo agotado o conexión caída): el documento queda en contingencia y no se marca como rechazado. En la CLI se vuelve a transmitir con el mismo comando. En la web, la retransmisión de contingencias todavía no tiene un disparador propio para el servicio real: hoy sólo la usa el control de simulación del cierre.
- **Error de autenticación**: el documento no se transmite y el ticket queda pagado para el siguiente intento.

## Límites conocidos del mock

Hallados al probar el ledger contra el mock, sin cambiar el mock:

- Para la factura 01, el mock aplica la regla BIZ_004 sumando el IVA encima de `ventaGravada`. El ledger emite la factura con el IVA dentro del precio, como ve el consumidor, así que el mock rechaza una factura correcta por diferencia de total.
- El mock valida los montos con `multipleOf` de ajv, que usa división en coma flotante. Montos como `1.13` o `4.52` fallan aunque sean centavos exactos. Un CCF de `5.00` pasa.

Las pruebas de integración contra el mock están en `src/hacienda/mock.integracion.test.ts`. Se saltan si no está definida `LEDGER_HACIENDA_URL`.
