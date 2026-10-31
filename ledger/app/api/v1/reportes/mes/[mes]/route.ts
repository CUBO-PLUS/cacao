import { getReporteMes } from "../../../../../../src/servidor/api-http.ts";

// API v1, the group's month. Only a client flagged as the group owner's may read it.
export async function GET(request: Request, { params }: { params: Promise<{ mes: string }> }) {
  const { mes } = await params;
  return getReporteMes(request, mes);
}
