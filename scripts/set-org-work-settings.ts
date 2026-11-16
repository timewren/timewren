/**
 * Sæt en organisations arbejdstid og pause-model (#449) — idempotent.
 *
 *   npx tsx scripts/set-org-work-settings.ts --org <id|slug> \
 *     [--weekly 37] [--daily-norm 8] [--break 30] \
 *     [--policy none|paid_included|unpaid_excluded] \
 *     [--recalc-from YYYY-MM-DD] [--dry-run]
 *
 * Kun de angivne felter ændres; `--daily-norm none` rydder dagsnormen
 * (tilbage til ugetimer/arbejdsdage). `--recalc-from` genberegner flex
 * (recalculateFlexDay) for alle aktive medarbejdere pr. dag fra datoen til og
 * med i dag, så eksisterende flex-rækker følger den nye norm. Genberegning er
 * idempotent (upsert pr. dag) og kan køres igen.
 *
 * kunde C-demo: --daily-norm 8 --break 30 --policy paid_included --recalc-from 2026-01-01
 */
import * as dotenv from "dotenv";
import { and, eq, or } from "drizzle-orm";

if (process.env.NODE_ENV !== "production") {
  dotenv.config({ path: ".env.local" });
}

type Args = {
  org?: string;
  weekly?: number;
  dailyNorm?: number | null;
  breakMinutes?: number;
  policy?: "none" | "paid_included" | "unpaid_excluded";
  recalcFrom?: string;
  dryRun: boolean;
};

function parseArgs(argv: string[]): Args {
  const args: Args = { dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = argv[i + 1];
    switch (flag) {
      case "--org":
        args.org = value;
        i++;
        break;
      case "--weekly":
        args.weekly = Number(value);
        i++;
        break;
      case "--daily-norm":
        args.dailyNorm = value === "none" ? null : Number(value);
        i++;
        break;
      case "--break":
        args.breakMinutes = Number(value);
        i++;
        break;
      case "--policy":
        if (
          value !== "none" &&
          value !== "paid_included" &&
          value !== "unpaid_excluded"
        ) {
          throw new Error(`Ugyldig --policy: ${value}`);
        }
        args.policy = value;
        i++;
        break;
      case "--recalc-from":
        if (!/^\d{4}-\d{2}-\d{2}$/.test(value ?? "")) {
          throw new Error("--recalc-from skal være YYYY-MM-DD");
        }
        args.recalcFrom = value;
        i++;
        break;
      case "--dry-run":
        args.dryRun = true;
        break;
      default:
        throw new Error(`Ukendt argument: ${flag}`);
    }
  }
  if (!args.org) throw new Error("--org <id|slug> er påkrævet");
  if (args.weekly !== undefined && !(args.weekly >= 1 && args.weekly <= 80)) {
    throw new Error("--weekly skal være 1-80");
  }
  if (
    args.dailyNorm != null &&
    !(args.dailyNorm >= 0.5 && args.dailyNorm <= 24)
  ) {
    throw new Error("--daily-norm skal være 0.5-24 eller none");
  }
  if (
    args.breakMinutes !== undefined &&
    !(Number.isInteger(args.breakMinutes) && args.breakMinutes >= 0)
  ) {
    throw new Error("--break skal være hele minutter ≥ 0");
  }
  return args;
}

function toDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { db } = await import("@/lib/db");
  const { employeeProfiles, organizations } = await import("@/lib/db/schema");
  const { recalculateFlexDay } = await import("@/lib/enterprise/flex");
  const { loadOrgWorkSettings } = await import(
    "@/lib/enterprise/work-settings"
  );

  const org = await db.query.organizations.findFirst({
    where: or(
      eq(organizations.id, args.org as string),
      eq(organizations.slug, args.org as string),
    ),
    columns: {
      id: true,
      name: true,
      slug: true,
      defaultWeeklyHours: true,
      dailyNormHours: true,
      breakMinutesPerDay: true,
      breakPolicy: true,
    },
  });
  if (!org) throw new Error(`Organisation ikke fundet: ${args.org}`);

  console.log(`Org: ${org.name} (${org.slug}, ${org.id})`);
  console.log(
    `Før:  ugetimer=${org.defaultWeeklyHours} dagsnorm=${org.dailyNormHours ?? "—"} pause=${org.breakMinutesPerDay} min politik=${org.breakPolicy}`,
  );

  const patch: Partial<typeof organizations.$inferInsert> = {};
  if (args.weekly !== undefined)
    patch.defaultWeeklyHours = args.weekly.toFixed(1);
  if (args.dailyNorm !== undefined) {
    patch.dailyNormHours =
      args.dailyNorm === null ? null : args.dailyNorm.toFixed(1);
  }
  if (args.breakMinutes !== undefined)
    patch.breakMinutesPerDay = args.breakMinutes;
  if (args.policy !== undefined) patch.breakPolicy = args.policy;

  if (Object.keys(patch).length > 0) {
    if (args.dryRun) {
      console.log("[dry-run] Ville opdatere:", patch);
    } else {
      await db
        .update(organizations)
        .set(patch)
        .where(eq(organizations.id, org.id));
      const after = await loadOrgWorkSettings(db, org.id);
      console.log(
        `Efter: ugetimer=${after.defaultWeeklyHours} dagsnorm=${after.dailyNormHours ?? "—"} pause=${after.breakMinutesPerDay} min politik=${after.breakPolicy}`,
      );
    }
  } else {
    console.log("Ingen felter angivet — org uændret.");
  }

  if (args.recalcFrom) {
    const profiles = await db.query.employeeProfiles.findMany({
      where: and(
        eq(employeeProfiles.organizationId, org.id),
        eq(employeeProfiles.isActive, true),
      ),
      columns: { userId: true },
    });
    const [y, m, d] = args.recalcFrom.split("-").map(Number);
    const cursor = new Date(y, m - 1, d);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const days: string[] = [];
    while (cursor <= today) {
      days.push(toDateStr(cursor));
      cursor.setDate(cursor.getDate() + 1);
    }
    console.log(
      `Genberegner flex for ${profiles.length} aktive medarbejdere × ${days.length} dage (${args.recalcFrom} → ${toDateStr(today)})${args.dryRun ? " [dry-run: springer over]" : ""}`,
    );
    if (!args.dryRun) {
      const orgSettings = await loadOrgWorkSettings(db, org.id);
      let count = 0;
      for (const profile of profiles) {
        for (const date of days) {
          await recalculateFlexDay(db, {
            userId: profile.userId,
            orgId: org.id,
            date,
            orgSettings,
          });
          count++;
        }
        process.stdout.write(".");
      }
      console.log(`\nFærdig: ${count} dag-rækker genberegnet.`);
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
