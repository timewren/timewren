import { NextResponse } from "next/server";
import { SERVER_VERSION } from "@/lib/version/server-version";

export const dynamic = "force-dynamic";

/**
 * Den kørende deployments version. Åbne faner sammenligner med den værdi,
 * de så ved indlæsning, og tilbyder "Ny version — genindlæs" ved ændring.
 * Samme værdi sendes som `x-timetrack-server-version` på tRPC-svar.
 */
export function GET() {
  return NextResponse.json(
    { version: SERVER_VERSION },
    { headers: { "Cache-Control": "no-store" } },
  );
}
