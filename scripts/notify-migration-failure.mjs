// Sender en Discord-alarm når boot-migrationen fejler (kaldes fra startup.sh).
// Fejler selv i stilhed (exit 0) — en nede-liggende webhook må aldrig
// forhindre appen i at starte.
//
// Brug: node scripts/notify-migration-failure.mjs <exitCode> [logFile]

import { readFileSync } from "node:fs";

const [, , exitCode = "?", logFile] = process.argv;

const webhookUrl = process.env.ADMIN_DISCORD_WEBHOOK_URL;
if (!webhookUrl) {
  console.error(
    "[migrate-alert] ADMIN_DISCORD_WEBHOOK_URL er ikke sat — kan ikke alarmere",
  );
  process.exit(0);
}

let logTail = "";
if (logFile) {
  try {
    const lines = readFileSync(logFile, "utf8").split("\n");
    logTail = lines.slice(-15).join("\n").slice(-900);
  } catch {
    logTail = "(kunne ikke læse migrationslog)";
  }
}

const appUrl = process.env.NEXT_PUBLIC_APP_URL || "ukendt miljø";

const payload = {
  embeds: [
    {
      title:
        "🚨 Migration fejlede ved boot — appen kører mod muligvis forældet schema",
      description: [
        `**Miljø:** ${appUrl}`,
        `**Exit code:** ${exitCode}`,
        "**Konsekvens:** appen er startet alligevel; queries mod nye kolonner/tabeller kan fejle for ALLE brugere (jf. incident 2026-08-14).",
        logTail ? `\n**Log (sidste linjer):**\n\`\`\`\n${logTail}\n\`\`\`` : "",
      ].join("\n"),
      color: 0xef4444,
      timestamp: new Date().toISOString(),
      footer: { text: "TimeTrack startup.sh" },
    },
  ],
};

try {
  // Bounded timeout: en hængende webhook må ikke forsinke app-boot.
  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    console.error(`[migrate-alert] Discord svarede ${res.status}`);
  } else {
    console.error("[migrate-alert] Discord-alarm sendt");
  }
} catch (err) {
  console.error("[migrate-alert] Discord-kald fejlede:", err?.message ?? err);
}
process.exit(0);
