// The one address people write to about the ledger. Shown as a mailto link after a short question.
export const EMAIL_CONTACTO = "hola@cacaomedia.sv";

export function LineaContacto({ pregunta }: { pregunta: string }) {
  return (
    <p className="nota linea-contacto">
      {pregunta} Escribinos a <a href={`mailto:${EMAIL_CONTACTO}`}>{EMAIL_CONTACTO}</a>
    </p>
  );
}
