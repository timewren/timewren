import { getRequestBrand } from "@/lib/brands/request";
import { buildManifest } from "@/lib/pwa/manifest";

// Brandet læses ved kørsel (#1017), så manifestet bygges pr. forespørgsel.
// Det er appens manifest, ikke en marketingside; svaret caches i browseren.
// Med multibrand er det hostens brand (TimeWren på timewren.com); ellers
// build-brandet som før.
export const dynamic = "force-dynamic";

export async function GET() {
  const { brand } = await getRequestBrand();
  return Response.json(buildManifest(brand), {
    headers: {
      "Content-Type": "application/manifest+json",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
