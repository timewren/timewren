import { headers } from "next/headers";
import { normalizeHost, resolveBrandByHost } from "@/lib/brands/registry";
import { isMarketingHost } from "@/lib/brands/timewren-site";
import { siteRobotsTxt } from "@/lib/brands/timewren-site-meta";

// Nås kun via middleware-rewrite fra /robots.txt på en TimeWren-host.
export const dynamic = "force-dynamic";

export async function GET() {
  const host = normalizeHost((await headers()).get("host"));
  const cfg = resolveBrandByHost(host);
  const marketing = cfg.key === "timewren" && isMarketingHost(cfg, host);
  return new Response(siteRobotsTxt(marketing), {
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}
