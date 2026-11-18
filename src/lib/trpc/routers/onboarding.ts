// Onboarding/subscription is per-user
import { and, eq, ne } from "drizzle-orm";
import { z } from "zod";
import { st, tr } from "@/i18n/server-text";
import { isCheckoutAvailableForUser } from "@/lib/billing/brand-billing";
import {
  campaignDiscountExpiresAt,
  describeCampaign,
  findCampaignCode,
  resolveCampaignCode,
} from "@/lib/billing/campaign-codes";
import { FREE_TIER_SUBSCRIPTION_FIELDS } from "@/lib/billing/plan-limits";
import {
  clampSeats,
  FOUNDING_MEMBER,
  includedSeatsForTier,
  isPrivatPlanConfigured,
} from "@/lib/config";
import type { db as Db } from "@/lib/db";
import {
  clients,
  companyProfiles,
  invoices,
  members,
  onboardingProgress,
  prepaidPackages,
  subscriptions,
  timeEntries,
  users,
} from "@/lib/db/schema";
import {
  clearDemoData,
  hasDemoData,
  seedDemoData,
} from "@/lib/demo/seed-demo-data";
import { grantEnterpriseForTierSafe } from "@/lib/modules/plan-grants";
import { isPrimaryUse, PRIMARY_USES } from "@/lib/onboarding/activation";
import { isStoreManaged } from "@/lib/store-billing/state";
import { badRequest } from "../errors";
import { orgAdminProcedure, protectedProcedure, router } from "../trpc";

/** Onboarding videre fra plan-trinnet til virksomhedsoplysninger. */
async function markSubscriptionStepDone(db: typeof Db, userId: string) {
  await db
    .insert(onboardingProgress)
    .values({
      userId,
      currentStep: "company_info",
      completedSteps: ["subscription"],
    })
    .onConflictDoUpdate({
      target: onboardingProgress.userId,
      set: {
        currentStep: "company_info",
        completedSteps: ["subscription"],
        updatedAt: new Date(),
      },
    });
}

export const onboardingRouter = router({
  // Get onboarding progress
  getProgress: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.user.id;

    const progress = await ctx.db.query.onboardingProgress.findFirst({
      where: eq(onboardingProgress.userId, userId),
    });

    // Return null instead of undefined (React Query requirement)
    return progress ?? null;
  }),

  // Aktiveringsstatus til dashboardets trial-checklist — fire billige
  // eksistens-tjek (limit 1) i stedet for at hente hele lister.
  activationStatus: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.user.id;

    const [client, timeEntry, pkg, invoice, progress, teammate] =
      await Promise.all([
        ctx.db.query.clients.findFirst({
          where: ctx.orgId
            ? eq(clients.organizationId, ctx.orgId)
            : eq(clients.userId, userId),
          columns: { id: true },
        }),
        ctx.db.query.timeEntries.findFirst({
          where: ctx.orgId
            ? eq(timeEntries.organizationId, ctx.orgId)
            : eq(timeEntries.userId, userId),
          columns: { id: true },
        }),
        ctx.db.query.prepaidPackages.findFirst({
          where: ctx.orgId
            ? eq(prepaidPackages.organizationId, ctx.orgId)
            : eq(prepaidPackages.userId, userId),
          columns: { id: true },
        }),
        ctx.db.query.invoices.findFirst({
          where: ctx.orgId
            ? eq(invoices.organizationId, ctx.orgId)
            : eq(invoices.userId, userId),
          columns: { id: true },
        }),
        ctx.db.query.onboardingProgress.findFirst({
          where: eq(onboardingProgress.userId, userId),
          columns: { primaryUse: true },
        }),
        ctx.orgId
          ? ctx.db.query.members.findFirst({
              where: and(
                eq(members.organizationId, ctx.orgId),
                ne(members.userId, userId),
              ),
              columns: { id: true },
            })
          : Promise.resolve(undefined),
      ]);

    return {
      hasClient: !!client,
      hasTimeEntry: !!timeEntry,
      hasKlippekort: !!pkg,
      hasInvoice: !!invoice,
      hasTeammates: !!teammate,
      // Velkomstspørgsmålet (#91) — styrer Hjems "næste skridt"
      primaryUse: isPrimaryUse(progress?.primaryUse)
        ? progress.primaryUse
        : null,
    };
  }),

  // Velkomstspørgsmålet på Hjem (#91): valgfrit, gemmes kun til at tilpasse
  // Hjem. null = fortryd svaret.
  setPrimaryUse: protectedProcedure
    .input(z.object({ primaryUse: z.enum(PRIMARY_USES).nullable() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .insert(onboardingProgress)
        .values({
          userId: ctx.session.user.id,
          primaryUse: input.primaryUse,
          completedSteps: [],
        })
        .onConflictDoUpdate({
          target: onboardingProgress.userId,
          set: { primaryUse: input.primaryUse, updatedAt: new Date() },
        });
      return { primaryUse: input.primaryUse };
    }),

  // Hvilke planer onboardingens plan-vælger må tilbyde. Privat kan kun
  // prøves når planen kan købes bagefter (Alunta-planerne sat i env).
  planOptions: protectedProcedure.query(() => ({
    privatAvailable: isPrivatPlanConfigured(),
  })),

  // Slår en kampagnekode op, så onboardingen kan vise hvad den giver.
  campaignCode: protectedProcedure
    .input(z.object({ code: z.string().max(50) }))
    .query(({ input }) => {
      const campaign = resolveCampaignCode(input.code);
      if (!campaign) return { valid: false as const };
      return {
        valid: true as const,
        code: campaign.code,
        trialDays: campaign.trialDays,
        discountPercent: campaign.discountPercent,
        discountMonths: campaign.discountMonths,
        description: describeCampaign(campaign),
      };
    }),

  // Create or update subscription selection
  createSubscription: protectedProcedure
    .input(
      z.object({
        billingCycle: z.enum(["monthly", "yearly"]),
        planTier: z
          .enum(["privat", "solo", "team", "business"])
          .default("solo"),
        seatCount: z.number().int().positive().optional(),
        isEffihubMigrant: z.boolean().default(false),
        promoCode: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      // Guard (#172): a plain org member must never create a per-user
      // subscription — the org's subscription covers them. The member UI
      // skips this step entirely; this is defence in depth for direct calls.
      if (ctx.orgId) {
        const membership = await ctx.db.query.members.findFirst({
          where: and(
            eq(members.userId, userId),
            eq(members.organizationId, ctx.orgId),
          ),
          columns: { role: true },
        });
        const canManage =
          membership?.role === "owner" || membership?.role === "admin";
        if (!canManage) {
          const orgSubscription = await ctx.db.query.subscriptions.findFirst({
            where: eq(subscriptions.organizationId, ctx.orgId),
          });
          if (orgSubscription) {
            return orgSubscription;
          }
          throw badRequest(
            await tr("serverErrors", "onboarding.ownerManagesPlan"),
          );
        }
      }

      // TimeWren: ingen Alunta-betaling (lib/billing/brand-billing.ts), så
      // kontoen starter på Gratis uden prøveperiode i stedet for en prøve, der
      // ender i TimeTracks checkout; en betalt plan (med Stripes egen prøve)
      // vælges bagefter med Stripe. En eksisterende række røres ikke.
      if (!(await isCheckoutAvailableForUser(ctx.db, userId))) {
        const existing = await ctx.db.query.subscriptions.findFirst({
          where: eq(subscriptions.userId, userId),
        });
        const subscription =
          existing ??
          (
            await ctx.db
              .insert(subscriptions)
              .values({
                userId,
                organizationId: ctx.orgId,
                billingCycle: input.billingCycle,
                ...FREE_TIER_SUBSCRIPTION_FIELDS,
                trialEndsAt: new Date(),
                promoMonthsFree: 0,
              })
              .returning()
          )[0];
        await markSubscriptionStepDone(ctx.db, userId);
        return subscription;
      }

      // Grant seats from trial start so team customers can invite and
      // evaluate with their team before adding payment. The Alunta webhook
      // re-confirms planTier/seatCount once payment is added. maxSeats tracks
      // the purchased seat count (not the tier ceiling).
      // Privat må kun startes som trial når den kan købes bagefter —
      // ellers står brugeren med en plan uden betalingsvej.
      if (input.planTier === "privat" && !isPrivatPlanConfigured()) {
        throw badRequest(
          await tr("serverErrors", "onboarding.privatePlanUnavailable"),
        );
      }
      const planTier = input.planTier;
      const maxSeats = clampSeats(
        planTier,
        input.seatCount ?? includedSeatsForTier(planTier),
      );

      // Check if subscription already exists
      const existingSubscription = await ctx.db.query.subscriptions.findFirst({
        where: eq(subscriptions.userId, userId),
      });
      // Betalt i appen: plan, pladser og periode styres af butikken, så en
      // gentaget onboarding må ikke skrive en anden tier eller prøveperiode.
      if (existingSubscription && isStoreManaged(existingSubscription)) {
        return existingSubscription;
      }

      // En kampagnekode gælder kun en prøve, der endnu ikke er betalt for —
      // ellers kunne en betalende kunde forlænge sin prøve ved at gentage
      // onboardingen.
      const campaign =
        !existingSubscription ||
        (existingSubscription.status === "trialing" &&
          !existingSubscription.aluntaSubscriptionId)
          ? resolveCampaignCode(input.promoCode)
          : null;

      // Calculate trial end date (30 days, or the campaign's trial). En
      // kampagneprøve regnes fra rækkens oprettelse, så den ikke kan
      // forlænges ved at gentage onboardingen.
      const trialDays = campaign?.trialDays ?? 30;
      const trialEndsAt = new Date(
        campaign && existingSubscription
          ? existingSubscription.createdAt
          : Date.now(),
      );
      trialEndsAt.setDate(trialEndsAt.getDate() + trialDays);

      // Founding member offer is closed to new users. Existing founding
      // members keep their tier; new users always pay full price.
      const isAlreadyFoundingMember =
        existingSubscription?.foundingTier === "founding_member";

      // Preserve bonus free months for existing founding members
      if (isAlreadyFoundingMember) {
        trialEndsAt.setMonth(
          trialEndsAt.getMonth() + FOUNDING_MEMBER.freeMonths,
        );
      }

      // Tier fields for DB. Founding-rabatten vinder over en kampagnerabat.
      const tierFields = isAlreadyFoundingMember
        ? {
            foundingTier: "founding_member" as const,
            discountPercent: FOUNDING_MEMBER.discountPercent,
            discountExpiresAt: null,
          }
        : campaign && campaign.discountPercent > 0
          ? {
              discountPercent: campaign.discountPercent,
              discountExpiresAt: campaignDiscountExpiresAt(
                campaign,
                trialEndsAt,
              ),
            }
          : existingSubscription?.promoCode &&
              findCampaignCode(existingSubscription.promoCode)
            ? // Koden er fjernet igen: fjern også kampagnerabatten.
              { discountPercent: 0, discountExpiresAt: null }
            : {};
      // Gem den normaliserede kode, når den er gyldig; ellers den rå
      // (fx Effihub-koder, som ikke er kampagner).
      const promoCode = campaign?.code ?? (input.promoCode || null);

      if (existingSubscription) {
        // Update existing subscription
        const [updated] = await ctx.db
          .update(subscriptions)
          .set({
            billingCycle: input.billingCycle,
            planTier,
            maxSeats,
            seatCount: maxSeats,
            // Link to the active org so seat checks resolve for all admins,
            // not just the owner (checkSeatAvailability prefers the org sub).
            ...(ctx.orgId ? { organizationId: ctx.orgId } : {}),
            trialEndsAt,
            promoCode,
            promoMonthsFree: 0,
            ...tierFields,
            updatedAt: new Date(),
          })
          .where(eq(subscriptions.userId, userId))
          .returning();

        // Virksomhed-planen giver enterprise-modulet (best-effort).
        await grantEnterpriseForTierSafe(
          ctx.db,
          updated?.organizationId ?? ctx.orgId,
          planTier,
          "onboarding.createSubscription",
        );

        return updated;
      }

      // Create new subscription
      const [newSubscription] = await ctx.db
        .insert(subscriptions)
        .values({
          userId,
          organizationId: ctx.orgId,
          billingCycle: input.billingCycle,
          planTier,
          maxSeats,
          seatCount: maxSeats,
          status: "trialing",
          isTrial: true,
          trialEndsAt,
          promoCode,
          promoMonthsFree: 0,
          ...tierFields,
        })
        .returning();

      // Virksomhed-planen giver enterprise-modulet (best-effort).
      await grantEnterpriseForTierSafe(
        ctx.db,
        ctx.orgId,
        planTier,
        "onboarding.createSubscription",
      );

      // Update onboarding progress
      await markSubscriptionStepDone(ctx.db, userId);

      return newSubscription;
    }),

  // Save company profile — shared org-level data (CVR/VAT/bank), admin-only
  saveCompanyProfile: orgAdminProcedure
    .input(
      z.object({
        name: z.string().min(2, { error: () => st("zod.companyNameMin2") }),
        cvrNumber: z.string().optional(),
        email: z.string().email({ error: () => st("zod.invalidEmailAddress") }),
        phone: z.string().optional(),
        address: z.string().optional(),
        postalCode: z.string().optional(),
        city: z.string().optional(),
        country: z.string().default("Danmark"),
        bankRegNr: z.string().optional(),
        bankAccountNr: z.string().optional(),
        vatRegistered: z.boolean().default(false),
        vatNumber: z.string().optional(),
        logoUrl: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      // Check if profile already exists
      const profileFilter = ctx.orgId
        ? eq(companyProfiles.organizationId, ctx.orgId)
        : eq(companyProfiles.userId, userId);

      const existingProfile = await ctx.db.query.companyProfiles.findFirst({
        where: profileFilter,
      });

      if (existingProfile) {
        // Update existing profile
        const [updated] = await ctx.db
          .update(companyProfiles)
          .set({
            ...input,
            updatedAt: new Date(),
          })
          .where(profileFilter)
          .returning();

        // Update onboarding progress
        const progress = await ctx.db.query.onboardingProgress.findFirst({
          where: eq(onboardingProgress.userId, userId),
        });

        const completedSteps = progress?.completedSteps || [];
        if (!completedSteps.includes("company_info")) {
          completedSteps.push("company_info");
        }

        await ctx.db
          .update(onboardingProgress)
          .set({
            currentStep: "data_import",
            completedSteps,
            updatedAt: new Date(),
          })
          .where(eq(onboardingProgress.userId, userId));

        return updated;
      }

      // Create new profile
      const [newProfile] = await ctx.db
        .insert(companyProfiles)
        .values({
          userId,
          organizationId: ctx.orgId,
          ...input,
        })
        .returning();

      // Update onboarding progress
      await ctx.db
        .insert(onboardingProgress)
        .values({
          userId,
          currentStep: "data_import",
          completedSteps: ["subscription", "company_info"],
        })
        .onConflictDoUpdate({
          target: onboardingProgress.userId,
          set: {
            currentStep: "data_import",
            completedSteps: ["subscription", "company_info"],
            updatedAt: new Date(),
          },
        });

      return newProfile;
    }),

  // Get company profile
  getCompanyProfile: protectedProcedure.query(async ({ ctx }) => {
    const profile = await ctx.db.query.companyProfiles.findFirst({
      where: ctx.orgId
        ? eq(companyProfiles.organizationId, ctx.orgId)
        : eq(companyProfiles.userId, ctx.session.user.id),
    });

    return profile ?? null;
  }),

  // Update company profile (from settings — no onboarding side effects)
  updateCompanyProfile: orgAdminProcedure
    .input(
      z.object({
        name: z.string().min(2, { error: () => st("zod.companyNameMin2") }),
        cvrNumber: z.string().optional(),
        email: z.string().email({ error: () => st("zod.invalidEmailAddress") }),
        phone: z.string().optional(),
        address: z.string().optional(),
        postalCode: z.string().optional(),
        city: z.string().optional(),
        country: z.string().default("Danmark"),
        bankRegNr: z.string().optional(),
        bankAccountNr: z.string().optional(),
        vatRegistered: z.boolean().default(false),
        vatNumber: z.string().optional(),
        logoUrl: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const profileFilter = ctx.orgId
        ? eq(companyProfiles.organizationId, ctx.orgId)
        : eq(companyProfiles.userId, userId);

      const existingProfile = await ctx.db.query.companyProfiles.findFirst({
        where: profileFilter,
      });

      if (existingProfile) {
        const [updated] = await ctx.db
          .update(companyProfiles)
          .set({
            ...input,
            updatedAt: new Date(),
          })
          .where(profileFilter)
          .returning();
        return updated;
      }

      const [newProfile] = await ctx.db
        .insert(companyProfiles)
        .values({
          userId,
          organizationId: ctx.orgId,
          ...input,
        })
        .returning();
      return newProfile;
    }),

  // Get subscription
  getSubscription: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.user.id;

    const subscription = await ctx.db.query.subscriptions.findFirst({
      where: eq(subscriptions.userId, userId),
    });

    // Return null instead of undefined (React Query requirement)
    return subscription ?? null;
  }),

  // Demo-eksempeldata (#86): seed en lille freelancer-verden så dashboardet
  // viser værdi fra minut ét. Guard (kun tom konto) + insert sker atomisk
  // i modulet bag en advisory lock — dobbeltklik/retry kan ikke seede dobbelt.
  seedDemoData: protectedProcedure.mutation(async ({ ctx }) => {
    const scope = {
      userId: ctx.session.user.id,
      orgId: ctx.orgId ?? undefined,
    };
    const seeded = await seedDemoData(ctx.db, scope);
    return { seeded };
  }),

  // Ryd demo-data: fjerner KUN rene demo-rækker; demo-klienter der er
  // taget i brug (faktura, egne poster m.m.) bevares som almindelige
  // klienter. Transaktion + savepoints i modulet.
  clearDemoData: protectedProcedure.mutation(async ({ ctx }) => {
    const scope = {
      userId: ctx.session.user.id,
      orgId: ctx.orgId ?? undefined,
    };
    return clearDemoData(ctx.db, scope);
  }),

  // Har kontoen demo-data? (styrer "Ryd demo-data"-banneret)
  demoStatus: protectedProcedure.query(async ({ ctx }) => {
    const scope = {
      userId: ctx.session.user.id,
      orgId: ctx.orgId ?? undefined,
    };
    return { hasDemoData: await hasDemoData(ctx.db, scope) };
  }),

  // Update import info after Effihub import
  updateImportInfo: protectedProcedure
    .input(
      z.object({
        importSource: z.enum([
          "effihub",
          "clockify",
          "toggl",
          "harvest",
          "trello",
          "todoist",
          "demo",
          "manual",
        ]),
        clientsImported: z.number().default(0),
        projectsImported: z.number().default(0),
        timeEntriesImported: z.number().default(0),
        prepaidPackagesImported: z.number().default(0),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      // Get current progress
      const progress = await ctx.db.query.onboardingProgress.findFirst({
        where: eq(onboardingProgress.userId, userId),
      });

      const completedSteps = progress?.completedSteps || [];
      if (!completedSteps.includes("data_import")) {
        completedSteps.push("data_import");
      }

      // Update onboarding progress
      await ctx.db
        .insert(onboardingProgress)
        .values({
          userId,
          currentStep:
            input.importSource !== "manual" ? "complete" : "first_client",
          completedSteps,
          importSource: input.importSource,
          importCompletedAt: new Date(),
          clientsImported: input.clientsImported,
          projectsImported: input.projectsImported,
          timeEntriesImported: input.timeEntriesImported,
          prepaidPackagesImported: input.prepaidPackagesImported,
        })
        .onConflictDoUpdate({
          target: onboardingProgress.userId,
          set: {
            currentStep:
              input.importSource !== "manual" ? "complete" : "first_client",
            completedSteps,
            importSource: input.importSource,
            importCompletedAt: new Date(),
            clientsImported: input.clientsImported,
            projectsImported: input.projectsImported,
            timeEntriesImported: input.timeEntriesImported,
            prepaidPackagesImported: input.prepaidPackagesImported,
            updatedAt: new Date(),
          },
        });

      return { success: true };
    }),

  // Update current step (for progress persistence across reloads)
  updateStep: protectedProcedure
    .input(
      z.object({
        step: z.enum([
          "subscription",
          "company_info",
          "data_import",
          "first_client",
          "ai_setup",
          "payment",
          "complete",
        ]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      await ctx.db
        .insert(onboardingProgress)
        .values({
          userId,
          currentStep: input.step,
          completedSteps: [],
        })
        .onConflictDoUpdate({
          target: onboardingProgress.userId,
          set: {
            currentStep: input.step,
            updatedAt: new Date(),
          },
        });

      return { success: true };
    }),

  // Restart onboarding (reset progress, re-show modal)
  restart: protectedProcedure.mutation(async ({ ctx }) => {
    const userId = ctx.session.user.id;

    // Reset user flag so the modal shows again
    await ctx.db
      .update(users)
      .set({
        onboardingCompleted: false,
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId));

    // Delete onboarding progress so it starts fresh
    await ctx.db
      .delete(onboardingProgress)
      .where(eq(onboardingProgress.userId, userId));

    return { success: true };
  }),

  // Complete onboarding
  complete: protectedProcedure.mutation(async ({ ctx }) => {
    const userId = ctx.session.user.id;

    const startTime = await ctx.db.query.onboardingProgress.findFirst({
      where: eq(onboardingProgress.userId, userId),
    });

    const timeToComplete = startTime?.createdAt
      ? Math.floor((Date.now() - startTime.createdAt.getTime()) / 1000 / 60)
      : 0;

    // Update onboarding progress to completed
    await ctx.db
      .update(onboardingProgress)
      .set({
        isCompleted: true,
        completedAt: new Date(),
        currentStep: "complete",
        timeToCompleteMinutes: timeToComplete,
        updatedAt: new Date(),
      })
      .where(eq(onboardingProgress.userId, userId));

    // Mark user onboarding as completed
    await ctx.db
      .update(users)
      .set({
        onboardingCompleted: true,
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId));

    return { success: true, timeToCompleteMinutes: timeToComplete };
  }),
});
