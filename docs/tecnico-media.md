# Cacao Media: arquitectura, pruebas y límites

Documento técnico del MVP de Micropayments for Content. Complementa el `README.md` (rutas de la API y puesta en marcha) con lo que hace falta para revisar el diseño: cómo se protege el texto cerrado, cómo se confirma un pago, qué queda guardado y qué no funciona todavía.

## 1. Arquitectura

```
Navegador                         Servidor Astro (Vercel)                   Base compartida (Supabase)
---------                         -----------------------                   --------------------------
historia (HTML construido) ---->  página estática con el texto gratis
  muro (CacaoGate, script)  --->  POST /api/cobro/           ----->  media_cobro_vigente / media_crear_cobro_btcpay
                                  GET  /api/cobro/<id>/      ----->  media_vencer_cobros, media_pagar_cobro, media_confirmar_btcpay
                                                               \-->  CacaoPay (pay/) o BTCPay: lectura de la factura
  token de 7 días (localStorage) GET /api/contenido/<slug>/  ----->  media_cerrado (texto cerrado)
  cookie cm_lector (HttpOnly)     POST /api/evento/          ----->  registrar_evento -> eventos
  Panel /admin (Clerk)            lee resumen, transacciones y actividad   ->  media_* y eventos
```

- **Texto gratis y texto cerrado.** Al construir la página, el plugin `src/lib/rehype-gate.mjs` corta cada historia de pago en el marcador `<!-- gate -->`. Lo que sigue al marcador no entra en el HTML: el texto cerrado se guarda en `media_cerrado` (lo sube `scripts/subir-cerrado.mjs`). Si una historia de pago no tiene marcador, la construcción falla: no puede salir texto cerrado por error.
- **Lector sin cuenta.** `src/lib/servidor/lector.ts` crea un id de lector con `media_lector` y lo guarda en la cookie `cm_lector` (HttpOnly, SameSite=Lax, un año). La página nunca recibe ese id.
- **Servidor.** Toda la lógica de cobro vive en `src/lib/servidor/cobros.ts`, `pay.ts` y `btcpay.ts`. El navegador solo muestra lo que el servidor responde.

## 2. Estados de una factura

| Estado | Quién lo fija | Cómo se llega |
|---|---|---|
| `pendiente` | `media_crear_cobro` o `media_crear_cobro_btcpay` | El lector pide la factura |
| `pagada` | `media_pagar_cobro` (demo), `media_confirmar_btcpay` o la lectura de CacaoPay | Pago confirmado, con acceso abierto |
| `vencida` | `media_vencer_cobros` | Pasaron 300 segundos sin pago. Se revisa en cada consulta |
| `fallida` | `media_fallar_cobro` | Solo en la demo ("Simular pago fallido") |

Las transiciones se hacen en funciones de Postgres (migraciones en `market/supabase/migrations/`, tablas `media_*`). Un pago fuera de plazo se rechaza con `FUERA_DE_PLAZO` y la factura queda vencida.

## 3. Confirmación y acceso

1. **Confirmación real (modo sin demo).** La factura es Lightning de prueba (regtest). La confirma CacaoPay (`pay/`) o BTCPay. El servidor no cree en el aviso: recibe el webhook (`/api/pagos/pay/` o `/api/pagos/btcpay/`), verifica la firma y después vuelve a leer la factura en el proveedor. Solo cuenta si el proveedor dice pagado o liquidado.
2. **Confirmación automática en el navegador.** Mientras la factura está pendiente, el muro consulta `GET /api/cobro/<id>/` cada 3 segundos. Cuando el servidor responde `pagada`, el muro muestra "Pago recibido." y abre la historia sin recargar la página.
3. **Demo.** Con `PUBLIC_DEMO=1` aparecen los botones "Simular pago" y "Simular pago fallido". Son rutas de demostración, responden 403 fuera de la demo, y no mueven dinero.
4. **Acceso.** Al pagar se crea una fila en `media_accesos` (un acceso por lector y por historia, sin vencimiento). El token firmado de 7 días (`src/lib/firma.ts`) deja leer el texto cerrado sin ir a la base en cada visita. Si el token vence, `POST /api/desbloquear/` emite uno nuevo solo si el lector ya tiene acceso en la base.

## 4. Protección del texto cerrado

Se verificó contra el servidor local de desarrollo:

- La página de una historia de pago no contiene el texto cerrado: `curl` de `/historias/la-barra-de-santiago/` no encontró la frase de la parte cerrada.
- `GET /api/contenido/la-barra-de-santiago/` sin token responde 401.
- Con un token falso (firma inválida) responde 401 con "Acceso vencido o inválido.".
- `GET /api/cobro/<id>/` con un id que no es del lector responde 404.

Las pruebas automáticas cubren además: que desbloquear una historia no abre otra, que un lector de otro navegador no puede leer la factura del primero, que un token con firma inválida se rechaza y que la API no entrega el texto sin token (`tests/gate.spec.ts`, `tests/media-btcpay.spec.ts`).

## 5. Persistencia y lo que no hay

- **Qué se guarda.** Facturas (`media_cobros`), accesos (`media_accesos`, una fila por lector y historia), lectores (`media_lectores`) y eventos del embudo (`eventos`, sitio `media`).
- **Por cuánto tiempo.** El acceso en la base no vence. La cookie del navegador dura un año. El token del navegador dura 7 días y se renueva solo.
- **Otro dispositivo.** **No hay forma de recuperar el acceso en otro dispositivo o navegador.** El acceso vive en la cookie del navegador. Si el lector cambia de celular, paga otra factura. Esto no está resuelto y no es un error de implementación: es el modelo sin cuenta.

## 6. Eventos del embudo y panel de administración

- **Eventos.** `vista_historia`, `vio_muro` y `leyo_completa` los envía el navegador (`POST /api/evento/`). `creo_cobro` y `pago` los registra el servidor. Los nombres deben estar en `eventos_permitidos` de la base.
- **Panel.** `/admin/` (resumen, embudo, transacciones y actividad) pide sesión de Clerk y una fila en `usuarios` con `es_admin = true`. Un visitante sin permiso recibe 404. `/admin/transacciones/` lista las facturas con su estado; `/admin/actividad/` muestra los eventos por historia.
- **Lectura del embudo.** "Leyó hasta el final" depende de que el lector llegue al final del texto abierto. En las pruebas de sesión no se llegó al final, y en la base de pruebas ese paso mostró 0 lectores. El código lo envía cuando el marcador final entra en pantalla; no quedó verificado en un navegador de punta a punta.

## 7. Pruebas

| Suite | Comando | Resultado en esta sesión |
|---|---|---|
| Tipos | `npm run check` | 0 errores, 0 advertencias |
| Construcción | `npm run build` | Completa |
| Unitarias | `npm run test:unit` | 38 pasan |
| Gate (servidor en modo demo) | `node --env-file=.env.local node_modules/@playwright/test/cli.js test --project=media tests/gate.spec.ts --workers=1` | 33 pasan |
| BTCPay (servidor sin demo, con CacaoPay en 4324) | `... test --project=media tests/media-btcpay.spec.ts --workers=1` | Con CacaoPay arriba: 8 pasan, 1 falla, 1 se omite. Después, con CacaoPay caído en 4324: 3 pasan, 6 fallan con 503 y 1 se omite |

Notas de la suite BTCPay:

- La prueba de "no admin" falla en el entorno de pruebas: la cuenta de no administrador entra al panel como administradora. Es un dato de la base de pruebas (fila de `usuarios`), no del código.
- La prueba "BTCPay caído" se omite: necesita un segundo servidor en el puerto 4331 con `BTCPAY_URL` apuntando a un puerto muerto, y no se pudo levantar en esta sesión (Astro no permite dos servidores del mismo proyecto).
- El servidor de la suite debe correr con `PUBLIC_DEMO=0`. Con la demo encendida, las facturas son simuladas (`lnsim1…`) y la suite lo detecta.

## 8. Límites conocidos

- **Dinero simulado.** Las facturas son de bitcoin de prueba (regtest). No hay pagos reales.
- **Acceso atado al navegador.** Ver sección 5.
- **Sin reembolsos ni disputas.** No hay flujo para devolver un pago ni para reclamar acceso.
- **Historias de muestra.** El contenido no pasó por revisión editorial.
- **Precio fijo.** Todas las historias de pago cuestan 120 sats. La regla de gratis por Travel está en el contenido y se verifica con `tests/unit/travel-gratis.test.ts`; no se aplica sola cuando Travel cambia sus enlaces.
- **Valor en dólares.** Sale del precio de bitcoin de dos fuentes (Coinbase y Kraken). Si no coinciden por más de 2%, el servidor no crea factura. Con `PRECIO_FIJO_USD_BTC` se usa un precio fijo para demos.
- **Widget de Travel.** Lee `/api/tours.json` desde el navegador. En pruebas automáticas, ese dominio respondió 403 al navegador de prueba, aunque responde 200 a una llamada directa. La prueba del widget usa la API simulada.
- **Panel sin pruebas de extremo a extremo.** El panel se probó con la cuenta de prueba de la suite BTCPay; no se revisó con una cuenta real del equipo.
- **Documentación de la base.** `README.md` describe las facturas como creadas por BTCPay; desde que CacaoPay es la capa de pagos del grupo, la factura la crea CacaoPay cuando `pay/` está configurado, y BTCPay queda como respaldo. Esta diferencia está en `src/lib/servidor/cobros.ts` (`cobroPay`).

## 9. Integración futura con Lightning

Hoy el flujo real ya usa Lightning de prueba. Para salir de regtest hacen falta, como mínimo:

1. Cambiar la red de BTCPay o CacaoPay de regtest a mainnet, con nodos propios o un proveedor, y revisar los montos mínimos de factura.
2. Mantener la regla de confirmación: solo cuenta lo que el proveedor reporta como pagado, releído en el momento de confirmar.
3. Decidir el modelo de acceso entre dispositivos (cuenta opcional) antes de cobrar, porque cambia la política de recuperación.
4. Agregar conciliación: un proceso que compare `media_cobros` con los pagos del proveedor cada noche.
5. Revisar requisitos legales y de facturación antes de vender.

No se hizo ninguno de estos pasos en el MVP.

## 10. Qué se cambió en esta revisión

- El muro explica qué es un sat y muestra el valor en dólares solo cuando el servidor lo calculó.
- El muro dice que el acceso queda en ese navegador y que otro navegador o celular requiere otra factura.
- Se agregó una prueba que verifica que las historias vinculadas a Travel son gratis y las demás cuestan 120 sats.
