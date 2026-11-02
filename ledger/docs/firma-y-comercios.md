# Firma con SVFE y credenciales por comercio

Este documento describe lo que CacaoLedger agrega en los puntos opcionales 7 y 10 del caso
TBHS. No sustituye la guía de integración del Ministerio ni conecta a sus servicios de
producción desde este repositorio.

## 7. Firmador SVFE-API-Firmador y JWS

### Qué hace CacaoLedger

Después de `dte construir`, podés ejecutar:

```
node src/cli.ts dte firmar <id> [--comercio <id>] [--firmador-url <url>]
```

El comando:

1. Lee el JSON del DTE guardado en `datos/`.
2. Toma el NIT y la contraseña de la clave privada del comercio elegido (descifrados en
   memoria; ver sección 10).
3. Envía un `POST` JSON al firmador, con la forma que documenta el ecosistema SVFE:

   - `nit` (14 dígitos)
   - `passwordPri`
   - `dteJson` (el documento completo)

4. Guarda el JWS devuelto en `datos/dte/firmas/<codigoGeneracion>.jws.txt` y lo enlaza al
   ticket.

La URL por defecto esperada es la del contenedor oficial:

`http://127.0.0.1:8113/firma/firmardocumento/`

Podés cambiarla con `--firmador-url` o con la variable de entorno `LEDGER_FIRMADOR_URL`.

### Firma local de prueba (sin firmador)

Si no hay `--firmador-url` ni `LEDGER_FIRMADOR_URL`, `dte firmar` firma en local con una clave de
prueba (`src/firma/firma-local.ts`):

- La primera vez genera un par RSA de 2048 bits y lo guarda en `datos/firma-prueba/`, carpeta
  ignorada por git. La clave privada queda con permisos 0600 y nunca se imprime.
- Produce un JWS compacto con `alg` RS512 sobre el JSON del DTE, con la misma forma que devuelve
  el firmador.
- `ticket ver` y la salida de `dte firmar` marcan ese JWS como clave de prueba, no válida ante
  Hacienda. No es un certificado del Ministerio y no se transmite.

Con una URL configurada, el comportamiento es el de siempre.

### Cómo correría el firmador real (fuera de CacaoLedger)

El Ministerio publica el proyecto **svfe-api-firmador** y la imagen Docker
`svfe/svfe-api-firmador`. En un entorno real:

1. Descargás el certificado de firma del contribuyente desde el portal del Ministerio.
2. Montás el `.crt` (y el material que pida la imagen) en la carpeta que el contenedor
   expone, normalmente renombrado al NIT de 14 dígitos.
3. Levantás el servicio en el puerto **8113** (o el que configures).
4. Configurás `LEDGER_FIRMADOR_URL` apuntando a ese host.

CacaoLedger **no** sube el certificado al firmador: solo envía `nit`, `passwordPri` y
`dteJson`. Quien opera el firmador debe tener el `.crt` correcto montado ahí.

### Qué no está conectado

- **No hay transmisión** del JWS a `apitest.dtes.mh.gob.sv` ni a producción.
- **No hay autenticación** contra la API de recepción del Ministerio.
- Si el firmador no responde, `dte firmar` falla con un mensaje claro; **`dte transmitir
  --simulado` sigue igual** y no exige JWS.
- Los tests usan un servidor HTTP falso en localhost; no piden Docker ni el firmador real.
- El PEM de `fixtures/comercio-prueba/` es **solo para pruebas locales**; no es un
  certificado de contribuyente y Hacienda no lo reconocería.

## 10. Varios comercios y cifrado por sobre

### Modelo

Cada comercio tiene un registro en `datos/comercios/<id>.json`:

- Metadatos públicos: `id`, `nit`, `creado`.
- Un **sobre** (`sobreDek`) con la clave de datos (DEK) cifrada con la clave maestra.
- El **material** cifrado con esa DEK: contraseña de la clave privada (`passwordPri`) y
  copia PEM de la clave privada para respaldo local.

La clave maestra sale **solo** de la variable de entorno `LEDGER_CLAVE_MAESTRA` (32 bytes
en hex o base64, o una frase que se deriva con SHA-256). **No se escribe** en `datos/`, en
fixtures de demo ni en respaldos del repositorio.

Un comercio no puede descifrar el material de otro: cada uno tiene su DEK distinta. Si
intentás abrir el blob de B con la DEK de A, AES-GCM rechaza el descifrado.

### Comandos

Registrar un comercio (requiere `LEDGER_CLAVE_MAESTRA` en el entorno):

```
node src/cli.ts comercio registrar <id> --nit <14 dígitos> --password-pri <clave> --clave-privada <archivo.pem>
node src/cli.ts comercio lista
```

El primer comercio registrado queda como **activo** en `datos/comercios/indice.json`. `dte
firmar` usa ese id salvo que pases `--comercio`.

La demostración (`npm run demo`) sigue con un solo comerciante en pantalla; el módulo
admite varios registros en la misma carpeta `datos/`.

### Límites honestos

- CacaoLedger **guarda** la clave privada cifrada; el firmador oficial, en cambio, suele
  leer el `.crt` del volumen. Operativamente necesitás **ambos** alineados (mismo NIT).
- Sin `LEDGER_CLAVE_MAESTRA` no hay registro ni firma por comercio.
- Rotar la clave maestra no está automatizado; sería un script de migración aparte.
- Nada de esto valida el certificado ante el Ministerio ni comprueba vencimiento.
