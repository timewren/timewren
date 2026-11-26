import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { MarketingPage } from "./instance-marketing-loader.types";

/**
 * Loads Cloud marketing pages for the instance-pages catch-all
 * (src/app/(instance)/instance-pages/[[...segments]]/page.tsx).
 *
 * This is the only module outside the marketing group that may import from
 * it. The self-host build profile (BUILD_PROFILE=selfhost, scripts/build.mjs)
 * leaves the marketing group out and aliases this module to
 * instance-marketing-loader.selfhost.ts (next.config.ts), so a self-host
 * bundle never reaches into the omitted directories. scripts/check-build-
 * profile.mjs fails on any other import that does.
 */

function isMissingModule(error: unknown): boolean {
  return (
    error instanceof Error &&
    /cannot find module|unknown variable dynamic import/i.test(error.message)
  );
}

export async function loadMarketingLayoutMetadata(
  segments: string[],
): Promise<Metadata | undefined> {
  const [section] = segments;
  if (!section) return undefined;
  try {
    const layout = await import(`../app/(marketing)/${section}/layout.tsx`);
    return layout.metadata;
  } catch (error) {
    if (!isMissingModule(error)) throw error;
  }
}

export async function loadMarketingPage(
  segments: string[],
): Promise<MarketingPage> {
  if (segments.length === 0) {
    return import("../app/(marketing)/page");
  }
  const [section, slug] = segments;
  if (
    segments.length > 2 ||
    !section ||
    !/^[a-z0-9-]+$/.test(section) ||
    (slug && !/^[a-z0-9-]+$/.test(slug))
  ) {
    notFound();
  }
  if (section === "lp" && slug)
    return import("../app/(marketing)/lp/[slug]/page");
  try {
    if (slug)
      return await import(`../app/(marketing)/${section}/${slug}/page.tsx`);
    return await import(`../app/(marketing)/${section}/page.tsx`);
  } catch (error) {
    if (isMissingModule(error)) notFound();
    throw error;
  }
}
