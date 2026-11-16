import { toNextJsHandler } from "better-auth/next-js";
import { authForHost } from "@/lib/auth";

// Multibrand: TimeWren-hosts får deres egen auth-instans (baseURL, RP ID,
// cookies), når MULTIBRAND_ENABLED=1 og TIMEWREN_APP_ENABLED=1. Ellers er det
// altid standardinstansen, som før.
const handler = toNextJsHandler((req: Request) =>
  authForHost(req.headers.get("host")).handler(req),
);

export const GET = async (req: Request) => {
  try {
    return await handler.GET(req);
  } catch (error) {
    console.error("[Auth GET] Error:", error);
    throw error;
  }
};

export const POST = async (req: Request) => {
  try {
    return await handler.POST(req);
  } catch (error) {
    console.error("[Auth POST] Error:", error);
    throw error;
  }
};
