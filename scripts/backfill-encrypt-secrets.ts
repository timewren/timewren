/**
 * Backfill (#690): kryptér integrations-tokens/-secrets der stadig ligger i
 * klartekst — Google Calendar access/refresh-tokens, Billy/Dinero/e-conomic/
 * TimeOps/OpenAI-nøgler, IMAP-password og import-credentials — samt
 * signeringssecret for udgående webhooks (#712) og OAuth-login-tokens i
 * better-auths account-tabel (#710). account.accessToken/refreshToken
 * krypteres i better-auths eget format (encryptOAuthTokens, BETTER_AUTH_SECRET),
 * account.idToken og resten med ENCRYPTION_KEY ("enc:v1:").
 *
 * Idempotent og sikker at køre flere gange: kun klartekst-værdier røres,
 * nøglen verificeres mod eksisterende krypterede rækker før der skrives, hver
 * ny værdi round-trip-verificeres, og der skrives kun hvis kolonnen er uændret
 * siden læsning. Se src/lib/security/secret-backfill.ts.
 *
 * TAG ALTID EN DB-BACKUP FØRST. Kræver samme ENCRYPTION_KEY og
 * BETTER_AUTH_SECRET som appen. Nøglerne verificeres pr. codec mod eksisterende
 * krypterede rækker — log ind med en OAuth-udbyder efter deploy, så der findes
 * mindst én better-auth-krypteret række at verificere BETTER_AUTH_SECRET mod.
 *
 * Usage:
 *   npx tsx scripts/backfill-encrypt-secrets.ts            # dry-run (skriver intet)
 *   npx tsx scripts/backfill-encrypt-secrets.ts --apply    # kryptér
 *
 * Flag (kun relevante med --apply):
 *   --allow-unverified-key  der findes ingen krypterede rækker at verificere
 *                           nøglen mod (fx ny database)
 *   --ignore-unreadable     fortsæt selvom enkelte krypterede rækker ikke kan
 *                           dekrypteres (kræver at andre rækker beviser nøglen)
 */
import "dotenv/config";
import postgres from "postgres";
import {
  BackfillAbortedError,
  type BackfillReport,
  backfillSecrets,
  type SecretStore,
  type SecretTarget,
} from "../src/lib/security/secret-backfill";

const apply = process.argv.includes("--apply");
const allowUnverifiedKey = process.argv.includes("--allow-unverified-key");
const ignoreUnreadable = process.argv.includes("--ignore-unreadable");

function printReport(report: BackfillReport) {
  for (const t of report.targets) {
    console.log(
      `${t.target.padEnd(56)} scannet=${t.scanned} krypteret(ny)=${t.alreadyEncrypted} krypteret(ældre)=${t.legacyEncrypted} ulæselig=${t.unreadable} klartekst=${t.plaintext} skrevet=${t.encrypted} ændret-undervejs=${t.changedConcurrently} fejl=${t.failed}`,
    );
  }
  const s = report.totals;
  console.log(
    `\nTOTAL scannet=${s.scanned} klartekst=${s.plaintext} skrevet=${s.encrypted} ændret-undervejs=${s.changedConcurrently} fejl=${s.failed}`,
  );
  console.log(
    `Nøgle verificeret mod ${report.keyVerifiedRows} eksisterende krypterede rækker; ${report.unreadableRows.length} kunne ikke dekrypteres.`,
  );
  for (const row of report.unreadableRows) {
    console.log(`  ulæselig: ${row}`);
  }
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("DATABASE_URL er ikke sat");
    process.exit(1);
  }

  const sql = postgres(databaseUrl, { max: 1 });

  const store: SecretStore = {
    async listRows(target: SecretTarget) {
      const filter = target.filter
        ? sql`and ${sql(target.filter.column)} = ${target.filter.equals}`
        : sql``;
      return sql<{ id: string; value: string }[]>`
        select ${sql(target.idColumn)}::text as id, ${sql(target.column)} as value
        from ${sql(target.table)}
        where ${sql(target.column)} is not null
          and ${sql(target.column)} <> ''
          ${filter}
      `;
    },
    async updateIfUnchanged(target, id, oldValue, newValue) {
      const result = await sql`
        update ${sql(target.table)}
        set ${sql(target.column)} = ${newValue}
        where ${sql(target.idColumn)} = ${id}
          and ${sql(target.column)} = ${oldValue}
      `;
      return result.count === 1;
    },
  };

  console.log(
    apply
      ? "Backfill: KRYPTERER klartekst-secrets (--apply)"
      : "Backfill: DRY-RUN — intet skrives (brug --apply for at kryptere)",
  );

  try {
    const report = await backfillSecrets(store, {
      apply,
      allowUnverifiedKey,
      ignoreUnreadable,
    });
    printReport(report);
    const s = report.totals;
    if (!apply && s.plaintext > 0) {
      console.log(
        `${s.plaintext} klartekst-værdier ville blive krypteret. Kør igen med --apply.`,
      );
    }
    if (s.changedConcurrently > 0) {
      console.log(
        "Nogle rækker ændrede sig undervejs (fx token-refresh) — kør igen for at fange dem.",
      );
    }
    if (report.unreadableRows.length > 0) {
      console.error(
        "Krypterede rækker kunne ikke dekrypteres — tjek at ENCRYPTION_KEY er appens nøgle.",
      );
      process.exitCode = 1;
    }
    if (s.failed > 0) {
      console.error(
        `${s.failed} rækker kunne ikke krypteres og er urørte — se fejl ovenfor.`,
      );
      process.exitCode = 1;
    }
  } catch (error) {
    if (error instanceof BackfillAbortedError) {
      printReport(error.report);
      console.error(`\nAFBRUDT: ${error.message}`);
      process.exitCode = 1;
      return;
    }
    throw error;
  } finally {
    await sql.end();
  }
}

main().catch((error) => {
  console.error("Backfill afbrudt:", error);
  process.exit(1);
});
