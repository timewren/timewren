import { siteSitemapXml } from "@/lib/brands/timewren-site-meta";
import { docsSitemapEntries } from "@/lib/timewren-docs/content";

// Nås kun via middleware-rewrite fra /sitemap.xml på TimeWrens marketinghost.
// Dynamisk, så BRANDS_CONFIG (primærhosten) læses ved kørsel, ikke ved build.
export const dynamic = "force-dynamic";

export function GET() {
  return new Response(siteSitemapXml(undefined, docsSitemapEntries()), {
    headers: { "content-type": "application/xml; charset=utf-8" },
  });
}
