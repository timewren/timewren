import { and, eq } from "drizzle-orm";
import type { db as dbType } from "@/lib/db";
import { members, organizations, users } from "@/lib/db/schema";
import {
  DEFAULT_ORG_REGION,
  type OrgRegion,
  orgRegionFromMetadata,
} from "./region";

// Også en transaktion: kun select og query bruges.
type Db = Pick<typeof dbType, "select" | "query">;

// Regionen ændres kun ved oprettelsen; et kort cache sparer et opslag pr.
// tRPC-kald og sideindlæsning.
const TTL_MS = 60_000;
const cache = new Map<string, { region: OrgRegion; at: number }>();

/**
 * Organisationens valuta, land og sprog (src/lib/org/region.ts). Uden
 * organisation, eller hvis opslaget fejler, gælder standarden (DKK og
 * Danmark), så et fejlet opslag aldrig vælter et kald.
 */
export async function getOrgRegion(
  db: Db,
  orgId: string | null | undefined,
): Promise<OrgRegion> {
  if (!orgId) return DEFAULT_ORG_REGION;
  const hit = cache.get(orgId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.region;
  try {
    const row = await db.query.organizations.findFirst({
      where: eq(organizations.id, orgId),
      columns: { metadata: true },
    });
    const region = orgRegionFromMetadata(row?.metadata);
    cache.set(orgId, { region, at: Date.now() });
    return region;
  } catch {
    return DEFAULT_ORG_REGION;
  }
}

/**
 * Organisationens sprog: det gemte ved oprettelsen, ellers ejerens (eller
 * brugerens) users.locale, ellers dansk. Bruges til kladdenumre.
 */
export async function getOrgLanguage(
  db: Db,
  orgId: string | null | undefined,
  userId: string,
): Promise<string> {
  const region = await getOrgRegion(db, orgId);
  if (region.locale) return region.locale;
  try {
    const [row] = orgId
      ? await db
          .select({ locale: users.locale })
          .from(members)
          .innerJoin(users, eq(users.id, members.userId))
          .where(
            and(eq(members.organizationId, orgId), eq(members.role, "owner")),
          )
          .limit(1)
      : await db
          .select({ locale: users.locale })
          .from(users)
          .where(eq(users.id, userId))
          .limit(1);
    return row?.locale || "da";
  } catch {
    return "da";
  }
}

/**
 * Kundens land, når formularen ikke sender et: "Danmark" for en dansk
 * organisation som før, ellers intet (en TimeWren-kunde er ikke dansk).
 */
export async function defaultClientCountryFor(
  db: Db,
  orgId: string | null | undefined,
): Promise<string | null> {
  return (await getOrgRegion(db, orgId)).country === "DK" ? "Danmark" : null;
}

/** Kun til tests. */
export function clearOrgRegionCache(): void {
  cache.clear();
}
