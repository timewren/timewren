import { and, asc, eq, gte, inArray, lt, ne } from "drizzle-orm";
import { z } from "zod";
import {
  clients,
  members,
  projects,
  timeEntries,
  timeEntrySegments,
  timerStates,
  users,
} from "@/lib/db/schema";
import {
  buildDayTimeline,
  type DayTimelineSegmentRow,
} from "@/lib/time/day-timeline";
import { orgAdminProcedure, protectedProcedure, router } from "../trpc";

/**
 * Team-live: who on the org is tracking right now. Available to any org member
 * (Team and Enterprise plans); for a solo org it simply shows the one user.
 * The personal timer (`timerStates`) is per-user; this joins each org member to
 * their current timer state for a live overview.
 */
export const teamRouter = router({
  liveTimers: protectedProcedure.query(async ({ ctx }) => {
    if (!ctx.orgId) return [];

    const rows = await ctx.db
      .select({
        userId: members.userId,
        userName: users.name,
        userEmail: users.email,
        role: members.role,
        isRunning: timerStates.isRunning,
        startTime: timerStates.startTime,
        elapsedSeconds: timerStates.elapsedSeconds,
        baseSeconds: timerStates.baseSeconds,
        description: timerStates.description,
        projectName: projects.name,
        clientName: clients.name,
      })
      .from(members)
      .innerJoin(users, eq(users.id, members.userId))
      .leftJoin(timerStates, eq(timerStates.userId, members.userId))
      .leftJoin(projects, eq(projects.id, timerStates.projectId))
      .leftJoin(clients, eq(clients.id, timerStates.clientId))
      .where(eq(members.organizationId, ctx.orgId));

    return rows.map((r) => ({
      userId: r.userId,
      userName: r.userName ?? r.userEmail ?? "Ukendt",
      role: r.role,
      isRunning: Boolean(r.isRunning),
      // Seconds accumulated up to now for a running timer; the client can keep
      // ticking from startTime for a live count.
      startTime: r.startTime ? r.startTime.toISOString() : null,
      elapsedSeconds: r.elapsedSeconds ?? 0,
      baseSeconds: r.baseSeconds ?? 0,
      description: r.description ?? "",
      projectName: r.projectName ?? null,
      clientName: r.clientName ?? null,
    }));
  }),

  /**
   * Dagsoverblik pr. medarbejder (kundeønske, 28/8): hvad hver medarbejder
   * har arbejdet på en given dag, HVORNÅR tiden ligger (start–slut) og hvor
   * mange timer det blev til. Kun for org-admins/ejere — det er en lederes
   * overblik over kolleger, ikke almindelig medlemsdata.
   */
  dayOverview: orgAdminProcedure
    .input(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }))
    .query(async ({ ctx, input }) => {
      if (!ctx.orgId) return { date: input.date, members: [] };

      const [y, m, d] = input.date.split("-").map(Number);
      const dayStart = new Date(y, m - 1, d);
      const dayEnd = new Date(y, m - 1, d + 1);

      const [memberRows, entryRows] = await Promise.all([
        ctx.db
          .select({
            userId: members.userId,
            name: users.name,
            email: users.email,
            image: users.image,
          })
          .from(members)
          .innerJoin(users, eq(users.id, members.userId))
          .where(eq(members.organizationId, ctx.orgId)),
        ctx.db
          .select({
            id: timeEntries.id,
            userId: timeEntries.userId,
            date: timeEntries.date,
            hours: timeEntries.hours,
            description: timeEntries.description,
            source: timeEntries.source,
            startTime: timeEntries.startTime,
            endTime: timeEntries.endTime,
            isBillable: timeEntries.isBillable,
            approvalStatus: timeEntries.approvalStatus,
            projectName: projects.name,
            clientName: clients.name,
          })
          .from(timeEntries)
          .leftJoin(projects, eq(projects.id, timeEntries.projectId))
          .leftJoin(clients, eq(clients.id, timeEntries.clientId))
          .where(
            and(
              eq(timeEntries.organizationId, ctx.orgId),
              gte(timeEntries.date, dayStart),
              lt(timeEntries.date, dayEnd),
            ),
          )
          .orderBy(asc(timeEntries.startTime), asc(timeEntries.id)),
      ]);

      // Segmenter: en postering kan bestå af flere arbejdsperioder
      // (9:00–11:30 + 14:00–16:00). De giver det sande billede af hvornår
      // medarbejderen var i gang, så de tages med hvor de findes.
      const entryIds = entryRows.map((e) => e.id);
      const segmentRows = entryIds.length
        ? await ctx.db
            .select({
              timeEntryId: timeEntrySegments.timeEntryId,
              startTime: timeEntrySegments.startTime,
              endTime: timeEntrySegments.endTime,
              durationMinutes: timeEntrySegments.durationMinutes,
            })
            .from(timeEntrySegments)
            .where(inArray(timeEntrySegments.timeEntryId, entryIds))
            .orderBy(asc(timeEntrySegments.startTime))
        : [];
      const segmentsByEntry = new Map<
        string,
        { start: string; end: string }[]
      >();
      for (const seg of segmentRows) {
        const list = segmentsByEntry.get(seg.timeEntryId) ?? [];
        list.push({
          start: seg.startTime.toISOString(),
          end: seg.endTime.toISOString(),
        });
        segmentsByEntry.set(seg.timeEntryId, list);
      }

      const entriesByUser = new Map<string, typeof entryRows>();
      for (const entry of entryRows) {
        const list = entriesByUser.get(entry.userId) ?? [];
        list.push(entry);
        entriesByUser.set(entry.userId, list);
      }

      // Segmenterne i kernens format (durationMinutes) — samme rækker, blot
      // uden ISO-konverteringen som UI-listen bruger.
      const timelineSegments: DayTimelineSegmentRow[] = segmentRows.map(
        (s) => ({
          timeEntryId: s.timeEntryId,
          startTime: s.startTime,
          endTime: s.endTime,
          durationMinutes: s.durationMinutes,
        }),
      );

      const result = memberRows.map((member) => {
        const entries = entriesByUser.get(member.userId) ?? [];
        // Pauser via den fælles gap-kerne. Begge options sættes eksplicit.
        //
        // excludeRejected: false — dagsoverblikket VISER afviste posteringer
        // (med status-badge), så pauserne skal beregnes på præcis det datasæt
        // lederen ser. Ellers ville en afvist 10–12-postering stå i listen
        // samtidig med en "2 t pause"-chip hen over samme tidsrum.
        // Spildtidsloggen bruger derimod excludeRejected: true — den måler
        // faktisk spildt tid, og der skal afvist tid ikke tælle som arbejde.
        // Konsekvens: en dag med afviste posteringer kan vise mindre pause
        // her end i spildtidsloggen. Det er bevidst.
        //
        // minGapMinutes 0 er præcis Logbogens visning ("6 min pause").
        const [timeline] = buildDayTimeline(
          entries.map((e) => ({
            id: e.id,
            date: e.date,
            startTime: e.startTime,
            endTime: e.endTime,
            hours: e.hours,
            description: e.description,
            source: e.source,
            approvalStatus: e.approvalStatus,
            projectName: e.projectName ?? null,
            clientName: e.clientName ?? null,
          })),
          timelineSegments,
          { minGapMinutes: 0, excludeRejected: false },
        );
        // Afviste posteringer vises (lederen skal kunne se dem), men tæller
        // ikke med i dagens timer — samme regel som rapporterne.
        const totalHours = entries
          .filter((e) => e.approvalStatus !== "rejected")
          .reduce((sum, e) => sum + Number.parseFloat(e.hours), 0);
        // Tilstedeværelse (første/sidste) bygger kun på godkendt/gyldig tid.
        const counted = entries.filter((e) => e.approvalStatus !== "rejected");
        const starts = counted
          .map((e) => e.startTime)
          .filter((t): t is Date => !!t);
        const ends = counted
          .map((e) => e.endTime)
          .filter((t): t is Date => !!t);
        return {
          userId: member.userId,
          name: member.name ?? member.email ?? "Ukendt",
          image: member.image ?? null,
          totalHours,
          // Pauser mellem dagens tidsstemplede registreringer, med absolutte
          // tidspunkter så UI'et kan placere chippen mellem to posteringer.
          gaps: (timeline?.gapDetails ?? []).map((g) => ({
            minutes: g.minutes,
            afterEnd: timeline?.intervals[g.afterIndex]?.end ?? null,
            beforeStart: timeline?.intervals[g.beforeIndex]?.start ?? null,
          })),
          summary: timeline?.summary ?? {
            gapMinutes: 0,
            spanMinutes: 0,
            workedMinutes: 0,
            untimedEntries: 0,
            syntheticEntries: 0,
          },
          // Første og sidste registrering på dagen — "hvornår kom og gik
          // medarbejderen". Null når posteringerne mangler tidspunkter
          // (manuelt indtastede timer uden start/slut).
          firstStart:
            starts.length > 0
              ? new Date(
                  Math.min(...starts.map((t) => t.getTime())),
                ).toISOString()
              : null,
          lastEnd:
            ends.length > 0
              ? new Date(
                  Math.max(...ends.map((t) => t.getTime())),
                ).toISOString()
              : null,
          entries: entries.map((e) => ({
            id: e.id,
            hours: Number.parseFloat(e.hours),
            description: e.description ?? "",
            clientName: e.clientName ?? null,
            projectName: e.projectName ?? null,
            isBillable: e.isBillable ?? true,
            approvalStatus: e.approvalStatus,
            startTime: e.startTime ? e.startTime.toISOString() : null,
            endTime: e.endTime ? e.endTime.toISOString() : null,
            segments: segmentsByEntry.get(e.id) ?? [],
          })),
        };
      });

      // Medarbejdere med tid først, derefter alfabetisk — lederen skal se
      // dagens aktivitet uden at scrolle forbi tomme rækker.
      result.sort(
        (a, b) =>
          b.totalHours - a.totalHours || a.name.localeCompare(b.name, "da-DK"),
      );

      return { date: input.date, members: result };
    }),

  /**
   * Ugeoverblik: timer pr. medarbejder pr. dag (man–søn) for den uge der
   * starter på `weekStart`. Samme leder-gate som dagsoverblikket; afviste
   * posteringer tæller ikke med.
   */
  weekOverview: orgAdminProcedure
    .input(z.object({ weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }))
    .query(async ({ ctx, input }) => {
      if (!ctx.orgId) return { weekStart: input.weekStart, members: [] };

      const [y, m, d] = input.weekStart.split("-").map(Number);
      const rangeStart = new Date(y, m - 1, d);
      const rangeEnd = new Date(y, m - 1, d + 7);
      const dayKeys = Array.from({ length: 7 }, (_, i) => {
        const day = new Date(y, m - 1, d + i);
        const mm = String(day.getMonth() + 1).padStart(2, "0");
        const dd = String(day.getDate()).padStart(2, "0");
        return `${day.getFullYear()}-${mm}-${dd}`;
      });

      const [memberRows, sumRows] = await Promise.all([
        ctx.db
          .select({
            userId: members.userId,
            name: users.name,
            email: users.email,
            image: users.image,
          })
          .from(members)
          .innerJoin(users, eq(users.id, members.userId))
          .where(eq(members.organizationId, ctx.orgId)),
        ctx.db
          .select({
            userId: timeEntries.userId,
            date: timeEntries.date,
            hours: timeEntries.hours,
          })
          .from(timeEntries)
          .where(
            and(
              eq(timeEntries.organizationId, ctx.orgId),
              gte(timeEntries.date, rangeStart),
              lt(timeEntries.date, rangeEnd),
              ne(timeEntries.approvalStatus, "rejected"),
            ),
          ),
      ]);

      // Dag-bucket ud fra lokal kalenderdag — samme grænser som
      // dagsoverblikkets [lokal midnat, næste lokal midnat). Ikke fast
      // døgnlængde: en uge med sommertidsskift har en dag på 23/25 timer.
      const byUser = new Map<string, number[]>();
      for (const row of sumRows) {
        const mm = String(row.date.getMonth() + 1).padStart(2, "0");
        const dd = String(row.date.getDate()).padStart(2, "0");
        const idx = dayKeys.indexOf(`${row.date.getFullYear()}-${mm}-${dd}`);
        if (idx < 0) continue;
        const days = byUser.get(row.userId) ?? [0, 0, 0, 0, 0, 0, 0];
        days[idx] += Number.parseFloat(row.hours);
        byUser.set(row.userId, days);
      }

      const result = memberRows.map((member) => {
        const hoursByDay = byUser.get(member.userId) ?? [0, 0, 0, 0, 0, 0, 0];
        return {
          userId: member.userId,
          name: member.name ?? member.email ?? "Ukendt",
          image: member.image ?? null,
          hoursByDay,
          totalHours: hoursByDay.reduce((sum, h) => sum + h, 0),
        };
      });
      result.sort(
        (a, b) =>
          b.totalHours - a.totalHours || a.name.localeCompare(b.name, "da-DK"),
      );

      return { weekStart: input.weekStart, days: dayKeys, members: result };
    }),
});
