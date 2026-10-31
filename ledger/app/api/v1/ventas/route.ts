import { getVentas, postVentas } from "../../../../src/servidor/api-http.ts";

// API v1, sales. POST registers a sale once per Idempotency-Key; GET lists the client's own sales, newest first.
// Server to server, with "Authorization: Bearer cl_..." (see docs/api.md).
export async function POST(request: Request) {
  return postVentas(request);
}

export async function GET(request: Request) {
  return getVentas(request);
}
