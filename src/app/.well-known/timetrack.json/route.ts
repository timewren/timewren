import { serverDiscovery } from "@/lib/server-discovery";

export const dynamic = "force-dynamic";

export function GET() {
  return Response.json(serverDiscovery(), {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "no-store",
    },
  });
}
