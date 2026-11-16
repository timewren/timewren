import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { headers } from "next/headers";
import { normalizeHost, resolveBrandByHost } from "@/lib/brands/registry";
import { isMarketingHost } from "@/lib/brands/timewren-site";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const host = normalizeHost((await headers()).get("host"));
  const cfg = resolveBrandByHost(host);
  if (cfg.key !== "timewren" || !isMarketingHost(cfg, host)) {
    return new Response(null, { status: 404 });
  }
  return new Response(
    await readFile(join(process.cwd(), "scripts/install.sh"), "utf8"),
    {
      headers: {
        "content-type": "text/x-shellscript; charset=utf-8",
        "x-content-type-options": "nosniff",
        "x-robots-tag": "noindex, nofollow",
        "cache-control": "public, max-age=300",
      },
    },
  );
}
