import { siteBaseUrl } from "@/lib/brands/timewren-site-meta";
import { llmsIndex } from "@/lib/timewren-docs/content";

// Nås kun via middleware-rewrite fra /llms.txt på TimeWrens marketinghost.
export const dynamic = "force-dynamic";

export function GET() {
  return new Response(llmsIndex(siteBaseUrl()), {
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}
