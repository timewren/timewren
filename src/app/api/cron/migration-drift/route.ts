import { readFile } from "node:fs/promises";
import path from "node:path";
import { sql } from "drizzle-orm";
import { withCronLogging } from "@/lib/cron/log-cron-run";
import { db } from "@/lib/db";
import { sendAdminDiscordEmbed } from "@/lib/notifications/admin";
import { appUrlEnv } from "@/lib/runtime-env";

interface JournalEntry {
  idx: number;
  tag: string;
  when: number;
}

/**
 * Detects silent schema drift: compares the migrations bundled with the
 * running image (drizzle/meta/_journal.json) against the migrations actually
 * applied in the database (drizzle.__drizzle_migrations).
 *
 * Background: on 2026-08-07 a boot migration failed silently ("App will start
 * anyway"), leaving prod one migration behind the code for a week — every
 * organizations query failed and the nav collapsed for all customers.
 * This job alerts Discord (hourly, until resolved) if that ever recurs.
 *
 * Schedule: Hourly (configured externally)
 */
export const GET = withCronLogging("migration-drift", async (_request) => {
  const journalPath = path.join(
    process.cwd(),
    "drizzle",
    "meta",
    "_journal.json",
  );
  const journal = JSON.parse(await readFile(journalPath, "utf8")) as {
    entries: JournalEntry[];
  };
  const expected = journal.entries.length;

  let applied = 0;
  let queryError: string | null = null;
  try {
    const [row] = await db.execute(
      sql`select count(*)::int as applied from drizzle.__drizzle_migrations`,
    );
    applied = Number((row as { applied?: number })?.applied ?? 0);
  } catch (err) {
    queryError = err instanceof Error ? err.message : String(err);
  }

  // Bevidst antal-baseret (ikke hash-baseret): migrationsfiler kan retroaktivt
  // gøres idempotente (fx 0082 → IF NOT EXISTS efter incidentet 14/8), hvilket
  // ændrer fil-hashen uden at DB'en er forkert. Drizzles egen migrator
  // sammenligner heller ikke hashes for allerede-anvendte migrationer.
  const drift = expected - applied;
  const missing =
    drift > 0 ? journal.entries.slice(applied).map((e) => e.tag) : [];

  if (drift !== 0 || queryError) {
    // Env-fallback FØRST: under et reelt drift-incident kan DB'en selv være
    // problemet, og alarmen skal kunne sendes selv når settings-opslaget fejler.
    let webhookUrl = process.env.ADMIN_DISCORD_WEBHOOK_URL;
    try {
      const settings = await db.query.adminSettings.findMany();
      webhookUrl =
        settings.find((s) => s.id === "discord_webhook_url")?.value ||
        webhookUrl;
    } catch (settingsError) {
      console.error(
        "[Migration Drift] Kunne ikke læse admin-settings — bruger env-webhook:",
        settingsError,
      );
    }

    let detail: string;
    if (queryError) {
      detail = `Kunne ikke læse \`drizzle.__drizzle_migrations\`: ${queryError}`;
    } else if (drift > 0) {
      detail = `DB er BAGUD: ${applied}/${expected} migrationer. Mangler:\n${missing
        .map((t) => `- \`${t}\``)
        .join("\n")}`;
    } else {
      detail = `DB er FORAN koden: ${applied} anvendte migrationer mod ${expected} i imaget. Kører en gammel container stadig efter et deploy?`;
    }

    console.error(`[Migration Drift] DRIFT DETECTED: ${detail}`);

    if (webhookUrl) {
      try {
        await sendAdminDiscordEmbed({
          webhookUrl,
          title: "🚨 Schema-drift mellem kode og database",
          description: [
            `**Miljø:** ${appUrlEnv() || "ukendt"}`,
            detail,
            "\nKørende kode kan SELECT'e kolonner der ikke findes → fejl for alle brugere (jf. incident 2026-08-14). Tjek boot-loggen for den fejlede migration.",
          ].join("\n"),
          color: 0xef4444,
          timestamp: new Date().toISOString(),
        });
      } catch (webhookError) {
        console.error(
          "[Migration Drift] Discord-alarm fejlede — drift er stadig logget:",
          webhookError,
        );
      }
    } else {
      console.error(
        "[Migration Drift] Ingen Discord-webhook konfigureret — drift kun logget",
      );
    }
  } else {
    console.warn(
      `[Migration Drift] OK: ${applied}/${expected} migrationer anvendt`,
    );
  }

  const healthy = drift === 0 && !queryError;
  return {
    itemsProcessed: 1,
    itemsSucceeded: healthy ? 1 : 0,
    itemsFailed: healthy ? 0 : 1,
    metadata: { expected, applied, drift, missing, queryError },
  };
});
