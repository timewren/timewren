import { asc, eq } from "drizzle-orm";
import { resolveActiveOrgId } from "@/lib/auth/active-org";
import type { db as dbType } from "@/lib/db";
import { companyProfiles, organizations } from "@/lib/db/schema";
import { getOrgRole } from "@/lib/trpc/middleware/org-role";
import { assertTwoFactorIfRequired } from "@/lib/trpc/routers/enterprise/middleware";
import { currentDpaAcceptance } from "./accept";

/**
 * Hvem må se og acceptere en udfyldt databehandleraftale.
 *
 * Regel: kun ejere og administratorer (members.role, samme regel som
 * organisations-eksporten) af den AKTIVE organisation. Organisationen tages
 * altid fra sessionen via resolveActiveOrgId, som tjekker medlemskab, aldrig
 * fra query eller body. Medarbejdere og brugere uden organisation kan hente
 * den generelle PDF, men ikke en udfyldt.
 */

type Db = typeof dbType;

export type DpaViewer =
  | { kind: "anonymous" }
  | { kind: "no-org"; userId: string }
  | { kind: "member"; userId: string; orgId: string }
  | { kind: "admin"; userId: string; orgId: string; role: "owner" | "admin" };

export async function resolveDpaViewer(
  db: Db,
  session: Record<string, unknown> | null | undefined,
): Promise<DpaViewer> {
  const user = (session as { user?: { id?: string } } | null | undefined)?.user;
  if (!user?.id) return { kind: "anonymous" };
  const orgId = await resolveActiveOrgId({ db, userId: user.id, session });
  if (!orgId) return { kind: "no-org", userId: user.id };
  const role = await getOrgRole(db, user.id, orgId);
  if (role === "owner" || role === "admin") {
    return { kind: "admin", userId: user.id, orgId, role };
  }
  return { kind: "member", userId: user.id, orgId };
}

/** true hvis org'en kræver 2FA for administratorer, og brugeren mangler det. */
export async function blockedByTwoFactor(
  db: Db,
  orgId: string,
  userId: string,
): Promise<boolean> {
  try {
    await assertTwoFactorIfRequired(db, orgId, userId);
    return false;
  } catch {
    return true;
  }
}

export interface FilledDpaAcceptance {
  name: string;
  acceptedAt: Date;
  version: string;
}

export interface FilledDpaData {
  customerName: string | null;
  cvr: string | null;
  acceptance: FilledDpaAcceptance | null;
}

/**
 * Kundens navn og CVR fra organisationens virksomhedsprofil (Indstillinger >
 * Virksomhedsprofil), ellers organisationens navn. Kun rækker med netop dette
 * organisations-id; aldrig brugerens egen profil i en anden org.
 * Acceptinformation kun for den gældende version.
 */
export async function loadFilledDpa(
  db: Db,
  orgId: string,
): Promise<FilledDpaData> {
  const [profile, org, acceptance] = await Promise.all([
    db.query.companyProfiles.findFirst({
      where: eq(companyProfiles.organizationId, orgId),
      orderBy: [asc(companyProfiles.createdAt)],
      columns: { name: true, cvrNumber: true },
    }),
    db.query.organizations.findFirst({
      where: eq(organizations.id, orgId),
      columns: { name: true },
    }),
    currentDpaAcceptance(db, orgId),
  ]);

  const name = profile?.name?.trim() || org?.name?.trim() || null;
  const cvr = profile?.cvrNumber?.trim() || null;
  return {
    customerName: name,
    cvr,
    acceptance: acceptance
      ? {
          name: acceptance.acceptedByName?.trim() || acceptance.acceptedByEmail,
          acceptedAt: acceptance.acceptedAt,
          version: acceptance.version,
        }
      : null,
  };
}
