import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { members } from "@/lib/db/schema";
import { pickPrimaryMembership } from "@/lib/desktop-sync";

/**
 * Rollen på et medlemskab. Better-Auth gemmer den som kommasepareret liste
 * ("owner,admin") — samme format som `pickPrimaryMembership` læser.
 */
export function isOrgAdminRole(role: string | null | undefined): boolean {
  const roles = (role ?? "").split(",").map((r) => r.trim().toLowerCase());
  return roles.includes("owner") || roles.includes("admin");
}

/**
 * Device-tokenets medlemskab i den organisation enheden arbejder i — samme
 * deterministiske valg som `resolveDesktopOrgId`, men med rollen med.
 *
 * Ruter der skriver organisationsdata har brug for at vide OM brugeren er
 * admin, ikke bare hvilken org de er i. Ét opslag, én regel: ellers kunne de
 * to ruter blive uenig om hvilken org der gælder.
 */
export async function getDesktopMembership(userId: string): Promise<{
  organizationId: string;
  role: string | null;
} | null> {
  const memberships = await db
    .select({
      organizationId: members.organizationId,
      role: members.role,
      createdAt: members.createdAt,
    })
    .from(members)
    .where(eq(members.userId, userId));

  const primary = pickPrimaryMembership(memberships);
  if (!primary) return null;
  return { organizationId: primary.organizationId, role: primary.role ?? null };
}

/**
 * Slå den organisation op som en desktop-enhed skal arbejde i.
 *
 * En enhed autentificerer med et device-token og har derfor ingen web-session
 * med `activeOrganizationId`. Alle tre sync-ruter (pull/push/full) skal bruge
 * SAMME deterministiske regel som tRPC-lagets fallback i `isAuthed`
 * (src/lib/trpc/trpc.ts): ældste ejer-medlemskab, ellers ældste medlemskab.
 *
 * Tidligere slog hver rute selv op med et uordnet `findFirst`/`limit 1`. For
 * en bruger med flere medlemskaber returnerer Postgres da en vilkårlig række,
 * så enheden kunne få en anden organisations kunder, klippekort og fakturaer
 * ned — og desktop-oprettede poster kunne blive stemplet med forkert
 * organizationId.
 */
export async function resolveDesktopOrgId(
  userId: string,
): Promise<string | null> {
  return (await getDesktopMembership(userId))?.organizationId ?? null;
}
