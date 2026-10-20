# CacaoPay

CacaoPay es el simulador de remesas familiares del grupo Cacao para El Salvador. Una persona envía dinero a su familiar en El Salvador, ve por separado la comisión, el tipo de cambio con su fuente y el monto exacto que llega antes de confirmar, y sigue la transferencia con un código único hasta que se entrega en efectivo, en cuenta bancaria o en bitcoin por Lightning.

Todos los pagos son simulados: no se mueve dinero ni bitcoin real, y la aplicación no guarda llaves privadas ni frases semilla.

Versión en línea: https://cacao-pay.vercel.app

## Qué incluye

- **Cotizador público en `/`** que funciona sin iniciar sesión. La aritmética entera vive en [`src/lib/cotizacion.ts`](src/lib/cotizacion.ts) y está cubierta por [`src/lib/cotizacion.test.ts`](src/lib/cotizacion.test.ts).
- **Ingreso con Clerk** en `/entrar` (celular `+503` o correo) y alta en `/registrarse`. Clerk guarda la sesión; Supabase guarda los datos, y la fila de `usuarios` se enlaza por `clerk_id` con el RPC `vincular_clerk`.
- **Envío en tres pasos en `/enviar`**: monto y vía de entrega (`efectivo`, `cuenta`, `lightning`), datos del destinatario y confirmación con clave de idempotencia.
- **Vistas para quien envía (`/envios`, `/envios/[id]`), para quien recibe (`/recibidos`, `/recibidos/[id]`) y seguimiento público sin cuenta (`/rastrear`, `/t/CP-XXXX-XXXX`)** donde nunca se exponen la comisión ni los datos privados del remitente.
- **Marco tributario y regulatorio de El Salvador (`/hacienda` y [`src/lib/hacienda.ts`](src/lib/hacienda.ts))**: tratamiento del principal de la remesa familiar como valores recibidos del exterior (**Art. 3 numeral 4 LISR**, con alcance para remesas no confirmado), tratamiento del monto transferido en IVA no verificado, y desglose de **IVA del 13%** (**Formulario F-07**) y **Pago a Cuenta del 1.75%** (**Formulario F-14 v17**, Art. 151 CT) sobre el cobro del servicio local, conectado con **CacaoLedger** (`https://cacao-cuentas.vercel.app`).
- **Monitor administrativo (`/monitor`)**: resumen por período, liquidación tributaria sobre envíos entregados, lista filtrable de envíos, embudo de conversión y tabla de tarifas, códigos `CAT-017` y tasas de cambio.

## Cómo correrlo en local

La base de datos se comparte con CacaoMarket. La pila local de Supabase vive en `market/` y corre en Docker en `http://127.0.0.1:54321`. Levantala primero desde `market/` como indica el README de CacaoMarket (`npx supabase start` y `node --env-file=.env.local scripts/sembrar.mjs`).

Después, en esta carpeta (`pay/`):

```bash
npm install
cp .env.example .env.local
```

Completá las variables en `.env.local` con las llaves locales que imprime `npx supabase status`. El servidor de desarrollo escucha en el puerto `4324`:

```bash
npm run dev
```

Abrí `http://localhost:4324`. Hacen falta `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` y `CLERK_SECRET_KEY` en `.env.local`.

## Comandos

| Comando | Qué hace |
|---|---|
| `npm run dev` | Servidor de desarrollo en el puerto 4324 |
| `npm run build` | Construcción de producción |
| `npm start` | Sirve la construcción de producción en el puerto 4324 |
| `npm run lint` | Revisión con ESLint |
| `npm run check` | Verificación de tipos con `tsc --noEmit` |
| `npm test` | Pruebas unitarias y de base de datos con Vitest |
| `npm run e2e` | Pruebas de navegador con Playwright |

## Pruebas

Hay tres niveles de pruebas:

- **Unitarias** (`src/lib/*.test.ts`): verifican la aritmética de cotización, el desglose tributario de Hacienda (`hacienda.test.ts`), la máquina de estados y el formato de códigos y contactos. No requieren servidor.
- **De base de datos** (`tests/db/`): llaman a las funciones de PostgreSQL de la pila local (`pay_crear_transferencia`, transiciones de estado, límites, aislamiento de permisos y consultas del monitor).
- **De navegador** (`tests/e2e/`): recorren la aplicación en Chromium con ancho de teléfono (`375 px` y `320 px`) verificando cotización, creación, rastreo sin sesión, vista de destinataria, monitor y seguridad.

Para correr todas las pruebas de Vitest (unitarias más base de datos):

```bash
node --env-file=.env.local node_modules/vitest/vitest.mjs run
```

Para correr las pruebas de navegador (con Supabase local activo y `npm run dev` corriendo en el puerto 4324):

```bash
node --env-file=.env.local node_modules/@playwright/test/cli.js test
```

| Archivo | Qué comprueba |
|---|---|
| `envio.spec.ts` | Recorrido completo: cotización, tres pasos, código, puesta en camino, rastreo sin sesión, entrega desde el monitor y comprobante |
| `monedas.spec.ts` | Euros a cuenta bancaria, dólares a sats por Lightning y rechazo de montos fuera de límite (`$0.50` y `$5,000.00`) |
| `estados.spec.ts` | Cancelación antes de salir, fallo con motivo desde el monitor, botones de simulación en modo demo y bloqueo de acciones al terminar |
| `destinatario.spec.ts` | Envío al celular de Rosa, vista en `/recibidos` sin exponer la comisión y bloqueo de envíos de terceros |
| `riesgos.spec.ts` | Doble toque idempotente, cotización alterada en el navegador, acceso denegado al monitor, códigos inexistentes y escape de HTML en nombres y notas |
| `movil.spec.ts` | Cero desborde horizontal en `320 px` en todas las rutas públicas, de remitente, de destinataria y de administración |

## Cómo recorrer la demostración

Toma unos dos minutos desde el teléfono o en una ventana angosta:

1. Entrá con una cuenta de Clerk desde `/entrar`. Si todavía no tenés una, creala en `/registrarse`.
2. Entrá a **"Enviar dinero"**. Dejá **"Dólares (USD)"** y **"Efectivo"**. Escribí `100` en **"Monto a enviar"**. Las cuatro líneas muestran: `$100.00` enviados, `$3.49` de comisión, sin cambio de moneda (El Salvador usa dólares) y `$96.51` que recibe tu familiar.
3. Tocá **"Seguir"**. Escribí **"Marta Hernández"** y el celular `7612 3456`, y tocá **"Seguir"** otra vez.
4. Revisá el resumen y tocá **"Confirmar envío"**. Se abre la transferencia con su código `CP-XXXX-XXXX`, estado **"Sin enviar"**, el desglose tributario para Hacienda (principal recibido como valores del exterior según Art. 3 num. 4 LISR, con alcance no confirmado, y desglose de IVA 13% y Pago a Cuenta 1.75% sobre la comisión) y el comprobante imprimible.
5. Tocá **"Enviar ahora"** y después **"Sí, enviar ahora"**. El estado pasa a **"En camino"**.
6. Abrí una ventana privada en `/rastrear` y pegá el código (incluso en minúsculas o sin guiones). La página muestra `$96.51` y **"En camino"**, sin exponer el nombre del remitente, su teléfono ni la comisión.
7. Cerrá la sesión, entrá con una cuenta que tenga `es_admin` en `usuarios`, abrí **"Monitor"**, revisá la tabla de liquidación tributaria (F-07 y F-14 v17), entrá al envío y marcalo como **"Entregado"**.
8. Volvé a la ventana privada: la página pública pasa a **"Entregado"** sola, sin recargar.

## Cumplimiento de los entregables del reto Remittance Service

| Requisito del reto | Dónde se cumple | Estado |
|---|---|---|
| Interfaces de remitente y destinatario | `/enviar`, `/envios`, `/recibidos`, `/t/[codigo]` | Cumple |
| Ingresar monto a transferir | `/enviar` (paso 1) y cotizador en `/` | Cumple |
| Dos o más monedas o denominaciones | `USD` y `EUR` en origen; `USD` y `SATS` (Lightning) en destino | Cumple |
| Conversión con tasa definida y fuente | `src/lib/cotizacion.ts`, `pay_tasas` (`EUR/USD 1.08`) y oráculo `Coinbase + Kraken` para `BTC/USD` | Cumple |
| Comisiones separadas del tipo de cambio | Línea de comisión independiente con su fórmula explícita | Cumple |
| Monto final recibido por el destinatario | Línea **Recibe**, redondeada hacia abajo | Cumple |
| Creación de transferencias simuladas con código único | `pay_crear_transferencia` y código `CP-XXXX-XXXX` | Cumple |
| Máquina de estados (`Created`, `Processing`, `Completed`, `Failed`, `Cancelled`) | `creada`, `procesando`, `completada`, `fallida`, `cancelada` (`src/lib/transferencias.ts`) | Cumple |
| Historial e inspección individual | `/envios`, `/recibidos`, `/envios/[id]` y `pay_historial` | Cumple |
| Mecanismo simulado para completar o fallar envíos | Botones de modo demo y acciones del monitor administrativo | Cumple |
| Panel administrativo y embudo de conversión | `/monitor`, `/monitor/envios`, `/monitor/embudo`, `/monitor/tarifas` | Cumple |
| Validación de cálculos en el servidor y en la base de datos | `cotizarEnServidor`, `crearEnvio` y `_pay_calcular` en PostgreSQL | Cumple |
| Documentación de arquitectura y conexión a Bitcoin y Lightning | [`docs/arquitectura-y-lightning.md`](docs/arquitectura-y-lightning.md) | Cumple |
| Documentación de API, acciones y funciones de base de datos | [`docs/api.md`](docs/api.md) | Cumple |
| Marco tributario de Hacienda (DGII), BCR y entregable estratégico | `/hacienda`, [`src/lib/hacienda.ts`](src/lib/hacienda.ts) y [`docs/hacienda-y-regulacion.md`](docs/hacienda-y-regulacion.md) | Cumple |
| Pruebas de cálculo, base de datos y recorrido de punta a punta | `src/lib/*.test.ts`, `tests/db/*.test.ts` y `tests/e2e/*.spec.ts` | Cumple |

## Variables de entorno

Los nombres están en `.env.example`; los valores reales van en `.env.local` (ignorado por git).

| Variable | Propósito |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Dirección del proyecto de Supabase |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Clave pública para validar la sesión del visitante |
| `SUPABASE_SERVICE_ROLE_KEY` | Clave de servicio exclusiva del servidor para llamar a las funciones RPC |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Clave pública de Clerk para `/entrar` y `/registrarse` |
| `CLERK_SECRET_KEY` | Clave secreta de Clerk, solo en el servidor |
| `PRECIO_FIJO_USD_BTC` | Precio fijo opcional de 1 BTC en USD para trabajar sin red y correr las pruebas |
| `NEXT_PUBLIC_DEMO` | Con `1` activa los botones del simulador de envíos |

## Documentación

- [Hacienda, regulación del BCR y estrategia de remesas](docs/hacienda-y-regulacion.md): valores recibidos del exterior (Art. 3 num. 4 LISR), IVA del 13% (F-07), Pago a Cuenta del 1.75% (F-14 v17), conexión con CacaoLedger para DTE 01/03, normas del BCR (`NRP-19`, `NRP-29`), Ley Bitcoin (D.L. 199), CNAD, UIF y análisis estratégico del corredor.
- [Arquitectura técnica y camino a Bitcoin y Lightning](docs/arquitectura-y-lightning.md): modelo de capas, seguridad por `service_role`, aritmética entera, oráculo de precios e integración en producción con Blink, LNURL-pay, Transfer365 y CacaoLedger.
- [Referencia de API y base de datos](docs/api.md): rutas HTTP, acciones de servidor, funciones de `src/servidor/`, módulos de `src/lib/`, funciones RPC de PostgreSQL y códigos de error.
