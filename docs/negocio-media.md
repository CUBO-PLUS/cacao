# Cacao Media: estrategia de negocio

Este documento responde a los entregables no técnicos del reto Micropayments for Content: usuario objetivo, mercado, comparación de modelos, precios, límites de la vista previa, compra repetida, indicadores y recomendación.

**Importante sobre los datos.** Este repositorio no contiene investigación de campo: no hay entrevistas, encuestas ni cifras de mercado medidas por nosotros. Todo lo que no tenga una fuente citada está marcado como **hipótesis**, y la sección "Qué falta validar" dice cómo comprobarlo. Los números de precio que aparecen son los del producto (120 sats) y aritmética simple; no son datos de mercado.

## 1. Problema

Leer una crónica o una guía de un sitio de El Salvador suele obligar a elegir entre dos extremos: un sitio con publicidad que nos sigue sin pagarle al autor, o una suscripción mensual para leer una sola cosa. Hipótesis: hay lectores que pagarían unos centavos por una historia concreta, pero no una suscripción.

## 2. Usuario objetivo (hipótesis)

- **Quién:** personas de El Salvador de 18 a 40 años que leen contenido de viajes, cultura y café, en el celular, y que ya usan algún medio de pago digital.
- **Qué busca:** saber qué hacer o qué comer en un lugar antes de ir, sin pagar por algo que no va a usar.
- **Qué le molesta:** registrarse, dar datos personales y pagar cada mes.
- **Qué necesita para pagar:** entender en una frase qué es un sat, ver el valor en dólares y poder pagar desde una billetera Lightning en menos de un minuto.

Esta descripción es una hipótesis de trabajo. No se validó con lectores reales.

## 3. Mercado y competencia

No hay cifras de tamaño de mercado en este repositorio. Lo que sí podemos decir con honestidad es qué referencias existen en el modelo y qué no:

| Referencia | Qué hace | Qué nos diferencia |
|---|---|---|
| Medios con suscripción | Cobran una cuota mensual por todo el archivo | Cobramos por historia; no hay cuenta |
| Medios con publicidad | Leen gratis, ganan con anuncios | No hay anuncios en el muro; el lector paga directo al autor |
| Muros de pago tipo "freemium" | Dejan leer el comienzo y piden suscripción | Mismo muro, pero el precio es por historia |
| Pago por contenido con bitcoin | Experimentos aislados de propinas o micropagos | Aquí el pago es Lightning, con factura y acceso guardado |

Cualquier afirmación sobre el tamaño de cada grupo o sobre competidores específicos debe validarse antes de usarla en público.

## 4. Comparación de modelos

Valoración cualitativa, sin cifras. Es una hipótesis razonada, no un resultado medido.

| Criterio | Suscripción | Publicidad | Freemium | Micropago (este producto) |
|---|---|---|---|---|
| Lo que paga el lector | Cuota fija aunque lea poco | Nada (paga con atención) | Cuota si quiere más | Solo lo que lee |
| Fricción para empezar | Alta: cuenta y tarjeta | Ninguna | Media: cuenta | Baja: sin cuenta, una factura |
| Ingreso para el autor | Depende de cuántos se suscriben | Depende de visitas | Depende de conversión | Directo por historia |
| Riesgo principal | Abandono a los pocos meses | Lectura superficial, anuncios molestos | Muro demasiado caro o demasiado pronto | Pocas compras si la historia no vale el precio |
| Dependencia técnica | Cuentas, cobros recurrentes | Red publicitaria | Cuentas y permisos | Factura, confirmación y acceso |

Hipótesis principal: el micropago funciona mejor para historias de consulta única (guías, rutas) que para noticias del día. Por eso las crónicas y guías son las que tienen muro, y el archivo de cultura y café queda más abierto.

## 5. Precio

**Precio actual (producto).** Cada historia de pago cuesta **120 sats**. Las historias vinculadas a una experiencia de Cacao Travel son gratis. Esta regla está en `src/content/historias/` (campo `gratis`) y la prueba `tests/unit/travel-gratis.test.ts` la verifica contra la lista de historias que Travel enlaza.

**Precio propuesto para validar.** Mantener un precio único y bajo para todas las historias de pago, y revisar después con datos reales. Razones que podemos sostener sin datos externos: un precio único se entiende en una frase; un precio por historia exige decidir un valor para cada una sin criterio objetivo.

**Equivalencia en dólares.** El muro muestra el valor en dólares al precio de bitcoin del momento, calculado en el servidor a partir de dos fuentes públicas. Como referencia de aritmética: si un bitcoin valiera 100,000 dólares, 120 sats serían 0.12 dólares. Ese número es ilustrativo y cambia con el precio de bitcoin; no es una proyección.

**Cómo se explica el sat.** El muro dice que un sat es la cienmillonésima parte de un bitcoin y muestra el monto en sats junto con el valor en dólares. No muestra un precio en dólares que no venga del precio actual.

## 6. Límites de la vista previa

- **Qué se muestra gratis:** el texto que va antes del marcador `<!-- gate -->` del archivo de cada historia. Ese texto llega a la página ya construida; el resto no se envía al navegador.
- **Dónde corta:** en el marcador `<!-- gate -->`, al final del texto gratis. En el repositorio, el archivo de cada historia de pago termina en ese marcador: el texto cerrado no está en `src/content/` sino en la tabla `media_cerrado` de la base. Por eso no podemos medir desde el repositorio qué porcentaje del texto es gratis; hay que medirlo sobre la tabla (pendiente).
- **Qué no se puede ver sin pagar:** el resto del texto, hasta el final. No hay imágenes ni datos cerrados fuera del texto.
- **Historias gratis:** las vinculadas a Travel, o con `gratis: true`. No tienen muro.

## 7. Compra repetida y persistencia del acceso

Lo que existe hoy:

- **Acceso permanente por historia y por navegador.** Al pagar, se crea una fila en `media_accesos` para ese lector y esa historia. La cookie del lector dura un año. Si el lector vuelve al mismo navegador, la historia se abre sin pagar otra vez.
- **Pase firmado de 7 días.** El navegador guarda un token que vence a los 7 días. Si vence, el servidor emite uno nuevo solo a quien ya tiene acceso.
- **Sin acceso entre dispositivos.** El acceso vive en la cookie y en el token de un navegador. Si el lector cambia de celular o de navegador, tiene que pagar otra factura. **No hay forma de recuperar el acceso en otro dispositivo.** Esto es un límite real, no un detalle.

Ideas para la compra repetida (hipótesis, sin implementar):

1. Pase por tema: pagar una vez para abrir todas las guías de una misma región, en vez de una sola historia.
2. Descuento para quien ya compró una historia de Travel y después lee la historia vinculada (el widget de Travel ya lee el token).
3. Recordatorio en el archivo de historias pagadas que el lector ya tiene, para no volver a pagarlas.
4. Cuenta opcional, solo si el lector quiere recuperar su acceso en otro dispositivo. Hoy no existe; agregarla cambia el modelo "sin cuenta" y tiene que decidirse con el equipo.

## 8. Datos que pedimos al lector

- **Ningún dato personal.** No se pide nombre, correo, teléfono ni tarjeta.
- **Datos técnicos mínimos:** un identificador anónimo de navegador (cookie `HttpOnly`), y eventos del embudo guardados con ese identificador. Los eventos no guardan datos personales.

## 9. Flujo de pago y estados que ve el lector

| Estado | Qué ve el lector | Qué pasa después |
|---|---|---|
| Sin factura | Precio en sats, valor en dólares, explicación del sat y botón "Desbloquear" | Pide la factura |
| Pendiente | QR, factura para copiar, cuenta regresiva de 5 minutos | La página consulta cada 3 segundos |
| Pagada | "Pago recibido." y la historia se abre en su lugar | Se guarda el acceso |
| Vencida | "La factura venció. No la pagués." y botón para pedir otra | Se crea una factura nueva |
| Fallida | "El pago no se completó." con el motivo | Botón para intentar de nuevo |

Mientras la factura está pendiente, el lector puede cerrar la página: al volver, la factura sigue viva hasta que venza.

## 10. Indicadores (KPI)

Los eventos del embudo ya existen en la base de datos y el panel de administración los muestra. Cada indicador sale de esos eventos.

| Indicador | Definición | Evento o fuente | Meta de referencia |
|---|---|---|---|
| Apertura de historias de pago | Lectores distintos que abren una historia de pago | `vista_historia` | Sin meta; es la base |
| Llegada al muro | Lectores que ven el muro en pantalla | `vio_muro` / apertura | Hipótesis: más de la mitad |
| Pedido de factura | Lectores que piden factura | `creo_cobro` / llegada al muro | Hipótesis: 1 de cada 5 |
| Pago | Lectores que pagan | `pago` / factura creada | Hipótesis: al menos 2 de cada 3 |
| Conversión total | Pagos / aperturas de historias de pago | `pago` / `vista_historia` | Hipótesis: alrededor de 1 de cada 3 |
| Consumo | Lectores que llegan al final del texto abierto | `leyo_completa` / pagos | Hipótesis: más de la mitad de los que pagan |
| Retención | Lectores que vuelven a una historia pagada o compran otra | Consultas sobre `pago` por lector | Hipótesis: a definir tras un mes de datos |

**Nota sobre las metas.** Son hipótesis para empezar a medir, no objetivos respaldados por datos. Se cambian cuando haya un mes de eventos reales.

**Lectura del panel.** La pantalla de actividad muestra por historia cuántos lectores llegaron a cada paso. Ese dato le sirve al autor para saber si el comienzo convence (si pocos llegan al muro) o si el precio frena (si llegan y no piden factura).

## 11. Qué falta validar

1. Entrevistas con 8 a 10 lectores de los perfiles de la sección 2, sobre si pagarían 120 sats por una historia.
2. Un mes de eventos reales para calcular las tasas de la sección 10.
3. Una prueba de precio: 120 sats frente a un precio más bajo, en historias comparables.
4. Una prueba de cuenta opcional: cuántos lectores la quieren cuando se les explica que sirve para recuperar el acceso.

## 12. Riesgos

- **Precio de bitcoin.** Un cambio fuerte cambia el valor en dólares del muro. El muro lo muestra en el momento, pero el lector puede sentir que el precio se movió.
- **Acceso atado al navegador.** Un lector que pierde su celular pierde el acceso. Sin cuenta no hay forma de recuperarlo.
- **Historias de muestra.** El contenido es de muestra y no pasó por verificación editorial. No se debe vender como producción.
- **Dinero simulado.** Hoy los pagos usan bitcoin de prueba (regtest), sin valor. Antes de cobrar de verdad hay que cambiar de red y pasar revisión legal.

## 13. Recomendación final (hipótesis)

Mantener el modelo de micropago por historia con precio único, comenzar por las guías y crónicas de mayor consulta, y medir el embudo durante un mes antes de cambiar precios. Agregar la cuenta opcional solo si las entrevistas muestran que la pérdida de acceso entre dispositivos frena las compras. Esta recomendación depende de validar las hipótesis de las secciones 2, 4 y 10.
