import { NextResponse } from "next/server";
import { DEMO_UNAVAILABLE_CODE, isDemoMode } from "./demo-mode";

/**
 * API-ruter, der er slået fra i den offentlige demo (licenser m.fl.):
 * 403 med en kort besked, ellers null, så ruten kører som før.
 */
export function demoUnavailableResponse(): NextResponse | null {
  if (!isDemoMode()) return null;
  return NextResponse.json(
    { error: "Not available in the demo", code: DEMO_UNAVAILABLE_CODE },
    { status: 403 },
  );
}
