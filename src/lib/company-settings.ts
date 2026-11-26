import { eq } from "drizzle-orm";
import type { db as Db } from "@/lib/db";
import { companyProfiles, users } from "@/lib/db/schema";

/**
 * Virksomhedstype, momsperiode, regnskabsår og ansatte, læst samme sted som
 * `user.updateCompanyInfo` skriver dem: org'ens virksomhedsprofil, når den
 * findes, ellers brugerens række (solo uden org, eller org uden profil).
 *
 * Et felt, der er tomt (NULL) på profilen, falder tilbage til brugerens
 * værdi, som backfillet i scripts/migrate-safe.ts gør: profiler oprettet efter
 * backfillet kan mangle de værdier, brugeren valgte før. Ingen af felterne har
 * en DB-default på profilen (0162), så NULL betyder altid "aldrig gemt dér",
 * og en gemt `false` respekteres.
 */
export type CompanySettings = {
  companyType: string | null;
  vatPeriod: string | null;
  fiscalYearEnd: string | null;
  hasEmployees: boolean;
};

const SETTINGS_COLUMNS = {
  companyType: true,
  vatPeriod: true,
  fiscalYearEnd: true,
  hasEmployees: true,
} as const;

export async function getCompanySettings(
  db: typeof Db,
  opts: {
    userId: string;
    orgId: string | null | undefined;
    /** Brugerrækken, hvis kalderen allerede har hentet den (sparer et kald). */
    user?: SettingsRow;
  },
): Promise<CompanySettings> {
  const [user, profile] = await Promise.all([
    opts.user ??
      db.query.users.findFirst({
        where: eq(users.id, opts.userId),
        columns: SETTINGS_COLUMNS,
      }),
    opts.orgId
      ? db.query.companyProfiles.findFirst({
          where: eq(companyProfiles.organizationId, opts.orgId),
          columns: SETTINGS_COLUMNS,
        })
      : undefined,
  ]);
  return mergeCompanySettings(user, profile);
}

type SettingsRow = {
  companyType: string | null;
  vatPeriod: string | null;
  fiscalYearEnd: string | null;
  hasEmployees: boolean | null;
};

/** Profilens værdier frem for brugerens; ren funktion, så den kan testes. */
export function mergeCompanySettings(
  user: SettingsRow | undefined,
  profile: SettingsRow | undefined,
): CompanySettings {
  return {
    companyType: profile?.companyType ?? user?.companyType ?? null,
    vatPeriod: profile?.vatPeriod ?? user?.vatPeriod ?? null,
    fiscalYearEnd: profile?.fiscalYearEnd ?? user?.fiscalYearEnd ?? null,
    hasEmployees: profile?.hasEmployees ?? user?.hasEmployees ?? false,
  };
}

/**
 * Brugerens virksomhedsindstillinger til en ny virksomhedsprofil, så profilen
 * starter med det, brugeren allerede har valgt (fx ansatte og lønfrister),
 * i stedet for tomme felter.
 */
export async function companySettingsForNewProfile(
  db: Pick<typeof Db, "query">,
  userId: string,
): Promise<SettingsRow> {
  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: SETTINGS_COLUMNS,
  });
  return {
    companyType: user?.companyType ?? null,
    vatPeriod: user?.vatPeriod ?? null,
    fiscalYearEnd: user?.fiscalYearEnd ?? null,
    hasEmployees: user?.hasEmployees ?? null,
  };
}
