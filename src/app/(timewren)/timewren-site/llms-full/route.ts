import { siteBaseUrl } from "@/lib/brands/timewren-site-meta";
import { llmsFull } from "@/lib/timewren-docs/content";

// Nås kun via middleware-rewrite fra /llms-full.txt på TimeWrens marketinghost.
export const dynamic = "force-dynamic";

export function GET() {
  return new Response(llmsFull(siteBaseUrl()), {
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}
