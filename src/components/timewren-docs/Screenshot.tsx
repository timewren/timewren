import Image from "next/image";
import type { DocsLocale } from "@/lib/brands/timewren-docs";
import { screenshotPath } from "@/lib/timewren-docs/content";

/*
 * <Screenshot name="dashboard" alt="…" /> i docs-MDX. Billedet tages fra
 * public/brand/timewren/screens/<sprog>/<navn>.webp, ellers den engelske
 * udgave. Findes ingen af dem, vises intet (hellere end et ødelagt billede).
 */
export function Screenshot({
  name,
  alt,
  locale,
}: {
  name: string;
  alt: string;
  locale: DocsLocale;
}) {
  const src = screenshotPath(name, locale);
  if (!src) return null;
  const mobile = name.startsWith("mobile-");
  return (
    <Image
      src={src}
      alt={alt}
      width={mobile ? 390 : 1440}
      height={mobile ? 844 : 900}
      sizes={mobile ? "390px" : "(min-width: 64rem) 48rem, 100vw"}
      className="rounded-lg border border-fd-border"
      style={{ height: "auto", maxWidth: "100%" }}
    />
  );
}
