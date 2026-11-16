/**
 * Flyt legacy-tidsposter uden aktivitet til en aktivitetstype (#475) — for
 * ALLE brugere i én organisation, så "(uden aktivitet)"-rækkerne forsvinder
 * fra ugegrid'et. Kun grid-poster (source=timesheet) som standard; detaljerede
 * registreringer (timer/kalender/manuel) kræver --all-sources.
 *
 *   npx tsx scripts/reassign-activity.ts --org <slug> --project <navn|all> --to <aktivitet> [--dry-run] [--all-sources] [--include-locked]
 *
 * Låste poster springes over som standard (samme lag som edit-guarden i
 * src/lib/enterprise/edit-guard.ts): dage før org'ens periodelås
 * (org_period_locks) og dage i uger med timesheet_weeks.status
 * submitted/approved for posten's ejer. --include-locked slår det fra —
 * brug det kun efter aftale, da godkendte uger så ændres uden om flowet.
 * Den rullende lås (timesheet_lock_after_weeks) håndhæves ikke: scriptet
 * køres af en administrator, som er undtaget den.
 *
 * Kun poster med organization_id = org'ens id rammes. Legacy-poster uden
 * organization_id (fra før multi-tenant) røres ikke — de tilhører
 * freelance-flowet og har ingen aktivitetsdimension.
 *
 * Projekter hvor aktiviteten ikke er tilladt (indsnævret tilladt-liste)
 * springes over med en advarsel — udvid listen først (admin: Tilladte
 * aktiviteter på projektet), eller kør igen bagefter. Idempotent: poster
 * der allerede har en aktivitet røres aldrig.
 */
import * as dotenv from "dotenv";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../src/lib/db/schema";
import { allowedActivitiesForProject } from "../src/lib/enterprise/activity-types";
import { weekStartOf } from "../src/lib/enterprise/edit-guard";
import { getEffectivePeriodLock } from "../src/lib/org/period-lock";

if (process.env.NODE_ENV !== "production") {
  dotenv.config({ path: ".env.local" });
}

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const allSources = args.includes("--all-sources");
const includeLocked = args.includes("--include-locked");
function flag(name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}
const orgSlug = flag("--org");
const projectArg = flag("--project");
const toName = flag("--to");

if (!orgSlug || !projectArg || !toName) {
  console.error(
    "Brug: --org <slug> --project <navn|all> --to <aktivitetsnavn> [--dry-run] [--all-sources] [--include-locked]",
  );
  process.exit(1);
}
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL mangler");
  process.exit(1);
}

async function main() {
  const client = postgres(databaseUrl as string, { max: 1 });
  const db = drizzle(client, { schema });

  try {
    const org = await db.query.organizations.findFirst({
      where: eq(schema.organizations.slug, orgSlug as string),
      columns: { id: true, name: true },
    });
    if (!org) {
      console.error(`Organisation med slug "${orgSlug}" findes ikke`);
      process.exit(1);
    }

    const types = await db.query.activityTypes.findMany({
      where: eq(schema.activityTypes.organizationId, org.id),
      columns: {
        id: true,
        name: true,
        color: true,
        sortOrder: true,
        isArchived: true,
      },
    });
    const target = types.find(
      (t) =>
        !t.isArchived &&
        t.name.trim().toLowerCase() === (toName as string).trim().toLowerCase(),
    );
    if (!target) {
      console.error(
        `Aktiv aktivitetstype "${toName}" findes ikke i ${org.name}. Findes: ${types
          .filter((t) => !t.isArchived)
          .map((t) => t.name)
          .join(", ")}`,
      );
      process.exit(1);
    }

    const projectRows = await db.query.projects.findMany({
      where: eq(schema.projects.organizationId, org.id),
      columns: { id: true, name: true },
    });
    const selected =
      projectArg === "all"
        ? projectRows
        : projectRows.filter(
            (p) =>
              p.name.trim().toLowerCase() ===
              (projectArg as string).trim().toLowerCase(),
          );
    if (selected.length === 0) {
      console.error(`Projekt "${projectArg}" findes ikke i ${org.name}`);
      process.exit(1);
    }

    const links = await db
      .select({
        projectId: schema.projectActivityTypes.projectId,
        activityTypeId: schema.projectActivityTypes.activityTypeId,
      })
      .from(schema.projectActivityTypes)
      .where(
        inArray(
          schema.projectActivityTypes.projectId,
          selected.map((p) => p.id),
        ),
      );
    const allowedByProject = new Map<string, Set<string>>();
    for (const link of links) {
      const set = allowedByProject.get(link.projectId) ?? new Set<string>();
      set.add(link.activityTypeId);
      allowedByProject.set(link.projectId, set);
    }

    // Låse (som edit-guarden): periodelås + indsendte/godkendte uger pr. ejer
    const periodLock = includeLocked
      ? null
      : await getEffectivePeriodLock(db, org.id);
    const lockedWeeks = new Set<string>();
    if (!includeLocked) {
      const weekRows = await db.query.timesheetWeeks.findMany({
        where: and(
          eq(schema.timesheetWeeks.organizationId, org.id),
          inArray(schema.timesheetWeeks.status, ["submitted", "approved"]),
        ),
        columns: { userId: true, weekStart: true },
      });
      for (const w of weekRows) lockedWeeks.add(`${w.userId}|${w.weekStart}`);
    }
    const isLocked = (entry: { userId: string; date: Date }): boolean =>
      (periodLock !== null && entry.date < periodLock) ||
      lockedWeeks.has(`${entry.userId}|${weekStartOf(entry.date)}`);

    console.log(
      `${org.name}: flytter poster uden aktivitet → "${target.name}"${
        allSources ? " (alle kilder)" : " (kun timeseddel-poster)"
      }${includeLocked ? " (inkl. låste uger/perioder)" : ""}${
        dryRun ? " — DRY-RUN" : ""
      }`,
    );

    let totalMoved = 0;
    let totalLocked = 0;
    for (const project of selected) {
      const allowed = allowedActivitiesForProject(
        project.id,
        types,
        allowedByProject,
      );
      if (!allowed.some((t) => t.id === target.id)) {
        console.warn(
          `  ! ${project.name}: "${target.name}" er ikke tilladt på projektet — springes over`,
        );
        continue;
      }
      const candidates = await db.query.timeEntries.findMany({
        where: and(
          eq(schema.timeEntries.organizationId, org.id),
          eq(schema.timeEntries.projectId, project.id),
          isNull(schema.timeEntries.activityTypeId),
          ...(allSources ? [] : [eq(schema.timeEntries.source, "timesheet")]),
        ),
        columns: { id: true, userId: true, date: true },
      });
      if (candidates.length === 0) continue;
      const movable = candidates.filter((e) => !isLocked(e));
      const locked = candidates.length - movable.length;
      totalLocked += locked;
      const users = new Set(movable.map((e) => e.userId)).size;
      console.log(
        `  ${project.name}: ${movable.length} post${movable.length === 1 ? "" : "er"} hos ${users} bruger${users === 1 ? "" : "e"}${
          locked > 0 ? ` (${locked} låst — springes over)` : ""
        }`,
      );
      if (movable.length === 0) continue;
      if (!dryRun) {
        await db
          .update(schema.timeEntries)
          .set({ activityTypeId: target.id, updatedAt: new Date() })
          .where(
            inArray(
              schema.timeEntries.id,
              movable.map((e) => e.id),
            ),
          );
      }
      totalMoved += movable.length;
    }
    console.log(
      `${dryRun ? "Ville flytte" : "Flyttede"} ${totalMoved} post${totalMoved === 1 ? "" : "er"} i alt${
        totalLocked > 0
          ? ` · ${totalLocked} låst (kør med --include-locked for at medtage dem)`
          : ""
      }`,
    );
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
