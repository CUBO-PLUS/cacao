import { getVenta } from "../../../../../src/servidor/api-http.ts";

// API v1, one sale of the client that made it.
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return getVenta(request, id);
}
