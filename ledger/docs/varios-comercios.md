# Varios comercios: credenciales y cifrado

Este documento describe cómo Ledger guarda las credenciales de cada comercio. Dice qué está hecho y qué no.

## Qué credenciales hay

Cada comercio puede tener tres tipos de credenciales:

- **Firmador**: la contraseña de la clave privada y la clave privada en PEM.
- **API de Hacienda**: el usuario de la API. Hoy no se guarda por comercio.
- **BTCPay**: la clave de API de la tienda. Hoy es una sola variable del servidor, no una por comercio.

Solo el firmador tiene material guardado por comercio. Los otros dos están pendientes.

## Cómo se guardan: sobre cifrado por comercio

Cada comercio tiene un archivo en `datos/comercios/<id>.json`. Ese archivo tiene:

- Datos públicos: id, NIT y fecha de alta.
- **Clave de datos (DEK)**: una clave aleatoria de 32 bytes, nueva para cada comercio.
- **Sobre de la DEK**: la DEK cifrada con la clave maestra (AES-256-GCM).
- **Material**: la contraseña y el PEM, cifrados con la DEK (AES-256-GCM).

Así funciona el sobre:

1. Se genera una DEK nueva para el comercio.
2. La clave maestra cifra la DEK. Eso es el sobre.
3. La DEK cifra el material. Ese es el payload.
4. Para leer, se abre el sobre con la clave maestra, y luego el payload con la DEK.

Cada cifrado usa un IV aleatorio de 12 bytes. Cada cifrado tiene su propia etiqueta de autenticación. Si alguien cambia un byte, el descifrado falla.

Un comercio no puede abrir el material de otro. Cada uno tiene su DEK. Esto está probado en `ledger/src/comercio/almacen.test.ts`.

## Clave maestra

- La clave maestra sale solo de la variable de entorno `LEDGER_CLAVE_MAESTRA`.
- Puede ser 64 caracteres hexadecimales, 32 bytes en base64, o una frase. Una frase se convierte con SHA-256.
- La clave maestra **no se escribe en disco** ni en `datos/`, ni en fixtures, ni en respaldos del repositorio.
- Sin la clave maestra no hay firma por comercio.

## Rotación

Hoy no hay rotación automática. Estos son los pasos previstos, aún no construidos:

- **Rotar la clave maestra**: abrir cada sobre con la clave vieja, volver a cifrar la DEK con la clave nueva, y guardar.
  El material no cambia.
- **Rotar la DEK de un comercio**: abrir el material con la DEK vieja, cifrarlo con una DEK nueva, y volver a cifrar la
  DEK nueva con la clave maestra.
- **Rotar la contraseña del firmador**: registrar de nuevo el comercio con el mismo NIT y la nueva contraseña.
  Hoy no existe un comando para eso; sería un paso aparte.

Cada rotación debería escribir una fecha. Hoy el registro solo guarda la fecha de alta. Por eso la página muestra
"Última rotación: No registrada".

## Qué nunca se registra

- La contraseña del firmador, la clave privada y la DEK no aparecen en logs, errores ni respuestas web.
- La clave maestra no aparece en logs ni en pantalla.
- Los mensajes de error dicen "no se pudo descifrar", sin valores.
- Las respuestas de la web solo dicen sí o no para cada credencial, y muestran el NIT enmascarado (últimos tres dígitos).
- El PEM de `fixtures/comercio-prueba/` es solo para pruebas. No es un certificado real.

## Quién puede ver qué

- **Página `/comercios`**: solo el dueño (usuario con `es_admin`). Muestra nombre del comercio, NIT enmascarado, si está
  cifrado, la fecha de alta, la última rotación (hoy no registrada) y sí o no para cada credencial.
- **CLI**: quien tiene la clave maestra y acceso a la carpeta `datos/` puede firmar. Es el único camino que descifra.
- **Supabase**: no guarda credenciales de comercio. Las tablas web tienen tickets, DTE y atestaciones.
- **Repositorio**: no contiene claves ni contraseñas reales.

## Respaldos

- Un respaldo de `datos/comercios/` solo contiene sobres y material cifrado. Sirve solo con la clave maestra.
- El respaldo y la clave maestra deben guardarse en lugares distintos.
- No se debe guardar la clave privada en claro en ningún respaldo.

## Lo que no está construido

- Guardar el usuario de la API de Hacienda por comercio.
- Guardar la clave de BTCPay por comercio.
- Script de rotación de clave maestra, de DEK o de contraseña.
- Fecha de última rotación en el registro.
- Registro de accesos (quién abrió una credencial y cuándo).
- Gestor de secretos o KMS para la clave maestra.
- Revisión del vencimiento del certificado.
- Página web que cambie credenciales. Hoy la página es solo de lectura.
- Validación del certificado ante el Ministerio.
