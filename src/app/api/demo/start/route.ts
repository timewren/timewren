import { NextResponse } from "next/server";
import { authForHost } from "@/lib/auth";
import { getAppUrl } from "@/lib/config";
import { db } from "@/lib/db";
import { createDemoAccount } from "@/lib/demo/create-demo-account";
import { isDemoMode } from "@/lib/demo/demo-mode";
import {
  getClientIp,
  ipRateLimitKey,
  rateLimiter,
} from "@/lib/utils/rate-limiter";
import { captureRouteError } from "@/lib/utils/sentry";

/**
 * "Prøv demoen" (DEMO_MODE=1, docs/demo.md): opretter en frisk demokonto med
 * egen organisation og demodata, logger den besøgende ind og sender videre
 * til dashboardet. Kaldes som almindelig formular-POST fra login-siden.
 *
 * Uden demo-tilstand findes ruten ikke (404). Pr. IP højst 10 konti i timen
 * og globalt et loft over levende demokonti; over grænsen sendes den
 * besøgende tilbage til login med en venlig besked (?demo=…).
 */
export async function POST(request: Request) {
  if (!isDemoMode()) return new NextResponse(null, { status: 404 });

  const base = getAppUrl().replace(/\/$/, "");
  const back = (reason: string) =>
    NextResponse.redirect(`${base}/login?demo=${reason}`, 303);

  // Kun formularen på vores egen side (ingen login-CSRF fra andre sites)
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(base).origin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const limit = await rateLimiter.check(
    ipRateLimitKey(getClientIp(request.headers), "demo-start"),
    "demoStart",
  );
  if (!limit.allowed) return back("rate_limited");

  try {
    const account = await createDemoAccount(db);
    if (!account.ok) return back("full");

    const auth = authForHost(request.headers.get("host"));
    const { headers } = await auth.api.signInEmail({
      body: { email: account.email, password: account.password },
      headers: request.headers,
      returnHeaders: true,
    });
    const res = NextResponse.redirect(`${base}/dashboard`, 303);
    for (const cookie of headers.getSetCookie()) {
      res.headers.append("set-cookie", cookie);
    }
    return res;
  } catch (error) {
    captureRouteError(error, { route: "/api/demo/start", type: "api" });
    return back("error");
  }
}
