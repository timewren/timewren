/**
 * Sæt en organisations ferieår og optjeningsmodel (#461, #532) — idempotent.
 *
 *   npx tsx scripts/set-org-vacation-settings.ts --org <id|slug> \
 *     [--year-start 1..12] [--mode upfront|monthly] \
 *     [--carry-over 5] [--pay-out true|false] \
 *     [--opening from-balance|zero] [--as-of YYYY-MM-DD] [--dry-run]
 *
 * Kun de angivne felter ændres. Eksisterende saldo-perioder røres ikke.
 *
 * Modelskift (#532): når org'en ender i monthly og model eller startmåned
 * ændres, gør scriptet i én transaktion:
 *  (a) sætter organizations.vacation_settings_changed_at = nu, så måneds-
 *      optjeningen ALDRIG indhenter måneder før skiftet,
 *  (b) åbner den aktuelle periode (efter den nye startmåned) for hver aktiv
 *      medarbejder med én 'opening'-postering pr. pulje = resten i den
 *      periode der gjaldt under de gamle indstillinger (--opening
 *      from-balance, default) eller 0 (--opening zero),
 *  (c) med --dry-run vises posteringerne uden at der skrives.
 * Medarbejdere hvis nye periode allerede findes springes over (ingen dobbelt
 * åbning). Måneds-cronen (api/cron/vacation-accrual) posterer herefter
 * 2,08 dage/md fra og med skiftemåneden.
 *
 * Eksempel: --org <org-slug> --year-start 9 --mode monthly
 */
import * as dotenv from "dotenv";
import { and, eq, or } from "drizzle-orm";

if (process.env.NODE_ENV !== "production") {
  dotenv.config({ path: ".env.local" });
}

type Args = {
  org?: string;
  yearStart?: number;
  mode?: "upfront" | "monthly";
  carryOver?: number;
  payOut?: boolean;
  opening: "from-balance" | "zero";
  asOf?: string;
  dryRun: boolean;
};

function parseArgs(argv: string[]): Args {
  const args: Args = { dryRun: false, opening: "from-balance" };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = argv[i + 1];
    switch (flag) {
      case "--org":
        args.org = value;
        i++;
        break;
      case "--year-start":
        args.yearStart = Number(value);
        i++;
        break;
      case "--mode":
        if (value !== "upfront" && value !== "monthly") {
          throw new Error(`Ugyldig --mode: ${value}`);
        }
        args.mode = value;
        i++;
        break;
      case "--carry-over":
        args.carryOver = Number(value);
        i++;
        break;
      case "--pay-out":
        if (value !== "true" && value !== "false") {
          throw new Error("--pay-out skal være true eller false");
        }
        args.payOut = value === "true";
        i++;
        break;
      case "--opening":
        if (value !== "from-balance" && value !== "zero") {
          throw new Error("--opening skal være from-balance eller zero");
        }
        args.opening = value;
        i++;
        break;
      case "--as-of":
        if (!/^\d{4}-\d{2}-\d{2}$/.test(value ?? "")) {
          throw new Error("--as-of skal være YYYY-MM-DD");
        }
        args.asOf = value;
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
  if (
    args.yearStart !== undefined &&
    !(
      Number.isInteger(args.yearStart) &&
      args.yearStart >= 1 &&
      args.yearStart <= 12
    )
  ) {
    throw new Error("--year-start skal være 1-12");
  }
  if (
    args.carryOver !== undefined &&
    !(args.carryOver >= 0 && args.carryOver <= 25)
  ) {
    throw new Error("--carry-over skal være 0-25");
  }
  return args;
}

type OpeningPlan = {
  userId: string;
  label: string;
  fromPeriod: string | null;
  vacation: number;
  extra: number;
  /** Den nye periode findes allerede — åbnes ikke igen */
  exists: boolean;
};

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { db } = await import("@/lib/db");
  const { employeeProfiles, organizations, users, vacationBalances } =
    await import("@/lib/db/schema");
  const { ensureVacationPeriod, getVacationOrgSettings, vacationPeriodFor } =
    await import("@/lib/enterprise/vacation");
  const { toLocalDateStr } = await import("@/lib/format");

  const org = await db.query.organizations.findFirst({
    where: or(
      eq(organizations.id, args.org as string),
      eq(organizations.slug, args.org as string),
    ),
    columns: {
      id: true,
      name: true,
      slug: true,
      vacationYearStartMonth: true,
      vacationAccrualMode: true,
      vacationCarryOverMaxDays: true,
      vacationPayOutRemaining: true,
      vacationSettingsChangedAt: true,
    },
  });
  if (!org) throw new Error(`Organisation ikke fundet: ${args.org}`);

  const beskriv = (o: {
    vacationYearStartMonth: number | null;
    vacationAccrualMode: string | null;
    vacationCarryOverMaxDays: string | null;
    vacationPayOutRemaining: boolean | null;
    vacationSettingsChangedAt: Date | null;
  }) =>
    `startmåned=${o.vacationYearStartMonth} model=${o.vacationAccrualMode} overførselsloft=${o.vacationCarryOverMaxDays} udbetal-rest=${o.vacationPayOutRemaining} skiftet=${o.vacationSettingsChangedAt?.toISOString() ?? "aldrig"}`;
  console.log(`Org: ${org.name} (${org.slug}, ${org.id})`);
  console.log(`Før:  ${beskriv(org)}`);

  const patch: Partial<typeof organizations.$inferInsert> = {};
  if (args.yearStart !== undefined)
    patch.vacationYearStartMonth = args.yearStart;
  if (args.mode !== undefined) patch.vacationAccrualMode = args.mode;
  if (args.carryOver !== undefined)
    patch.vacationCarryOverMaxDays = args.carryOver.toFixed(1);
  if (args.payOut !== undefined) patch.vacationPayOutRemaining = args.payOut;

  if (Object.keys(patch).length === 0) {
    console.log("Ingen felter angivet — org uændret.");
    return;
  }

  const oldStartMonth = Number(org.vacationYearStartMonth ?? 1);
  const newStartMonth = args.yearStart ?? oldStartMonth;
  const newMode = args.mode ?? org.vacationAccrualMode;
  const modelChanged =
    newMode !== org.vacationAccrualMode || newStartMonth !== oldStartMonth;
  const openMonthly = modelChanged && newMode === "monthly";
  // Skiftetidspunktet følger --as-of (middag, så datoen ikke ruller i UTC) —
  // ellers ville catch-up-grænsen ligge EFTER skiftemåneden ved backdating.
  const asOf = args.asOf ?? toLocalDateStr(new Date());
  if (modelChanged) {
    patch.vacationSettingsChangedAt = args.asOf
      ? new Date(`${args.asOf}T12:00:00`)
      : new Date();
  }

  // Åbningsplan (#532): resten i den periode der gælder i dag under de GAMLE
  // indstillinger flyttes ind i den nye periode som 'opening'.
  const plans: OpeningPlan[] = [];
  if (openMonthly) {
    const oldPeriod = vacationPeriodFor(asOf, oldStartMonth);
    const newPeriod = vacationPeriodFor(asOf, newStartMonth);
    const profiles = await db
      .select({
        userId: employeeProfiles.userId,
        name: users.name,
        email: users.email,
      })
      .from(employeeProfiles)
      .innerJoin(users, eq(users.id, employeeProfiles.userId))
      .where(
        and(
          eq(employeeProfiles.organizationId, org.id),
          eq(employeeProfiles.isActive, true),
        ),
      );
    for (const p of profiles) {
      const [oldRow, newRow] = await Promise.all([
        db.query.vacationBalances.findFirst({
          where: and(
            eq(vacationBalances.userId, p.userId),
            eq(vacationBalances.organizationId, org.id),
            eq(vacationBalances.periodStart, oldPeriod.start),
          ),
        }),
        db.query.vacationBalances.findFirst({
          where: and(
            eq(vacationBalances.userId, p.userId),
            eq(vacationBalances.organizationId, org.id),
            eq(vacationBalances.periodStart, newPeriod.start),
          ),
        }),
      ]);
      const fromBalance = args.opening === "from-balance" && oldRow;
      plans.push({
        userId: p.userId,
        label: p.name || p.email || p.userId,
        fromPeriod: oldRow ? oldPeriod.start : null,
        vacation: fromBalance ? Number(oldRow.remainingDays) : 0,
        extra: fromBalance ? Number(oldRow.extraRemainingDays) : 0,
        exists: !!newRow,
      });
    }
    console.log(
      `\nModelskift → monthly pr. ${asOf}: ny periode ${newPeriod.start}–${newPeriod.end} (${newPeriod.label}), åbning=${args.opening}`,
    );
    for (const plan of plans) {
      const src = plan.fromPeriod
        ? `rest fra ${plan.fromPeriod}`
        : "ingen gammel saldo";
      console.log(
        plan.exists
          ? `  - ${plan.label}: periode findes allerede — springes over`
          : `  + ${plan.label}: opening ferie=${plan.vacation.toFixed(2)} feriefridage=${plan.extra.toFixed(2)} (${src})`,
      );
    }
    console.log(
      `${plans.filter((p) => !p.exists).length} åbningsposteringer, ${plans.filter((p) => p.exists).length} springes over.`,
    );
  }

  if (args.dryRun) {
    console.log("\n[dry-run] Ville opdatere:", patch);
    return;
  }

  await db.transaction(async (tx) => {
    await tx
      .update(organizations)
      .set(patch)
      .where(eq(organizations.id, org.id));
    if (!openMonthly) return;
    // Friske indstillinger (inkl. settingsChangedAt) så ensureVacationPeriod
    // ikke catch-up'er måneder før skiftet
    const settings = await getVacationOrgSettings(tx, org.id);
    for (const plan of plans) {
      if (plan.exists) continue;
      await ensureVacationPeriod(tx, plan.userId, org.id, asOf, settings, {
        opening: {
          vacation: plan.vacation,
          extra: plan.extra,
          note: plan.fromPeriod
            ? `Åbningssaldo ved skift af feriemodel (rest fra ${plan.fromPeriod})`
            : "Åbningssaldo ved skift af feriemodel",
        },
      });
    }
  });

  const after = await db.query.organizations.findFirst({
    where: eq(organizations.id, org.id),
    columns: {
      vacationYearStartMonth: true,
      vacationAccrualMode: true,
      vacationCarryOverMaxDays: true,
      vacationPayOutRemaining: true,
      vacationSettingsChangedAt: true,
    },
  });
  if (after) console.log(`Efter: ${beskriv(after)}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
