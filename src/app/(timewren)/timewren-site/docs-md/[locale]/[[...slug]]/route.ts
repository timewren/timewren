import { isDocsLocale } from "@/lib/brands/timewren-docs";
import { siteBaseUrl } from "@/lib/brands/timewren-site-meta";
import { getDocPage, pageMarkdown } from "@/lib/timewren-docs/content";

// Nås kun via middleware-rewrite fra <docs-sti>.md (eller Accept: text/markdown)
// på TimeWrens marketinghost. Dynamisk, så hosten (BRANDS_CONFIG) læses ved kørsel.
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ locale: string; slug?: string[] }> },
) {
  const { locale, slug = [] } = await params;
  const page = isDocsLocale(locale) ? getDocPage(locale, slug) : null;
  if (!page) {
    return new Response("Not found\n", {
      status: 404,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }
  return new Response(pageMarkdown(page, siteBaseUrl()), {
    headers: {
      "content-type": "text/markdown; charset=utf-8",
      vary: "Accept",
    },
  });
}
