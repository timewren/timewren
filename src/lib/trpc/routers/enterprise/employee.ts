import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, gt, inArray } from "drizzle-orm";
import { z } from "zod";
import { st, tr } from "@/i18n/server-text";
import type { db as dbType } from "@/lib/db";
import {
  absenceRequests,
  departments,
  employeeProfiles,
  employmentPeriods,
  members,
  orgAuditLogs,
  users,
} from "@/lib/db/schema";
import {
  CLOSURE_SKIP_LABELS,
  loadFutureClosureContext,
  materializeFutureClosuresForEmployee,
  skippedClosures,
} from "@/lib/enterprise/closure";
import {
  employmentIntervals,
  latestPeriod,
  previousDay,
  sortPeriods,
  validatePeriodDates,
} from "@/lib/enterprise/employment";
import { resolveImportManagers } from "@/lib/enterprise/import";
import { getVisibleScope } from "@/lib/enterprise/scope";
import { DEFAULT_WORKING_DAYS } from "@/lib/enterprise/timesheet";
import { calculateConversionFactor } from "@/lib/enterprise/vacation";
import { auditDiff, logOrgAudit, pickAuditFields } from "@/lib/org-audit";
import { copenhagenToday } from "@/lib/time/copenhagen";
import { router } from "../../trpc";
import {
  orgAdminProcedure,
  organizationProcedure,
  orgManagerReadProcedure,
} from "./middleware";

/** employee_profiles.role — hr er read-all (#464), se org-role.ts */
const profileRoleSchema = z.enum(["admin", "hr", "manager", "member"]);

/** Felter på employee_profiles der indgår i før/efter-diff i audit (#466). */
const PROFILE_AUDIT_FIELDS = [
  "role",
  "employmentType",
  "weeklyHours",
  "workingDays",
  "startDate",
  "departmentId",
  "managerId",
  "isSelfScheduler",
  "isActive",
  "dailyNormHours",
  "breakMinutes",
] as const;

/** Fratrædelsesårsager (#465) — labels i EmploymentTimeline.tsx */
export const END_REASONS = [
  "resigned",
  "dismissed",
  "retired",
  "contract_ended",
  "other",
] as const;

const dateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, { error: () => st("zod.dateYmd") });

/** Felter på employment_periods der indgår i før/efter-diff i audit. */
const PERIOD_AUDIT_FIELDS = [
  "validFrom",
  "validTo",
  "weeklyHours",
  "employmentType",
  "departmentId",
  "position",
  "workingDays",
  "dailyNormHours",
  "breakMinutes",
  "endReason",
] as const;

/** Profil i org'en eller NOT_FOUND. SECURITY: org-ejerskab tjekkes altid. */
async function loadProfileInOrg(
  db: typeof dbType,
  profileId: string,
  orgId: string,
): Promise<typeof employeeProfiles.$inferSelect> {
  const profile = await db.query.employeeProfiles.findFirst({
    where: eq(employeeProfiles.id, profileId),
  });
  if (!profile || profile.organizationId !== orgId) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: await tr("serverErrors", "enterprise.employeeProfileNotFound"),
    });
  }
  return profile;
}

type Tx = Parameters<Parameters<typeof dbType.transaction>[0]>[0];

/**
 * Profilens vilkår er et cache af den seneste ansættelsesperiode (#465):
 * ugetimer/FTE/type/afdeling/arbejdsdage/norm-override, start = starten på
 * det sidste sammenhængende ansættelsesforhold, slut = dets fratrædelse.
 * isActive: sættes false når fratrædelsen er passeret; sættes KUN true når
 * kalderen beder om det (genansættelse/genaktivering) — en almindelig
 * periode-rettelse må aldrig stille genaktivere en deaktiveret profil.
 */
async function syncProfileFromPeriods(
  tx: Tx,
  profileId: string,
  today: string,
  opts: { reactivate?: boolean } = {},
): Promise<void> {
  const periods = sortPeriods(
    await tx.query.employmentPeriods.findMany({
      where: eq(employmentPeriods.employeeProfileId, profileId),
    }),
  );
  const latest = latestPeriod(periods);
  if (!latest) return;
  const intervals = employmentIntervals(periods);
  const current = intervals[intervals.length - 1];
  const ended = current.end != null && current.end < today;
  const patch: Partial<typeof employeeProfiles.$inferInsert> = {
    weeklyHours: latest.weeklyHours,
    conversionFactor: latest.conversionFactor,
    employmentType: latest.employmentType,
    departmentId: latest.departmentId,
    workingDays: latest.workingDays,
    dailyNormHours: latest.dailyNormHours,
    breakMinutes: latest.breakMinutes,
    startDate: current.start,
    endDate: current.end,
    updatedAt: new Date(),
  };
  if (ended) patch.isActive = false;
  else if (opts.reactivate && latest.validTo == null) patch.isActive = true;
  await tx
    .update(employeeProfiles)
    .set(patch)
    .where(eq(employeeProfiles.id, profileId));
}

/** Lås profil-rækken (FOR UPDATE) så to samtidige kald ikke skaber to åbne perioder. */
async function lockProfileRow(tx: Tx, profileId: string): Promise<void> {
  await tx
    .select({ id: employeeProfiles.id })
    .from(employeeProfiles)
    .where(eq(employeeProfiles.id, profileId))
    .for("update");
}

/**
 * Fratrædelse (#465) — delt af endEmployment og deactivateProfile: den åbne
 * periode lukkes på datoen med årsag, afventende fraværsanmodninger efter
 * datoen annulleres, profil-cachen synkroniseres og det audit-logges.
 * Data bevares — intet slettes.
 */
async function endEmploymentTx(
  tx: Tx,
  params: {
    orgId: string;
    actorId: string;
    profile: typeof employeeProfiles.$inferSelect;
    endDate: string;
    reason: (typeof END_REASONS)[number];
    note: string | null | undefined;
    today: string;
    source: "employment_ended" | "deactivate";
  },
): Promise<{ periodId: string; cancelledRequests: number }> {
  const { orgId, actorId, profile, today } = params;
  await lockProfileRow(tx, profile.id);
  const periods = sortPeriods(
    await tx.query.employmentPeriods.findMany({
      where: eq(employmentPeriods.employeeProfileId, profile.id),
    }),
  );
  const latest = latestPeriod(periods);
  if (!latest || latest.validTo != null) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: await tr("serverErrors", "enterprise.employee.employmentEnded"),
    });
  }
  if (latest.validFrom != null && params.endDate < latest.validFrom) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: await tr(
        "serverErrors",
        "enterprise.employee.endBeforePeriodStart",
        { date: latest.validFrom },
      ),
    });
  }

  await tx
    .update(employmentPeriods)
    .set({
      validTo: params.endDate,
      endReason: params.reason,
      note: params.note ?? latest.note,
      updatedAt: new Date(),
    })
    .where(eq(employmentPeriods.id, latest.id));

  // Afventende anmodninger der starter efter fratrædelsen annulleres
  const cancelled = await tx
    .update(absenceRequests)
    .set({ status: "cancelled", updatedAt: new Date() })
    .where(
      and(
        eq(absenceRequests.userId, profile.userId),
        eq(absenceRequests.organizationId, orgId),
        eq(absenceRequests.status, "pending"),
        gt(absenceRequests.startDate, params.endDate),
      ),
    )
    .returning({ id: absenceRequests.id });

  await syncProfileFromPeriods(tx, profile.id, today);

  await logOrgAudit(tx, orgId, actorId, "employment_ended", {
    targetUserId: profile.userId,
    metadata: {
      profileId: profile.id,
      periodId: latest.id,
      endDate: params.endDate,
      reason: params.reason,
      source: params.source,
      cancelledAbsenceRequestIds: cancelled.map((c) => c.id),
    },
  });
  if (
    params.source === "employment_ended" &&
    params.endDate < today &&
    profile.isActive
  ) {
    await logOrgAudit(tx, orgId, actorId, "employee_profile_deactivated", {
      targetUserId: profile.userId,
      metadata: { profileId: profile.id, source: "employment_ended" },
    });
  }
  return { periodId: latest.id, cancelledRequests: cancelled.length };
}

/** Første periode for en ny profil (#465) — spejler profilens felter. */
async function insertInitialPeriod(
  db: typeof dbType | Parameters<Parameters<typeof dbType.transaction>[0]>[0],
  profile: typeof employeeProfiles.$inferSelect,
  createdBy: string,
): Promise<void> {
  await db.insert(employmentPeriods).values({
    organizationId: profile.organizationId,
    employeeProfileId: profile.id,
    userId: profile.userId,
    validFrom: profile.startDate ?? null,
    validTo: profile.endDate ?? null,
    weeklyHours: profile.weeklyHours,
    conversionFactor: profile.conversionFactor,
    employmentType: profile.employmentType,
    departmentId: profile.departmentId,
    workingDays: profile.workingDays,
    dailyNormHours: profile.dailyNormHours,
    breakMinutes: profile.breakMinutes,
    createdBy,
  });
}

/**
 * Verify a department belongs to the caller's org. Prevents an admin from
 * assigning an employee to another org's department by guessing its UUID.
 */
async function assertDepartmentInOrg(
  db: typeof dbType,
  departmentId: string,
  orgId: string,
): Promise<void> {
  const dept = await db.query.departments.findFirst({
    where: and(
      eq(departments.id, departmentId),
      eq(departments.organizationId, orgId),
    ),
    columns: { id: true },
  });
  if (!dept) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: await tr("serverErrors", "enterprise.departmentNotFound"),
    });
  }
}

/**
 * Verify a manager profile belongs to the caller's org AND that assigning it
 * to `profileId` would not create a cycle in the manager chain (A→B→A would
 * make org-chart traversal loop forever). `profileId` is null when creating a
 * brand-new profile (no id yet, so no cycle is possible).
 */
async function assertManagerValid(
  db: typeof dbType,
  managerId: string,
  orgId: string,
  profileId: string | null,
): Promise<void> {
  const manager = await db.query.employeeProfiles.findFirst({
    where: and(
      eq(employeeProfiles.id, managerId),
      eq(employeeProfiles.organizationId, orgId),
    ),
    columns: { id: true, managerId: true },
  });
  if (!manager) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: await tr("serverErrors", "enterprise.employee.managerNotFound"),
    });
  }
  if (profileId && managerId === profileId) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: await tr("serverErrors", "enterprise.employee.ownManager"),
    });
  }
  // Walk up the chain from the proposed manager; if we reach profileId we'd
  // close a cycle. Bounded to avoid runaway loops on pre-existing bad data.
  let current: string | null = manager.managerId;
  for (let i = 0; current && i < 100; i++) {
    if (current === profileId) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: await tr("serverErrors", "enterprise.employee.managerCycle"),
      });
    }
    const next: { managerId: string | null } | undefined =
      await db.query.employeeProfiles.findFirst({
        where: eq(employeeProfiles.id, current),
        columns: { managerId: true },
      });
    current = next?.managerId ?? null;
  }
}

export const enterpriseEmployeeRouter = router({
  /**
   * getProfile — get the caller's own employee profile.
   */
  getProfile: organizationProcedure.query(async ({ ctx }) => {
    const profile = await ctx.db.query.employeeProfiles.findFirst({
      where: and(
        eq(employeeProfiles.userId, ctx.session.user.id),
        eq(employeeProfiles.organizationId, ctx.orgId),
      ),
      with: {
        department: { columns: { id: true, name: true } },
        manager: { columns: { id: true, userId: true } },
      },
    });

    if (!profile) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: await tr("serverErrors", "enterprise.employeeProfileNotFound"),
      });
    }

    return profile;
  }),

  /**
   * getProfileById — get a specific employee profile by ID.
   * Manager+ only. SECURITY: verifies profile belongs to ctx.orgId.
   */
  getProfileById: orgManagerReadProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const profile = await ctx.db.query.employeeProfiles.findFirst({
        where: eq(employeeProfiles.id, input.id),
        with: {
          user: {
            columns: { id: true, name: true, email: true, image: true },
          },
          department: { columns: { id: true, name: true } },
          manager: { columns: { id: true, userId: true } },
        },
      });

      // SECURITY: verify org ownership
      if (!profile || profile.organizationId !== ctx.orgId) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: await tr(
            "serverErrors",
            "enterprise.employeeProfileNotFound",
          ),
        });
      }

      // Manager ser kun profiler i eget scope (#464); hr/admin/owner alle.
      const scope = await getVisibleScope(ctx.db, ctx);
      if (!scope.all && !scope.profileIds.has(profile.id)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: await tr(
            "serverErrors",
            "enterprise.employee.viewOwnTeamProfiles",
          ),
        });
      }

      return profile;
    }),

  /**
   * createProfile — give an existing org member an employee profile.
   * Admin/owner only. Members join through invitations, never here.
   */
  createProfile: orgAdminProcedure
    .input(
      z.object({
        userId: z.string(),
        role: profileRoleSchema.default("member"),
        employmentType: z
          .enum(["full_time", "part_time", "flexjob"])
          .default("full_time"),
        weeklyHours: z.string().default("37"),
        workingDays: z
          .array(z.string())
          .min(1)
          .max(7)
          .default(["1", "2", "3", "4", "5"]),
        startDate: z.string().optional(),
        departmentId: z.string().optional(),
        managerId: z.string().optional(),
        isSelfScheduler: z.boolean().default(false),
        // Valgfri override af org'ens dagsnorm/pause (#449); null = arv
        dailyNormHours: z.number().min(0.5).max(24).nullable().optional(),
        breakMinutes: z.number().int().min(0).max(240).nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Check if profile already exists
      const existing = await ctx.db.query.employeeProfiles.findFirst({
        where: and(
          eq(employeeProfiles.userId, input.userId),
          eq(employeeProfiles.organizationId, ctx.orgId),
        ),
      });

      if (existing) {
        throw new TRPCError({
          code: "CONFLICT",
          message: await tr(
            "serverErrors",
            "enterprise.employee.profileExists",
          ),
        });
      }

      // Validate cross-org references before any write.
      if (input.departmentId) {
        await assertDepartmentInOrg(ctx.db, input.departmentId, ctx.orgId);
      }
      if (input.managerId) {
        await assertManagerValid(ctx.db, input.managerId, ctx.orgId, null);
      }

      // Kun eksisterende medlemmer (listAddableMembers). Et vilkårligt
      // bruger-id fra en anden org må ikke meldes ind uden invitation.
      const membership = await ctx.db.query.members.findFirst({
        where: and(
          eq(members.userId, input.userId),
          eq(members.organizationId, ctx.orgId),
        ),
      });

      if (!membership) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: await tr("serverErrors", "organization.memberNotFound"),
        });
      }

      const profile = await ctx.db.transaction(async (tx) => {
        const [row] = await tx
          .insert(employeeProfiles)
          .values({
            userId: input.userId,
            organizationId: ctx.orgId,
            role: input.role,
            employmentType: input.employmentType,
            weeklyHours: input.weeklyHours,
            conversionFactor: String(
              calculateConversionFactor(Number(input.weeklyHours)),
            ),
            workingDays: input.workingDays,
            startDate: input.startDate,
            departmentId: input.departmentId,
            managerId: input.managerId,
            isSelfScheduler: input.isSelfScheduler,
            dailyNormHours:
              input.dailyNormHours == null
                ? null
                : input.dailyNormHours.toFixed(1),
            breakMinutes: input.breakMinutes ?? null,
          })
          .returning();
        // Ansættelseshistorik (#465): første periode spejler profilen
        await insertInitialPeriod(tx, row, ctx.session.user.id);
        await logOrgAudit(
          tx,
          ctx.orgId,
          ctx.session.user.id,
          "employee_profile_created",
          {
            targetUserId: input.userId,
            metadata: {
              profileId: row.id,
              ...pickAuditFields(row, PROFILE_AUDIT_FIELDS),
            },
          },
        );
        return row;
      });

      // Nyansat: fremtidige faste ferieuger (#436) gælder også for dem.
      // Profilen ER oprettet — en fejl her må ikke vælte svaret (#452);
      // den rapporteres som "sprunget over" med den neutrale fejl-label.
      let closureSkipped: ReturnType<typeof skippedClosures>;
      try {
        const closureResults = await materializeFutureClosuresForEmployee(
          ctx.db,
          {
            orgId: ctx.orgId,
            userId: input.userId,
            weeklyHours: Number(input.weeklyHours),
            workingDays: input.workingDays,
            createdBy: ctx.session.user.id,
          },
        );
        closureSkipped = skippedClosures(closureResults);
      } catch (err) {
        console.error(
          `[employee] lukkeperioder kunne ikke materialiseres for ${input.userId}:`,
          err,
        );
        closureSkipped = [
          {
            periodId: "",
            periodName: "Faste ferieuger",
            message: CLOSURE_SKIP_LABELS.error,
          },
        ];
      }

      return { ...profile, closureSkipped };
    }),

  /**
   * updateProfile — update employment details for an employee.
   * Admin/owner only. SECURITY: verifies profile belongs to ctx.orgId.
   */
  updateProfile: orgAdminProcedure
    .input(
      z.object({
        id: z.string(),
        role: profileRoleSchema.optional(),
        employmentType: z
          .enum(["full_time", "part_time", "flexjob"])
          .optional(),
        weeklyHours: z.string().optional(),
        workingDays: z.array(z.string()).min(1).max(7).optional(),
        startDate: z.string().nullable().optional(),
        departmentId: z.string().nullable().optional(),
        managerId: z.string().nullable().optional(),
        isSelfScheduler: z.boolean().optional(),
        isActive: z.boolean().optional(),
        // Override af org'ens dagsnorm/pause (#449): null rydder, undefined rører ikke
        dailyNormHours: z.number().min(0.5).max(24).nullable().optional(),
        breakMinutes: z.number().int().min(0).max(240).nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // SECURITY: verify org ownership
      const profile = await ctx.db.query.employeeProfiles.findFirst({
        where: eq(employeeProfiles.id, input.id),
      });
      if (!profile || profile.organizationId !== ctx.orgId) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: await tr(
            "serverErrors",
            "enterprise.employeeProfileNotFound",
          ),
        });
      }

      // Validate cross-org references + manager cycles before any write.
      if (input.departmentId) {
        await assertDepartmentInOrg(ctx.db, input.departmentId, ctx.orgId);
      }
      if (input.managerId) {
        await assertManagerValid(ctx.db, input.managerId, ctx.orgId, input.id);
      }

      const { id, ...data } = input;
      const patch: Record<string, unknown> = { updatedAt: new Date() };
      if (data.role !== undefined) patch.role = data.role;
      if (data.employmentType !== undefined)
        patch.employmentType = data.employmentType;
      if (data.weeklyHours !== undefined) {
        patch.weeklyHours = data.weeklyHours;
        // Keep the stored conversion factor in sync with weekly hours.
        patch.conversionFactor = String(
          calculateConversionFactor(Number(data.weeklyHours)),
        );
      }
      if (data.workingDays !== undefined) patch.workingDays = data.workingDays;
      if (data.startDate !== undefined) patch.startDate = data.startDate;
      if (data.departmentId !== undefined)
        patch.departmentId = data.departmentId;
      if (data.managerId !== undefined) patch.managerId = data.managerId;
      if (data.isSelfScheduler !== undefined)
        patch.isSelfScheduler = data.isSelfScheduler;
      if (data.isActive !== undefined) patch.isActive = data.isActive;
      if (data.dailyNormHours !== undefined) {
        patch.dailyNormHours =
          data.dailyNormHours === null ? null : data.dailyNormHours.toFixed(1);
      }
      if (data.breakMinutes !== undefined)
        patch.breakMinutes = data.breakMinutes;

      const updated = await ctx.db.transaction(async (tx) => {
        const [row] = await tx
          .update(employeeProfiles)
          .set(patch)
          .where(eq(employeeProfiles.id, id))
          .returning();

        // Ansættelseshistorik (#465): profilformularen RETTER den seneste
        // periode (tastefejl-semantik). Nye vilkår fra en dato oprettes
        // som ny periode via createEmploymentPeriod.
        const periods = sortPeriods(
          await tx.query.employmentPeriods.findMany({
            where: eq(employmentPeriods.employeeProfileId, id),
          }),
        );
        const latest = latestPeriod(periods);
        if (latest) {
          const periodPatch: Partial<typeof employmentPeriods.$inferInsert> =
            {};
          if (data.weeklyHours !== undefined) {
            periodPatch.weeklyHours = row.weeklyHours;
            periodPatch.conversionFactor = row.conversionFactor;
          }
          if (data.employmentType !== undefined)
            periodPatch.employmentType = row.employmentType;
          if (data.workingDays !== undefined)
            periodPatch.workingDays = row.workingDays;
          if (data.departmentId !== undefined)
            periodPatch.departmentId = row.departmentId;
          if (data.dailyNormHours !== undefined)
            periodPatch.dailyNormHours = row.dailyNormHours;
          if (data.breakMinutes !== undefined)
            periodPatch.breakMinutes = row.breakMinutes;
          // Startdato: profilens startDate er et cache af historikken. Med
          // én periode rettes den her; med flere skal den rettes på perioden
          // (fanen Ansættelse), ellers ville cache og historik skille sig.
          if (data.startDate !== undefined) {
            const changed =
              (data.startDate ?? null) !== (profile.startDate ?? null);
            if (changed && periods.length > 1) {
              throw new TRPCError({
                code: "BAD_REQUEST",
                message: await tr(
                  "serverErrors",
                  "enterprise.employee.hireDateManaged",
                ),
              });
            }
            periodPatch.validFrom = row.startDate;
          }
          if (Object.keys(periodPatch).length > 0) {
            await tx
              .update(employmentPeriods)
              .set({ ...periodPatch, updatedAt: new Date() })
              .where(eq(employmentPeriods.id, latest.id));
          }
        } else {
          await insertInitialPeriod(tx, row, ctx.session.user.id);
        }

        const diff = auditDiff(
          pickAuditFields(profile, PROFILE_AUDIT_FIELDS),
          pickAuditFields(row, PROFILE_AUDIT_FIELDS),
        );
        const activation = diff.isActive
          ? row.isActive
            ? ("employee_profile_reactivated" as const)
            : ("employee_profile_deactivated" as const)
          : null;
        if (activation) {
          await logOrgAudit(tx, ctx.orgId, ctx.session.user.id, activation, {
            targetUserId: profile.userId,
            metadata: { profileId: id },
          });
        }
        const { isActive: _isActive, ...rest } = diff;
        if (Object.keys(rest).length > 0) {
          await logOrgAudit(
            tx,
            ctx.orgId,
            ctx.session.user.id,
            "employee_profile_updated",
            {
              targetUserId: profile.userId,
              metadata: { profileId: id, diff: rest },
            },
          );
        }
        return row;
      });

      return updated;
    }),

  /**
   * deactivateProfile — deaktivér en medarbejder fra listen. Siden #465 er
   * det en fratrædelse pr. dags dato (årsag "other"): den åbne periode
   * lukkes, så medarbejderen falder ud af normtid/flex/ferie/rapporter —
   * ellers ville en deaktiveret profil tælle med i beregningerne.
   * Genaktivering = genansættelse (ny periode) via createEmploymentPeriod.
   * Admin/owner only. SECURITY: verifies profile belongs to ctx.orgId.
   */
  deactivateProfile: orgAdminProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      // SECURITY: verify org ownership
      const profile = await ctx.db.query.employeeProfiles.findFirst({
        where: eq(employeeProfiles.id, input.id),
      });
      if (!profile || profile.organizationId !== ctx.orgId) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: await tr(
            "serverErrors",
            "enterprise.employeeProfileNotFound",
          ),
        });
      }

      const today = copenhagenToday();
      const updated = await ctx.db.transaction(async (tx) => {
        const latest = latestPeriod(
          await tx.query.employmentPeriods.findMany({
            where: eq(employmentPeriods.employeeProfileId, profile.id),
          }),
        );
        if (latest && latest.validTo == null) {
          // Perioden kan ikke lukkes før den er begyndt
          const endDate =
            latest.validFrom != null && latest.validFrom > today
              ? latest.validFrom
              : today;
          await endEmploymentTx(tx, {
            orgId: ctx.orgId,
            actorId: ctx.session.user.id,
            profile,
            endDate,
            reason: "other",
            note: latest.note ?? "Deaktiveret fra medarbejderlisten",
            today,
            source: "deactivate",
          });
        }
        const [row] = await tx
          .update(employeeProfiles)
          .set({ isActive: false, updatedAt: new Date() })
          .where(eq(employeeProfiles.id, input.id))
          .returning();
        if (profile.isActive) {
          await logOrgAudit(
            tx,
            ctx.orgId,
            ctx.session.user.id,
            "employee_profile_deactivated",
            { targetUserId: profile.userId, metadata: { profileId: input.id } },
          );
        }
        return row;
      });

      return updated;
    }),

  // ─── Ansættelseshistorik (#465, E7) ──────────────────────────────────────

  /**
   * listEmploymentPeriods — alle perioder for en medarbejder, nyeste først.
   * Samme scope-regler som getProfileById.
   */
  listEmploymentPeriods: orgManagerReadProcedure
    .input(z.object({ profileId: z.string() }))
    .query(async ({ ctx, input }) => {
      const profile = await loadProfileInOrg(
        ctx.db,
        input.profileId,
        ctx.orgId,
      );
      const scope = await getVisibleScope(ctx.db, ctx);
      if (!scope.all && !scope.profileIds.has(profile.id)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: await tr(
            "serverErrors",
            "enterprise.employee.viewOwnTeamEmployments",
          ),
        });
      }
      const rows = await ctx.db.query.employmentPeriods.findMany({
        where: eq(employmentPeriods.employeeProfileId, profile.id),
        with: { department: { columns: { id: true, name: true } } },
      });
      return sortPeriods(rows).reverse();
    }),

  /**
   * createEmploymentPeriod — "Ændr ansættelse fra dato": ny periode med nye
   * vilkår. Den åbne periode lukkes dagen før; er ansættelsen afsluttet, er
   * det en genansættelse (profilen genaktiveres). Profilens felter
   * synkroniseres som cache af den seneste periode.
   */
  createEmploymentPeriod: orgAdminProcedure
    .input(
      z.object({
        profileId: z.string(),
        validFrom: dateString,
        weeklyHours: z.number().min(1).max(60),
        employmentType: z.enum(["full_time", "part_time", "flexjob"]),
        departmentId: z.string().nullable().optional(),
        position: z.string().max(255).nullable().optional(),
        workingDays: z.array(z.string()).min(1).max(7).optional(),
        dailyNormHours: z.number().min(0.5).max(24).nullable().optional(),
        breakMinutes: z.number().int().min(0).max(240).nullable().optional(),
        note: z.string().max(1000).nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const profile = await loadProfileInOrg(
        ctx.db,
        input.profileId,
        ctx.orgId,
      );
      if (input.departmentId) {
        await assertDepartmentInOrg(ctx.db, input.departmentId, ctx.orgId);
      }
      const today = copenhagenToday();

      return ctx.db.transaction(async (tx) => {
        await lockProfileRow(tx, profile.id);
        const existing = sortPeriods(
          await tx.query.employmentPeriods.findMany({
            where: eq(employmentPeriods.employeeProfileId, profile.id),
          }),
        );
        const latest = latestPeriod(existing);
        let rehire = false;
        if (latest) {
          if (latest.validFrom != null && input.validFrom <= latest.validFrom) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: await tr(
                "serverErrors",
                "enterprise.employee.startAfterLatest",
                { date: latest.validFrom },
              ),
            });
          }
          if (latest.validTo != null) {
            // Afsluttet ansættelse → genansættelse kræver dato efter fratrædelsen
            if (input.validFrom <= latest.validTo) {
              throw new TRPCError({
                code: "BAD_REQUEST",
                message: await tr(
                  "serverErrors",
                  "enterprise.employee.endedOn",
                  { date: latest.validTo },
                ),
              });
            }
            rehire = true;
          } else {
            // Åben periode lukkes dagen før den nye starter
            await tx
              .update(employmentPeriods)
              .set({
                validTo: previousDay(input.validFrom),
                updatedAt: new Date(),
              })
              .where(eq(employmentPeriods.id, latest.id));
          }
        }

        const [created] = await tx
          .insert(employmentPeriods)
          .values({
            organizationId: ctx.orgId,
            employeeProfileId: profile.id,
            userId: profile.userId,
            validFrom: input.validFrom,
            validTo: null,
            weeklyHours: input.weeklyHours.toFixed(1),
            conversionFactor: String(
              calculateConversionFactor(input.weeklyHours),
            ),
            employmentType: input.employmentType,
            departmentId:
              input.departmentId === undefined
                ? (latest?.departmentId ?? profile.departmentId)
                : input.departmentId,
            position:
              input.position === undefined
                ? (latest?.position ?? null)
                : input.position,
            workingDays:
              input.workingDays ??
              latest?.workingDays ??
              profile.workingDays ??
              DEFAULT_WORKING_DAYS,
            dailyNormHours:
              input.dailyNormHours === undefined
                ? (latest?.dailyNormHours ?? null)
                : input.dailyNormHours == null
                  ? null
                  : input.dailyNormHours.toFixed(1),
            breakMinutes:
              input.breakMinutes === undefined
                ? (latest?.breakMinutes ?? null)
                : input.breakMinutes,
            note: input.note ?? null,
            createdBy: ctx.session.user.id,
          })
          .returning();

        // Genansættelse efter fratrædelse — eller ny periode for en manuelt
        // deaktiveret profil (fx fra før historikken) — genaktiverer profilen
        const reactivate = rehire || !profile.isActive;
        await syncProfileFromPeriods(tx, profile.id, today, { reactivate });

        await logOrgAudit(
          tx,
          ctx.orgId,
          ctx.session.user.id,
          "employment_period_created",
          {
            targetUserId: profile.userId,
            metadata: {
              profileId: profile.id,
              periodId: created.id,
              validFrom: created.validFrom,
              weeklyHours: input.weeklyHours,
              employmentType: created.employmentType,
              departmentId: created.departmentId,
              position: created.position,
              rehire,
              previousPeriodId: latest?.id ?? null,
            },
          },
        );
        if (reactivate) {
          await logOrgAudit(
            tx,
            ctx.orgId,
            ctx.session.user.id,
            "employee_profile_reactivated",
            {
              targetUserId: profile.userId,
              metadata: {
                profileId: profile.id,
                source: rehire ? "rehire" : "new_period",
              },
            },
          );
        }
        return created;
      });
    }),

  /**
   * endEmployment — fratrædelse: den åbne periode lukkes på datoen,
   * profilen får slutdato (og deaktiveres når datoen er passeret — ellers
   * af det daglige cron-job), afventende fraværsanmodninger efter datoen
   * annulleres. Data bevares — intet slettes.
   */
  endEmployment: orgAdminProcedure
    .input(
      z.object({
        profileId: z.string(),
        endDate: dateString,
        reason: z.enum(END_REASONS),
        note: z.string().max(1000).nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const profile = await loadProfileInOrg(
        ctx.db,
        input.profileId,
        ctx.orgId,
      );
      const today = copenhagenToday();

      return ctx.db.transaction((tx) =>
        endEmploymentTx(tx, {
          orgId: ctx.orgId,
          actorId: ctx.session.user.id,
          profile,
          endDate: input.endDate,
          reason: input.reason,
          note: input.note,
          today,
          source: "employment_ended",
        }),
      );
    }),

  /**
   * updateEmploymentPeriod — ret en periodes vilkår eller datoer (fx en
   * tastefejl). Flyttes startdatoen, følger den forrige periodes slutdato
   * med, så der hverken opstår hul eller overlap. Profil-cachen
   * synkroniseres, hvis den seneste periode er rørt.
   */
  updateEmploymentPeriod: orgAdminProcedure
    .input(
      z.object({
        id: z.string(),
        validFrom: dateString.nullable().optional(),
        validTo: dateString.nullable().optional(),
        weeklyHours: z.number().min(1).max(60).optional(),
        employmentType: z
          .enum(["full_time", "part_time", "flexjob"])
          .optional(),
        departmentId: z.string().nullable().optional(),
        position: z.string().max(255).nullable().optional(),
        workingDays: z.array(z.string()).min(1).max(7).optional(),
        dailyNormHours: z.number().min(0.5).max(24).nullable().optional(),
        breakMinutes: z.number().int().min(0).max(240).nullable().optional(),
        endReason: z.enum(END_REASONS).nullable().optional(),
        note: z.string().max(1000).nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const period = await ctx.db.query.employmentPeriods.findFirst({
        where: eq(employmentPeriods.id, input.id),
      });
      if (!period || period.organizationId !== ctx.orgId) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: await tr(
            "serverErrors",
            "enterprise.employee.periodNotFound",
          ),
        });
      }
      if (input.departmentId) {
        await assertDepartmentInOrg(ctx.db, input.departmentId, ctx.orgId);
      }
      const today = copenhagenToday();

      return ctx.db.transaction(async (tx) => {
        await lockProfileRow(tx, period.employeeProfileId);
        const siblings = sortPeriods(
          await tx.query.employmentPeriods.findMany({
            where: eq(
              employmentPeriods.employeeProfileId,
              period.employeeProfileId,
            ),
          }),
        );
        const idx = siblings.findIndex((p) => p.id === period.id);
        const prev = idx > 0 ? siblings[idx - 1] : null;
        const next =
          idx >= 0 && idx < siblings.length - 1 ? siblings[idx + 1] : null;

        const validFrom =
          input.validFrom === undefined ? period.validFrom : input.validFrom;
        const validTo =
          input.validTo === undefined ? period.validTo : input.validTo;
        const endReason =
          input.endReason === undefined ? period.endReason : input.endReason;
        // Ingen overlap (heller ikke med en afsluttet ansættelse før en
        // genansættelse) og ingen tavse huller mellem afløste perioder
        const dateError = validatePeriodDates({
          validFrom,
          validTo,
          endReason: validTo == null ? null : endReason,
          prev,
          next,
        });
        if (dateError) {
          throw new TRPCError({ code: "BAD_REQUEST", message: dateError });
        }

        const patch: Partial<typeof employmentPeriods.$inferInsert> = {
          updatedAt: new Date(),
          validFrom,
          validTo,
        };
        if (input.weeklyHours !== undefined) {
          patch.weeklyHours = input.weeklyHours.toFixed(1);
          patch.conversionFactor = String(
            calculateConversionFactor(input.weeklyHours),
          );
        }
        if (input.employmentType !== undefined)
          patch.employmentType = input.employmentType;
        if (input.departmentId !== undefined)
          patch.departmentId = input.departmentId;
        if (input.position !== undefined) patch.position = input.position;
        if (input.workingDays !== undefined)
          patch.workingDays = input.workingDays;
        if (input.dailyNormHours !== undefined)
          patch.dailyNormHours =
            input.dailyNormHours == null
              ? null
              : input.dailyNormHours.toFixed(1);
        if (input.breakMinutes !== undefined)
          patch.breakMinutes = input.breakMinutes;
        if (input.endReason !== undefined) patch.endReason = input.endReason;
        if (input.note !== undefined) patch.note = input.note;
        // Lukket periode uden årsag = afløst; åben periode har aldrig årsag
        if (validTo == null) patch.endReason = null;

        const [updated] = await tx
          .update(employmentPeriods)
          .set(patch)
          .where(eq(employmentPeriods.id, period.id))
          .returning();

        // Forrige periodes slutdato følger en flyttet startdato (ingen hul/overlap)
        if (
          prev &&
          validFrom != null &&
          validFrom !== period.validFrom &&
          prev.validTo != null &&
          prev.endReason == null
        ) {
          await tx
            .update(employmentPeriods)
            .set({ validTo: previousDay(validFrom), updatedAt: new Date() })
            .where(eq(employmentPeriods.id, prev.id));
        }

        await syncProfileFromPeriods(tx, period.employeeProfileId, today);

        const diff = auditDiff(
          pickAuditFields(period, PERIOD_AUDIT_FIELDS),
          pickAuditFields(updated, PERIOD_AUDIT_FIELDS),
        );
        if (Object.keys(diff).length > 0) {
          await logOrgAudit(
            tx,
            ctx.orgId,
            ctx.session.user.id,
            "employment_period_updated",
            {
              targetUserId: period.userId,
              metadata: {
                profileId: period.employeeProfileId,
                periodId: period.id,
                diff,
              },
            },
          );
        }
        return updated;
      });
    }),

  /**
   * getProfileHistory — hændelseslog for én medarbejder (#466): alt i
   * org-audit med targetUserId = profilens bruger, nyeste først. Samme
   * scope-regler som getProfileById (manager: egne medarbejdere; hr/admin/
   * owner: alle).
   */
  getProfileHistory: orgManagerReadProcedure
    .input(
      z.object({
        id: z.string(),
        limit: z.number().min(1).max(100).default(50),
        offset: z.number().min(0).default(0),
      }),
    )
    .query(async ({ ctx, input }) => {
      const profile = await ctx.db.query.employeeProfiles.findFirst({
        where: eq(employeeProfiles.id, input.id),
        columns: { id: true, userId: true, organizationId: true },
      });
      if (!profile || profile.organizationId !== ctx.orgId) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: await tr(
            "serverErrors",
            "enterprise.employeeProfileNotFound",
          ),
        });
      }
      const scope = await getVisibleScope(ctx.db, ctx);
      if (!scope.all && !scope.profileIds.has(profile.id)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: await tr(
            "serverErrors",
            "enterprise.employee.historyOwnTeamOnly",
          ),
        });
      }
      return ctx.db.query.orgAuditLogs.findMany({
        where: and(
          eq(orgAuditLogs.organizationId, ctx.orgId),
          eq(orgAuditLogs.targetUserId, profile.userId),
        ),
        orderBy: [desc(orgAuditLogs.createdAt)],
        limit: input.limit,
        offset: input.offset,
        with: {
          actor: {
            columns: { id: true, name: true, email: true, image: true },
          },
        },
      });
    }),

  /**
   * importEmployees — bulk-oprettelse af medarbejdere fra en valideret liste
   * (typisk parset fra CSV med parseEmployeeImport). Admin/owner only.
   *
   * Idempotent pr. email: eksisterende profiler springes over (ikke overskrevet).
   * Afdelinger oprettes on-the-fly hvis de ikke findes. Ledere slås op via
   * managerEmail — placér ledere før deres medarbejdere i filen, ellers
   * importeres medarbejderen uden leder (rapporteret i errors, ikke en hård fejl).
   */
  importEmployees: orgAdminProcedure
    .input(
      z.object({
        rows: z
          .array(
            z.object({
              name: z.string().min(1).max(200),
              email: z.string().email().max(320),
              department: z.string().max(200).nullable(),
              role: profileRoleSchema,
              weeklyHours: z.number().min(1).max(60),
              managerEmail: z.string().email().nullable(),
              startDate: z
                .string()
                .regex(/^\d{4}-\d{2}-\d{2}$/)
                .nullable(),
            }),
          )
          .min(1)
          .max(500),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const now = new Date();
      const created: string[] = [];
      const skipped: string[] = [];
      const errors: Array<{ email: string; message: string }> = [];
      // Fremtidige lukkeperioder der IKKE kunne materialiseres for en ny
      // medarbejder (overlap / ingen arbejdsdage / for lille saldo / fejl)
      const closureSkipped: Array<{
        email: string;
        period: string;
        message: string;
      }> = [];

      // Lukkeperioder, overtræk og helligdage hentes ÉN gang for hele batchen
      const closureContext = await loadFutureClosureContext(ctx.db, ctx.orgId);

      // Eksisterende afdelinger (navn → id, case-insensitivt)
      const orgDepartments = await ctx.db.query.departments.findMany({
        where: eq(departments.organizationId, ctx.orgId),
      });
      const departmentByName = new Map(
        orgDepartments.map((d) => [d.name.toLowerCase(), d.id]),
      );

      // email → userId/profileId (eksisterende + oprettede undervejs)
      const emails = input.rows.map((r) => r.email.toLowerCase());
      const managerEmails = input.rows
        .map((r) => r.managerEmail?.toLowerCase())
        .filter((e): e is string => Boolean(e));
      const lookupEmails = Array.from(new Set([...emails, ...managerEmails]));
      const existingUsers = await ctx.db.query.users.findMany({
        where: inArray(users.email, lookupEmails),
        columns: { id: true, email: true },
      });
      const userIdByEmail = new Map(
        existingUsers.map((u) => [u.email.toLowerCase(), u.id]),
      );
      const existingProfiles = userIdByEmail.size
        ? await ctx.db.query.employeeProfiles.findMany({
            where: and(
              eq(employeeProfiles.organizationId, ctx.orgId),
              inArray(
                employeeProfiles.userId,
                Array.from(userIdByEmail.values()),
              ),
            ),
            columns: { id: true, userId: true },
          })
        : [];
      const profileIdByUserId = new Map(
        existingProfiles.map((p) => [p.userId, p.id]),
      );

      for (const row of input.rows) {
        const email = row.email.toLowerCase();
        try {
          // 1. Bruger: find eller opret (uden adgangskode — sætter selv senere)
          let userId = userIdByEmail.get(email);
          if (!userId) {
            userId = randomUUID().replace(/-/g, "").slice(0, 24);
            await ctx.db.insert(users).values({
              id: userId,
              email: row.email,
              name: row.name,
              emailVerified: true,
              onboardingCompleted: true,
              role: "user",
              createdAt: now,
              updatedAt: now,
            });
            userIdByEmail.set(email, userId);
          }

          // 2. Profil findes → spring over (overskriv ikke)
          if (profileIdByUserId.has(userId)) {
            skipped.push(row.email);
            continue;
          }

          // 3. Medlemskab (members.role styrer enterprise-adgangskontrol)
          const membership = await ctx.db.query.members.findFirst({
            where: and(
              eq(members.userId, userId),
              eq(members.organizationId, ctx.orgId),
            ),
            columns: { id: true },
          });
          if (!membership) {
            await ctx.db.insert(members).values({
              id: crypto.randomUUID(),
              organizationId: ctx.orgId,
              userId,
              // members.role kender kun owner/admin/member; hr og manager
              // lever i employee_profiles.role (se org-role.ts)
              role: row.role === "admin" ? "admin" : "member",
            });
          }

          // 4. Afdeling: find eller opret
          let departmentId: string | null = null;
          if (row.department) {
            const key = row.department.toLowerCase();
            departmentId = departmentByName.get(key) ?? null;
            if (!departmentId) {
              departmentId = randomUUID();
              await ctx.db.insert(departments).values({
                id: departmentId,
                organizationId: ctx.orgId,
                name: row.department,
              });
              departmentByName.set(key, departmentId);
            }
          }

          // 5. Profil — leder sættes i andet pas (#464), så rækkefølgen i
          // filen er ligegyldig
          const weekly = row.weeklyHours;
          const [profile] = await ctx.db
            .insert(employeeProfiles)
            .values({
              userId,
              organizationId: ctx.orgId,
              departmentId,
              role: row.role,
              employmentType: weekly < 37 ? "part_time" : "full_time",
              weeklyHours: weekly.toFixed(1),
              conversionFactor: String(calculateConversionFactor(weekly)),
              workingDays: ["1", "2", "3", "4", "5"],
              startDate: row.startDate ?? undefined,
            })
            .returning();
          profileIdByUserId.set(userId, profile.id);
          created.push(row.email);
          await insertInitialPeriod(ctx.db, profile, ctx.session.user.id);
          await logOrgAudit(
            ctx.db,
            ctx.orgId,
            ctx.session.user.id,
            "employee_profile_created",
            {
              targetUserId: userId,
              targetEmail: row.email,
              metadata: {
                profileId: profile.id,
                source: "import",
                role: row.role,
                weeklyHours: weekly,
                departmentId,
              },
            },
          );

          // Fremtidige faste ferieuger (#436) for den nye medarbejder
          const closureResults = await materializeFutureClosuresForEmployee(
            ctx.db,
            {
              orgId: ctx.orgId,
              userId,
              weeklyHours: weekly,
              workingDays: ["1", "2", "3", "4", "5"],
              createdBy: ctx.session.user.id,
            },
            closureContext,
          );
          for (const s of skippedClosures(closureResults)) {
            closureSkipped.push({
              email: row.email,
              period: s.periodName,
              message: s.message,
            });
          }
        } catch (e) {
          errors.push({
            email: row.email,
            message:
              e instanceof Error
                ? e.message
                : await tr("serverErrors", "common.unknownError"),
          });
        }
      }

      // Pas 2 (#464): sæt leder for de NYOPRETTEDE profiler ud fra
      // managerEmail — lederen kan stå senere i filen eller findes i forvejen.
      // Manglende ledere rapporteres som advarsler (ikke hårde fejl).
      const createdSet = new Set(created);
      const resolved = resolveImportManagers(
        input.rows.filter((r) => createdSet.has(r.email)),
        (email) => {
          const uid = userIdByEmail.get(email.toLowerCase());
          return uid ? (profileIdByUserId.get(uid) ?? null) : null;
        },
      );
      for (const link of resolved.links) {
        try {
          await ctx.db
            .update(employeeProfiles)
            .set({ managerId: link.managerProfileId, updatedAt: now })
            .where(eq(employeeProfiles.id, link.profileId));
        } catch (e) {
          errors.push({
            email: link.email,
            message:
              e instanceof Error
                ? e.message
                : await tr("serverErrors", "common.unknownError"),
          });
        }
      }
      const warnings = resolved.missing.map((m) => ({
        email: m.email,
        message: st("enterprise.employee.importManagerMissing", {
          email: m.managerEmail,
        }),
      }));

      return { created, skipped, errors, warnings, closureSkipped };
    }),
});
