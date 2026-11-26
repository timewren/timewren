import { randomUUID } from "node:crypto";
import { and, eq, gte, inArray, lt } from "drizzle-orm";
import { z } from "zod";
import { toIntlLocale } from "@/i18n/format-locale";
import { activeLocale, tr } from "@/i18n/server-text";
import {
  activityTypes,
  employeeProfiles,
  projects,
  timeEntries,
  timesheetWeeks,
  users,
} from "@/lib/db/schema";
import { weekStartOf } from "@/lib/enterprise/edit-guard";
import { getEffectivePeriodLock } from "@/lib/org/period-lock";
import { router } from "../../trpc";
import { orgAdminProcedure } from "./middleware";

const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

function parseLocalDate(date: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/** Importerede grid-løse poster lægges kl. 08 som seed/timeseddel gør. */
function entryTimestamp(date: string): Date {
  const d = parseLocalDate(date);
  d.setHours(8, 0, 0, 0);
  return d;
}

export const enterpriseTimelogImportRouter = router({
  /**
   * importTimeEntries — importér historiske tidsregistreringer (fx fra
   * TimeLog-eksport). dryRun validerer og opsummerer uden at skrive.
   *
   * - Medarbejdere matches på email og skal have en profil i organisationen
   * - Projekter matches på navn (case-insensitivt) og oprettes efter behov
   *   som interne projekter uden kunde
   * - Identiske allerede-importerede rækker springes over, så importen kan
   *   køres igen uden dubletter
   */
  importTimeEntries: orgAdminProcedure
    .input(
      z.object({
        rows: z
          .array(
            z.object({
              email: z.string().email().max(320),
              date: dateString,
              hours: z.number().gt(0).max(24),
              projectName: z.string().max(255).nullable(),
              // Aktivitetstype (#459) — matches på navn, oprettes efter behov
              activityName: z.string().max(255).nullable().optional(),
              description: z.string().max(2000).nullable(),
            }),
          )
          .min(1)
          .max(2000),
        dryRun: z.boolean().default(true),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const activityKey = (name: string | null | undefined): string =>
        (name ?? "").trim().toLowerCase();
      // 1. Match medarbejdere på email (kun org-medlemmer med profil)
      const emails = Array.from(
        new Set(input.rows.map((r) => r.email.toLowerCase())),
      );
      const matchedUsers = await ctx.db
        .select({ id: users.id, email: users.email })
        .from(users)
        .innerJoin(
          employeeProfiles,
          and(
            eq(employeeProfiles.userId, users.id),
            eq(employeeProfiles.organizationId, ctx.orgId),
          ),
        )
        .where(inArray(users.email, emails));
      const userIdByEmail = new Map(
        matchedUsers.map((u) => [u.email.toLowerCase(), u.id]),
      );
      const unknownEmails = emails.filter((e) => !userIdByEmail.has(e));

      const validRows = input.rows.filter((r) =>
        userIdByEmail.has(r.email.toLowerCase()),
      );

      // 2. Projekter: match på navn, find hvad der skal oprettes
      const orgProjects = await ctx.db.query.projects.findMany({
        where: eq(projects.organizationId, ctx.orgId),
        columns: { id: true, name: true },
      });
      const projectIdByName = new Map(
        orgProjects.map((p) => [p.name.toLowerCase(), p.id]),
      );
      const projectNames = Array.from(
        new Set(
          validRows
            .map((r) => r.projectName)
            .filter((n): n is string => n !== null && n.trim() !== ""),
        ),
      );
      const projectsToCreate = projectNames.filter(
        (n) => !projectIdByName.has(n.toLowerCase()),
      );

      // 2b. Aktivitetstyper (#459): match på navn (inkl. arkiverede, så en
      // arkiveret type ikke genopstår som ny), opret de manglende
      const orgActivities = await ctx.db.query.activityTypes.findMany({
        where: eq(activityTypes.organizationId, ctx.orgId),
        columns: { id: true, name: true, sortOrder: true },
      });
      const activityIdByName = new Map(
        orgActivities.map((a) => [activityKey(a.name), a.id]),
      );
      const activityNames = Array.from(
        new Map(
          validRows
            .filter((r) => activityKey(r.activityName) !== "")
            .map((r) => [
              activityKey(r.activityName),
              (r.activityName as string).trim(),
            ]),
        ).values(),
      );
      const activitiesToCreate = activityNames.filter(
        (n) => !activityIdByName.has(activityKey(n)),
      );

      // 3. Dublet-guard: eksisterende importerede poster i datointervallet
      const userIds = Array.from(
        new Set(
          validRows.map(
            (r) => userIdByEmail.get(r.email.toLowerCase()) as string,
          ),
        ),
      );
      let existingKeys = new Set<string>();
      if (validRows.length > 0) {
        const dates = validRows.map((r) => r.date).sort();
        const minDate = parseLocalDate(dates[0]);
        const maxDate = parseLocalDate(dates[dates.length - 1]);
        maxDate.setDate(maxDate.getDate() + 1);
        const existing = await ctx.db.query.timeEntries.findMany({
          where: and(
            eq(timeEntries.organizationId, ctx.orgId),
            eq(timeEntries.source, "import"),
            inArray(timeEntries.userId, userIds),
            gte(timeEntries.date, minDate),
            lt(timeEntries.date, maxDate),
          ),
          columns: {
            userId: true,
            date: true,
            hours: true,
            projectId: true,
            activityTypeId: true,
          },
        });
        const nameByProjectId = new Map(
          orgProjects.map((p) => [p.id, p.name.toLowerCase()]),
        );
        const nameByActivityId = new Map(
          orgActivities.map((a) => [a.id, activityKey(a.name)]),
        );
        existingKeys = new Set(
          existing.map((e) => {
            const dateStr = `${e.date.getFullYear()}-${String(e.date.getMonth() + 1).padStart(2, "0")}-${String(e.date.getDate()).padStart(2, "0")}`;
            const project = e.projectId
              ? (nameByProjectId.get(e.projectId) ?? "")
              : "";
            const activity = e.activityTypeId
              ? (nameByActivityId.get(e.activityTypeId) ?? "")
              : "";
            return `${e.userId}:${dateStr}:${Number(e.hours)}:${project}:${activity}`;
          }),
        );
      }

      const toImport = validRows.filter((r) => {
        const userId = userIdByEmail.get(r.email.toLowerCase());
        const key = `${userId}:${r.date}:${r.hours}:${(r.projectName ?? "").toLowerCase()}:${activityKey(r.activityName)}`;
        return !existingKeys.has(key);
      });
      const skippedDuplicates = validRows.length - toImport.length;

      // Opsummering pr. projekt + datointerval (til preview)
      const hoursPerProject = new Map<string, number>();
      for (const r of toImport) {
        const key =
          r.projectName ??
          (await tr("serverErrors", "enterprise.import.noProject"));
        hoursPerProject.set(
          key,
          Math.round(((hoursPerProject.get(key) ?? 0) + r.hours) * 100) / 100,
        );
      }
      const allDates = toImport.map((r) => r.date).sort();

      // Låse (#467) — kun advarsel ved import: historik skal kunne lægges
      // ind, men admin skal vide at rækker rammer låste perioder/uger
      const warnings: string[] = [];
      if (toImport.length > 0) {
        const periodLock = await getEffectivePeriodLock(ctx.db, ctx.orgId);
        if (periodLock) {
          const lockedCount = toImport.filter(
            (r) => parseLocalDate(r.date) < periodLock,
          ).length;
          if (lockedCount > 0) {
            warnings.push(
              await tr("serverErrors", "enterprise.import.beforeLock", {
                count: lockedCount,
                date: periodLock.toLocaleDateString(
                  toIntlLocale(activeLocale()),
                  { timeZone: "Europe/Copenhagen" },
                ),
              }),
            );
          }
        }
        const weekKeys = new Set(
          toImport.map(
            (r) =>
              `${userIdByEmail.get(r.email.toLowerCase())}|${weekStartOf(r.date)}`,
          ),
        );
        const lockedWeeks = await ctx.db.query.timesheetWeeks.findMany({
          where: and(
            eq(timesheetWeeks.organizationId, ctx.orgId),
            inArray(timesheetWeeks.userId, userIds),
            inArray(timesheetWeeks.status, ["submitted", "approved"]),
            inArray(
              timesheetWeeks.weekStart,
              Array.from(
                new Set(Array.from(weekKeys).map((k) => k.split("|")[1])),
              ),
            ),
          ),
          columns: { userId: true, weekStart: true },
        });
        const hits = lockedWeeks.filter((w) =>
          weekKeys.has(`${w.userId}|${w.weekStart}`),
        ).length;
        if (hits > 0) {
          warnings.push(
            await tr("serverErrors", "enterprise.import.submittedWeeks", {
              count: hits,
            }),
          );
        }
      }

      const summary = {
        dryRun: input.dryRun,
        totalRows: input.rows.length,
        toImport: toImport.length,
        skippedDuplicates,
        skippedUnknown: input.rows.length - validRows.length,
        unknownEmails,
        projectsToCreate,
        activitiesToCreate,
        perProject: Object.fromEntries(hoursPerProject),
        warnings,
        dateRange:
          allDates.length > 0
            ? { from: allDates[0], to: allDates[allDates.length - 1] }
            : null,
      };

      if (input.dryRun || toImport.length === 0) {
        return summary;
      }

      // 4. Skriv: manglende projekter → entries (batched)
      const now = new Date();
      for (const name of projectsToCreate) {
        const [project] = await ctx.db
          .insert(projects)
          .values({
            id: randomUUID(),
            name,
            // Interne projekter uden kunde (#467) — ingen dummy-klient længere
            clientId: null,
            userId: ctx.session.user.id,
            organizationId: ctx.orgId,
            status: "active",
          })
          .returning({ id: projects.id, name: projects.name });
        projectIdByName.set(project.name.toLowerCase(), project.id);
      }

      // Manglende aktivitetstyper (#459) lægges sidst i rækkefølgen
      let nextSortOrder =
        orgActivities.length > 0
          ? Math.max(...orgActivities.map((a) => a.sortOrder)) + 1
          : 0;
      for (const name of activitiesToCreate) {
        const [activity] = await ctx.db
          .insert(activityTypes)
          .values({
            organizationId: ctx.orgId,
            name,
            sortOrder: nextSortOrder++,
          })
          .returning({ id: activityTypes.id, name: activityTypes.name });
        activityIdByName.set(activityKey(activity.name), activity.id);
      }

      const BATCH = 250;
      for (let i = 0; i < toImport.length; i += BATCH) {
        const batch = toImport.slice(i, i + BATCH);
        await ctx.db.insert(timeEntries).values(
          batch.map((r) => ({
            userId: userIdByEmail.get(r.email.toLowerCase()) as string,
            organizationId: ctx.orgId,
            projectId: r.projectName
              ? (projectIdByName.get(r.projectName.toLowerCase()) ?? null)
              : null,
            activityTypeId:
              activityKey(r.activityName) !== ""
                ? (activityIdByName.get(activityKey(r.activityName)) ?? null)
                : null,
            description: r.description ?? "Importeret fra TimeLog",
            hours: r.hours.toFixed(2),
            date: entryTimestamp(r.date),
            isBillable: false,
            source: "import",
            createdAt: now,
            updatedAt: now,
          })),
        );
      }

      return { ...summary, dryRun: false };
    }),
});
