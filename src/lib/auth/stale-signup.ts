/**
 * Ubekræftet konto på et andet brand, der spærrer en adresse (multibrand).
 *
 * users.email er unik på tværs af brands. Opretter nogen en konto på
 * timewren.com med en fremmed adresse og bekræfter den aldrig, kan ejeren af
 * adressen hverken oprette sig på timetrack.dk (dublet) eller få nulstilling
 * eller magic link dér (kontoen hører til det andet brand). Ved signup på det
 * ene brand fjernes en sådan konto derfor, når den beviseligt aldrig er taget
 * i brug, og den nye signup går gennem almindelig mailbekræftelse.
 *
 * Slettepolitik (alt skal holde, ellers røres intet):
 * - kontoen er ubekræftet, hører til det andet brand og har intet
 *   telefonnummer (SMS-konti logger ind uden mailbekræftelse);
 * - dens eneste login er adgangskode (ingen OAuth, passkey eller 2FA);
 * - ingen række i nogen tabel peger på kontoen (FK mod "user".id), bortset fra
 *   adgangskode-login og medlemskaber. Det udelukker sessioner, tid,
 *   abonnementer, API-nøgler, kunder osv. uden en liste, der kan forælde;
 * - hvert medlemskab er det automatisk oprettede workspace (metadata.type
 *   freelance) uden andre medlemmer og uden rækker i nogen tabel ud over
 *   medlemskabet og de modulrækker, signup selv seeder.
 *
 * Alt kontrolleres i samme transaktion som sletningen, efter at kontoen og
 * dens workspaces er låst FOR UPDATE. Låsen blokerer samtidige inserts, der
 * peger på dem (FK-tjekket tager FOR KEY SHARE), så fx et betalingswebhook
 * eller et SMS-login venter og fejler bagefter i stedet for at blive slettet
 * med kontoen.
 */
import { sql } from "drizzle-orm";
import { buildDeletionSql } from "@/lib/account-deletion";
import type { BrandKey } from "@/lib/brands/registry";
import type { db as defaultDb } from "@/lib/db";
import { isWrongBrand } from "./host-auth";

type Db = typeof defaultDb;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/** Tabeller der må pege på kontoen: adgangskode-login og medlemskab. */
const USER_REFS_ALLOWED = new Set(["account", "members"]);
/** Tabeller der må pege på workspacet: det, signup selv opretter. */
const ORG_REFS_ALLOWED = new Set(["members", "organization_modules"]);

/**
 * Tabeller (ud over `allowed`) med mindst én række, der via en FK peger på
 * `id` i `target`. Tom = intet andet bruger rækken.
 */
async function referencingTables(
  tx: Tx,
  target: '"user"' | "organizations",
  id: string,
  allowed: Set<string>,
): Promise<string[]> {
  const fks = (await tx.execute(sql`
    SELECT c.conrelid::regclass::text AS tbl, a.attname AS col
      FROM pg_constraint c
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
     WHERE c.confrelid = ${target}::regclass AND c.contype = 'f'
       AND array_length(c.conkey, 1) = 1
  `)) as unknown as { tbl: string; col: string }[];
  const checks = fks.filter((fk) => !allowed.has(fk.tbl));
  if (checks.length === 0) return [];
  const [row] = (await tx.execute(sql`
    SELECT array_remove(ARRAY[${sql.join(
      checks.map(
        (fk) =>
          sql`CASE WHEN EXISTS (SELECT 1 FROM ${sql.raw(fk.tbl)} WHERE ${sql.identifier(fk.col)} = ${id}) THEN ${`${fk.tbl}.${fk.col}`} END`,
      ),
      sql`, `,
    )}]::text[], NULL) AS used
  `)) as unknown as { used: string[] }[];
  return row?.used ?? [];
}

/**
 * Fjerner en ubrugt, ubekræftet konto på et andet brand end `siteBrand`.
 * Returnerer true, hvis kontoen blev slettet. Uden host-auth-flagene en no-op.
 */
export async function removeStaleOtherBrandSignup(
  db: Db,
  email: string,
  siteBrand: BrandKey,
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [user] = (await tx.execute(sql`
      SELECT id, brand, "emailVerified" AS verified, "phoneNumber" AS phone
        FROM "user"
       WHERE lower(email) = ${email.trim().toLowerCase()}
       LIMIT 1
         FOR UPDATE
    `)) as unknown as {
      id: string;
      brand: string | null;
      verified: boolean;
      phone: string | null;
    }[];
    if (
      !user ||
      user.verified ||
      user.phone ||
      !isWrongBrand(user.brand, siteBrand)
    ) {
      return false;
    }

    const [otherLogin] = (await tx.execute(sql`
      SELECT 1 FROM account
       WHERE "userId" = ${user.id} AND "providerId" <> 'credential'
       LIMIT 1
    `)) as unknown[];
    if (otherLogin) return false;
    if (
      (await referencingTables(tx, '"user"', user.id, USER_REFS_ALLOWED))
        .length > 0
    ) {
      return false;
    }

    // Workspaces låses i fast rækkefølge (som buildDeletionSql).
    const orgs = (await tx.execute(sql`
      SELECT o.id, o.metadata->>'type' AS type
        FROM organizations o
       WHERE o.id IN (SELECT organization_id FROM members WHERE user_id = ${user.id})
       ORDER BY o.id
         FOR UPDATE
    `)) as unknown as { id: string; type: string | null }[];
    for (const org of orgs) {
      if (org.type !== "freelance") return false;
      const [otherMember] = (await tx.execute(sql`
        SELECT 1 FROM members
         WHERE organization_id = ${org.id} AND user_id <> ${user.id}
         LIMIT 1
      `)) as unknown[];
      if (otherMember) return false;
      if (
        (await referencingTables(tx, "organizations", org.id, ORG_REFS_ALLOWED))
          .length > 0
      ) {
        return false;
      }
    }

    const orgIds = orgs.map((o) => o.id);
    await tx.execute(sql.raw(buildDeletionSql(user.id, orgIds)));
    console.info(
      `[Auth] Ubekræftet konto ${user.id} på et andet brand fjernet ved signup (${orgIds.length} tomme workspaces)`,
    );
    return true;
  });
}
