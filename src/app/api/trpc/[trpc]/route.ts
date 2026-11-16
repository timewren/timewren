import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { auth } from "@/lib/auth";
import { isAllowedCorsOrigin } from "@/lib/auth/cors-origins";
import { orgOverrideFromRequest } from "@/lib/auth/org-header";
import { isSessionOnOtherBrand } from "@/lib/auth/request-brand";
import { CLIENT_HEADER } from "@/lib/client-version";
import { clientTooOldRetryAfterSeconds } from "@/lib/client-version/guard";
import { db } from "@/lib/db";
import { withQueryCount } from "@/lib/db/query-count";
import { SERVER_VERSION_HEADER } from "@/lib/pwa/version";
import { createRequestMemo } from "@/lib/trpc/request-memo";
import { appRouter } from "@/lib/trpc/routers";
import { SERVER_VERSION } from "@/lib/version/server-version";

// Add CORS headers for allowed browser-extension origins (see cors-origins.ts).
// Uden Allow-Credentials: udvidelsen logger ind med x-extension-token, så ingen
// udvidelse kan læse svar på brugerens session-cookie (#1117).
function addCorsHeaders(response: Response, origin: string | null): Response {
  if (!isAllowedCorsOrigin(origin)) {
    return response;
  }

  const headers = new Headers(response.headers);
  headers.set("Access-Control-Allow-Origin", origin);
  headers.append("Vary", "Origin");
  headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  headers.set(
    "Access-Control-Allow-Headers",
    `Content-Type, x-extension-token, Authorization, ${CLIENT_HEADER}`,
  );
  headers.set("Access-Control-Max-Age", "86400"); // 24 hours

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

const handler = (req: Request) =>
  withQueryCount(new URL(req.url).pathname.slice("/api/trpc/".length), () =>
    handleTrpc(req),
  );

const handleTrpc = async (req: Request) => {
  const origin = req.headers.get("origin");

  // Handle preflight requests for browser extensions
  if (req.method === "OPTIONS" && isAllowedCorsOrigin(origin)) {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": origin,
        Vary: "Origin",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": `Content-Type, x-extension-token, Authorization, ${CLIENT_HEADER}`,
        "Access-Control-Max-Age": "86400",
      },
    });
  }

  try {
    const rawSession = await auth.api.getSession({
      headers: req.headers,
    });
    // Multibrand: en session gælder kun på kontoens eget brand (undtagen
    // admin-impersonation). Uden host-auth-flagene en no-op (intet opslag).
    const session =
      rawSession &&
      (await isSessionOnOtherBrand(rawSession, req.headers.get("host")))
        ? null
        : rawSession;

    // Én memo pr. HTTP-request: procedurerne i en batch deler org-,
    // modul- og rolleopslag i stedet for at gentage dem.
    const memo = createRequestMemo();
    const response = await fetchRequestHandler({
      endpoint: "/api/trpc",
      req,
      router: appRouter,
      createContext: () => ({
        session,
        db,
        headers: req.headers,
        orgOverride: orgOverrideFromRequest(req.headers),
        memo,
      }),
      // Extension ≤ 2.5.1 under minimum får 503 + Retry-After, så dens
      // offline-kø prøver igen i stedet for at opgive tid (se guard.ts).
      responseMeta({ errors }) {
        const retryAfter = clientTooOldRetryAfterSeconds(errors);
        return retryAfter
          ? { headers: new Headers({ "Retry-After": String(retryAfter) }) }
          : {};
      },
    });

    // Fanen sammenligner med sin egen build og viser "Ny version —
    // genindlæs" ved forskel (se trpc-provider).
    try {
      response.headers.set(SERVER_VERSION_HEADER, SERVER_VERSION);
    } catch {
      // Immutable headers — versionstjekket falder tilbage til /api/version
    }

    // Add CORS headers for extension requests
    return addCorsHeaders(response, origin);
  } catch (error) {
    console.error("[tRPC] Handler error:", error);
    return new Response(
      JSON.stringify({
        error: "Internal Server Error",
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      },
    );
  }
};

export { handler as GET, handler as POST };

// Handle OPTIONS preflight requests
export async function OPTIONS(req: Request) {
  const origin = req.headers.get("origin");

  if (isAllowedCorsOrigin(origin)) {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": origin,
        Vary: "Origin",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": `Content-Type, x-extension-token, Authorization, ${CLIENT_HEADER}`,
        "Access-Control-Max-Age": "86400",
      },
    });
  }

  return new Response(null, { status: 204 });
}
