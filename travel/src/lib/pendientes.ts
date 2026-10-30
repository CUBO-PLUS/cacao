// Lightning invoices the visitor left behind with "Cambiar fecha o personas". Each one is checked once on a later
// visit, so a payment that arrives after leaving is still saved as a booking. Bookings are saved once per code,
// so checking an invoice twice never counts the payment twice. Only the browser's own storage is used.

const CLAVE_RESERVAS = 'ct-reservas';
const CLAVE_PENDIENTES = 'ct-facturas-pendientes';
const DIA = 24 * 60 * 60 * 1000;
/** An invoice left behind is checked for this many days, then forgotten. */
const DIAS_DE_REVISION = 2;
const MAXIMO_RESERVAS = 30;

interface Pendiente {
  id: string;
  creada: number;
}

function leer(clave: string): unknown[] {
  try {
    const datos: unknown = JSON.parse(localStorage.getItem(clave) ?? '[]');
    return Array.isArray(datos) ? datos : [];
  } catch {
    return [];
  }
}

function escribir(clave: string, lista: unknown[]): void {
  try {
    localStorage.setItem(clave, JSON.stringify(lista));
  } catch {
    // No storage here: the booking is still shown on the page that made it.
  }
}

const esPendiente = (v: unknown): v is Pendiente =>
  typeof v === 'object' && v !== null && typeof (v as Pendiente).id === 'string' && typeof (v as Pendiente).creada === 'number';

/** Saves a paid or confirmed booking once per code. */
export function guardarReserva(reserva: Record<string, unknown> & { codigo: string }): void {
  const previas = leer(CLAVE_RESERVAS).filter(
    (r) => !(typeof r === 'object' && r !== null && (r as { codigo?: unknown }).codigo === reserva.codigo),
  );
  escribir(CLAVE_RESERVAS, [reserva, ...previas].slice(0, MAXIMO_RESERVAS));
}

/** Remembers an invoice the visitor left before it was paid. */
export function dejarPendiente(id: string): void {
  const lista = leer(CLAVE_PENDIENTES).filter(esPendiente);
  if (lista.some((p) => p.id === id)) return;
  escribir(CLAVE_PENDIENTES, [...lista, { id, creada: Date.now() }]);
}

/**
 * Checks each invoice left behind, once per call. Returns the bookings that were paid after the visitor left;
 * they are saved in ct-reservas. An invoice stays on the list until it is paid, unknown, or too old.
 */
export async function revisarPendientes(): Promise<Record<string, unknown>[]> {
  const lista = leer(CLAVE_PENDIENTES).filter(esPendiente);
  if (lista.length === 0) return [];
  const limite = Date.now() - DIAS_DE_REVISION * DIA;
  const quedan: Pendiente[] = [];
  const pagadas: Record<string, unknown>[] = [];
  for (const p of lista) {
    if (p.creada < limite) continue;
    try {
      const r = await fetch(`/api/reservar/estado/?id=${encodeURIComponent(p.id)}`);
      // Unknown invoice: nothing to keep. Any other answer keeps it for the next visit.
      if (r.status === 404) continue;
      if (!r.ok) {
        quedan.push(p);
        continue;
      }
      const j = await r.json();
      if (typeof j?.codigo === 'string') {
        guardarReserva(j);
        pagadas.push(j);
      } else {
        quedan.push(p);
      }
    } catch {
      quedan.push(p);
    }
  }
  // Invoices left behind while the checks ran stay on the list too.
  const nuevas = leer(CLAVE_PENDIENTES).filter(esPendiente).filter((p) => !lista.some((l) => l.id === p.id));
  escribir(CLAVE_PENDIENTES, [...quedan, ...nuevas]);
  return pagadas;
}
