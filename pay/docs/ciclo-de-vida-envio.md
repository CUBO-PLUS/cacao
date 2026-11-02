# Ciclo de vida del envío

Estados y reglas están en [`src/lib/transferencias.ts`](../src/lib/transferencias.ts). La base de datos los vuelve a comprobar en las funciones `pay_*`.

## Estados

| Estado interno | Lo que ve la persona | Qué significa |
|---|---|---|
| `creada` | Sin enviar | El envío existe, todavía no sale. |
| `procesando` | En camino | Pagado o puesto en camino. Con Lightning espera que la persona destinataria cobre ("Esperando que cobre"). |
| `completada` | Entregado | Llegó al destinatario. Se emite el comprobante. |
| `fallida` | No se pudo entregar | Se cerró con un motivo. |
| `cancelada` | Cancelado | Quien envió lo canceló antes de pagar o de que saliera. |
| `devuelta` | Devuelto | Nadie cobró a tiempo y el dinero volvió por Lightning. |

## Transiciones

```
creada ──pago (BTCPay) o "Enviar ahora" sin BTCPay──▶ procesando ──completar──▶ completada
   │                                                      │
   ├──cancelar (sólo antes de pagar)──▶ cancelada         └──fallar (motivo)──▶ fallida
   └──fallar (motivo)──▶ fallida
procesando (Lightning) ──cobro vencido, sin cobrar──▶ devuelta
```

## Quién mueve cada paso

| Paso | Quién | Cómo |
|---|---|---|
| Crear | Quien envía | `/enviar`, paso 3 |
| Pagar (creada → procesando) | Quien envía | Factura Lightning en BTCPay. Es la única vía cuando BTCPay está activo, para cualquier forma de entrega. |
| Poner en camino sin BTCPay | Quien envía o administración | Botón "Enviar ahora" o "Poner en camino" |
| Completar (efectivo y cuenta) | Administración en `/admin`. En la demostración, también quien envía con "Simular que llegó" | No hay pago automático al destinatario: es simulado. |
| Cobrar (Lightning) | Quien recibe | `/recibidos` o el enlace de cobro |
| Cancelar | Quien envía | Sólo en `creada` y sin factura vigente |

## Reglas de dinero

- El dinero sale una vez: un envío no pasa a `procesando` si no está pagado cuando BTCPay está activo, aunque lo pida la administración.
- Un pago tardío después de cancelar o de cerrar el envío se registra para devolverlo, no se aplica.
- Una factura se confirma una sola vez aunque el aviso de BTCPay llegue repetido.

## Límites

- Nada de esto mueve dinero real. Completar un envío de efectivo o cuenta es una acción manual de administración.
