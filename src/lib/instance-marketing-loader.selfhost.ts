import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { MarketingPage } from "./instance-marketing-loader.types";

/**
 * Stand-in for instance-marketing-loader.ts in the self-host build profile,
 * where the marketing group is not part of the build: every marketing path
 * is a 404. Same exports as the real loader.
 */

export async function loadMarketingLayoutMetadata(
  _segments: string[],
): Promise<Metadata | undefined> {
  return undefined;
}

export async function loadMarketingPage(
  _segments: string[],
): Promise<MarketingPage> {
  notFound();
}
