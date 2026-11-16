import * as Sentry from "@sentry/nextjs";
import { initTRPC, TRPCError } from "@trpc/server";
import { and, desc, eq, isNull, or, sql } from "drizzle-orm";
import superjson from "superjson";
import {
  localeFromHeaders,
  runWithBrand,
  runWithLocale,
  textBrandFromHeaders,
  tr,
} from "@/i18n/server-text";
import type { Session } from "../auth";
import { resolveActiveOrgId, resolveRequestedOrgId } from "../auth/active-org";
import { orglessForbiddenMessage } from "../auth/orgless";
import { isBillingEnabled } from "../billing/billing-enabled";
import {
  freeMemberLockedMessage,
  isFreeSubscription,
  isFreeTierMemberLocked,
} from "../billing/plan-limits";
import {
  clientTooOldCause,
  enforceClientVersion,
} from "../client-version/guard";
import type { db as dbType } from "../db";
import { subscriptions, users } from "../db/schema";
import { IntegrationAuthError } from "../integrations/base";
import {
  accessSatisfies,
  type PermissionModuleKey,
  resolveModuleAccess,
} from "../permissions/role-access";
import { domainsForMutationPath } from "../query/invalidate-domains";
import { sanitizeTabId, TAB_ID_HEADER } from "../query/tab-id";
import { publishDataChanged } from "../realtime";
import { appCodeOf } from "./app-code";
import { assertMinRole, getOrgRole } from "./middleware/org-role";
import { memoize, type RequestMemo } from "./request-memo";

const t = initTRPC
  .context<{
    session: Session | null;
    db: typeof dbType;
    headers: Headers | null;
    /**
     * Eksplicit org for dette kald — sættes KUN af /api/trpc-ruten for
     * cookie-baserede web-kald (offline-køens afspilning). Læses aldrig fra
     * headers her, så API-nøgle-, MCP- og server-callers ikke kan skifte org.
     */
    orgOverride?: string | null;
    /**
     * Deles af alle procedurer i samme HTTP-request (se request-memo.ts).
     * Sættes af /api/trpc og REST-API'et; uden den slås alt op pr. kald.
     */
    memo?: RequestMemo;
  }>()
  .create({
    transformer: superjson,
    errorFormatter({ shape, error, ctx }) {
      // Integration auth errors (expired tokens) are user-facing, not server bugs.
      // Override the INTERNAL_SERVER_ERROR code with BAD_REQUEST and skip Sentry.
      // Match by name as well as instanceof: with Turbopack the class can be
      // duplicated across server chunks, so a cross-chunk instanceof check
      // silently fails and these expected errors leak into Sentry as errors.
      const cause = error.cause;
      const isIntegrationAuthError =
        cause instanceof IntegrationAuthError ||
        (cause instanceof Error && cause.name === "IntegrationAuthError");
      if (isIntegrationAuthError) {
        return {
          ...shape,
          data: { ...shape.data, code: "BAD_REQUEST" },
          message: cause instanceof Error ? cause.message : shape.message,
        };
      }

      // For gammel klient: stabil appCode, så web/extension/mobil kan vise
      // "opdatér" uden at matche på teksten.
      const tooOld = clientTooOldCause(error);
      if (tooOld) {
        return {
          ...shape,
          data: {
            ...shape.data,
            appCode: tooOld.appCode,
            minimumVersion: tooOld.minimum,
          },
        };
      }

      const appCode = appCodeOf(error);
      if (appCode) {
        return { ...shape, data: { ...shape.data, appCode } };
      }

      // Report unexpected server errors to Sentry (not expected client errors
      // like BAD_REQUEST/UNAUTHORIZED/TOO_MANY_REQUESTS).
      if (error.code === "INTERNAL_SERVER_ERROR" || error.code === "TIMEOUT") {
        Sentry.captureException(error.cause ?? error, {
          tags: { source: "trpc" },
          user: ctx?.session?.user ? { id: ctx.session.user.id } : undefined,
        });
      }
      return shape;
    },
  });

// Procedurer en bruger uden organisation stadig må kalde: egen profil og
// konto, rolle/abonnement som app-skallen skal bruge for at kunne vise sig,
// og oprettelse af en ny organisation. Ingen af dem læser organisationsdata.
const ORGLESS_ALLOWED_PATHS: ReadonlySet<string> = new Set([
  "user.getProfile",
  "user.getTheme",
  "user.updateTheme",
  "user.getDismissedBanners",
  "user.dismissBanner",
  "user.deleteAccount",
  "user.getAccountDeletionInfo",
  "user.getEmailPreferences",
  "user.updateEmailPreferences",
  "user.getFeatureFlags",
  "user.getSystemStatus",
  "rolePermissions.getMyRole",
  "rolePermissions.getMyPermissions",
  "subscription.getDetails",
  "enterprise.organization.create",
]);

function isOrglessAllowedPath(path: string): boolean {
  // Platform-admin/support tjekker global rolle bagefter og er ikke org-scopet.
  return ORGLESS_ALLOWED_PATHS.has(path) || path.startsWith("admin.");
}

const isAuthed = t.middleware(async ({ next, ctx, path, type }) => {
  if (!ctx.session?.user) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  Sentry.setUser({ id: ctx.session.user.id });

  // Resolve active org + modules so guardedRouter can check them.
  // Offline-køen afspiller i den org, posten blev lagt i køen i;
  // er brugeren ikke længere medlem, afvises kaldet frem for at ramme en
  // anden org.
  const requestedOrgId = ctx.orgOverride;
  const userId = ctx.session.user.id;
  let orgId: string | null;
  if (requestedOrgId) {
    orgId = await memoize(ctx.memo, `org:${userId}:${requestedOrgId}`, () =>
      resolveRequestedOrgId({ db: ctx.db, userId, orgId: requestedOrgId }),
    );
    if (!orgId) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: await tr("serverErrors", "core.orgMembershipEnded"),
      });
    }
  } else {
    const session = ctx.session as unknown as Record<string, unknown>;
    orgId = await memoize(ctx.memo, `org:${userId}`, () =>
      resolveActiveOrgId({ db: ctx.db, userId, session }),
    );
  }

  // Uden medlemskab ingen organisationsdata. Routerne falder ellers tilbage
  // til `userId`, og så kan et fjernet medlem stadig læse de kunder, poster
  // og fakturaer, det selv oprettede i den gamle organisation.
  if (!orgId && !isOrglessAllowedPath(path)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: orglessForbiddenMessage(),
    });
  }

  const { resolveModules, makePermissiveModules } = await import(
    "./routers/enterprise/middleware"
  );
  // Defensive fallback: users without a resolvable org (e.g. orphaned from
  // a missed backfill) get a permissive FREELANCE_BUNDLE modules context so
  // they aren't locked out of core features. They'll still fail any
  // org-scoped query because orgId is null, but at least guarded routers
  // won't 403 them before the real authorization runs.
  const activeOrgId = orgId;
  const modules = activeOrgId
    ? await memoize(ctx.memo, `modules:${activeOrgId}`, () =>
        resolveModules(ctx.db, activeOrgId),
      )
    : makePermissiveModules();

  const result = await next({
    ctx: {
      session: ctx.session,
      db: ctx.db,
      orgId,
      modules,
    },
  });

  // Krydsenheds-friskhed: en vellykket skrivning af tid/klippekort/fakturaer
  // — fra web, mobil, API eller MCP (alle går gennem denne middleware) —
  // signaleres til brugerens andre enheder og faner over SSE. Fire-and-forget:
  // svaret må aldrig vente på eller fejle pga. Valkey.
  if (type === "mutation" && result.ok) {
    const domains = domainsForMutationPath(path);
    if (domains) {
      void publishDataChanged(
        ctx.session.user.id,
        orgId,
        domains,
        sanitizeTabId(ctx.headers?.get(TAB_ID_HEADER)),
      );
    }
  }
  return result;
});

// Role types for the admin system
export type UserRole = "user" | "supporter" | "admin";

// Global rolle fra databasen (aldrig fra sessionen, der kan være forældet).
// Supporter-, admin- og abonnementsvagten deler opslaget inden for requesten.
function getUserRole(
  db: typeof dbType,
  memo: RequestMemo | undefined,
  userId: string,
): Promise<string | null | undefined> {
  return memoize(memo, `userRole:${userId}`, async () => {
    const user = await db.query.users.findFirst({
      where: eq(users.id, userId),
      columns: { role: true },
    });
    return user?.role;
  });
}

// Supporter middleware - checks for supporter or admin role
const isSupporter = t.middleware(async ({ next, ctx }) => {
  if (!ctx.session?.user) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }

  // Always check role from database to avoid stale session data
  const role = (await getUserRole(ctx.db, ctx.memo, ctx.session.user.id)) as
    | UserRole
    | undefined;
  if (!role || (role !== "supporter" && role !== "admin")) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: await tr("serverErrors", "core.noAccessToFeature"),
    });
  }

  // Spread preserves upstream ctx (modules, orgId from isAuthed) while
  // narrowing session to non-null and adding userRole.
  return next({
    ctx: {
      ...ctx,
      session: ctx.session,
      userRole: role,
    },
  });
});

// Admin middleware - checks for admin role only
const isAdmin = t.middleware(async ({ next, ctx }) => {
  if (!ctx.session?.user) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }

  // Always check admin status from database to avoid stale session data
  if ((await getUserRole(ctx.db, ctx.memo, ctx.session.user.id)) !== "admin") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: await tr("serverErrors", "core.adminsOnly"),
    });
  }

  // Spread preserves upstream ctx (modules, orgId from isAuthed) while
  // narrowing session to non-null and adding userRole.
  return next({
    ctx: {
      ...ctx,
      session: ctx.session,
      userRole: "admin" as const,
    },
  });
});

// Subscription guard — requires active, free (Gratis-tier), trialing (not
// expired), or past_due within 7-day grace. Preserves upstream ctx (modules,
// orgId) so guardedRouter sees the modules context populated by isAuthed, and
// adds `planTier` (the effective tier; null for admins = no plan limits) so
// procedures can enforce plan limits without a second subscription lookup.
const hasActiveSubscription = t.middleware(async ({ next, ctx }) => {
  if (!ctx.session?.user) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  const session = ctx.session;
  const orgId = (ctx as { orgId?: string | null }).orgId ?? null;
  // Samme svar for alle procedurer i requesten — en batch skal ikke slå
  // rolle, abonnement og pladslås op én gang pr. procedure.
  const planTier = await memoize(
    ctx.memo,
    `planTier:${session.user.id}:${orgId ?? ""}`,
    () => resolvePlanTier({ db: ctx.db, memo: ctx.memo, session, orgId }),
  );
  return next({ ctx: { ...ctx, session, planTier } });
});

/** Effektiv tier for kaldet, eller TRPCError hvis abonnementet ikke rækker. */
export async function resolvePlanTier(ctx: {
  db: typeof dbType;
  memo?: RequestMemo;
  session: { user: { id: string } };
  orgId: string | null;
}): Promise<string | null> {
  // Uden betalingsudbyder (selvhost) findes der ingen planer: alt er åbent
  if (!isBillingEnabled()) return null;
  // Admins bypass subscription check
  if ((await getUserRole(ctx.db, ctx.memo, ctx.session.user.id)) === "admin") {
    return null;
  }

  const orgId = ctx.orgId;
  // An org can hold several subscription rows (each member's onboarding /
  // checkout inserts one). Prefer an active/trialing row, then the newest —
  // mirrors resolveActiveSubscription in getDetails so the guard, the member
  // lock and the displayed tier all read the SAME row. A stray canceled/free
  // row must not win over the org's live paid sub and wrongly lock members.
  const subPreference = [
    desc(
      sql`case when ${subscriptions.status} in ('active','trialing') then 1 else 0 end`,
    ),
    desc(
      sql`case when ${subscriptions.aluntaSubscriptionId} is not null or ${subscriptions.storeProvider} is not null then 1 else 0 end`,
    ),
    desc(subscriptions.createdAt),
  ];
  let sub: typeof subscriptions.$inferSelect | undefined;
  if (orgId) {
    sub = await ctx.db.query.subscriptions.findFirst({
      where: eq(subscriptions.organizationId, orgId),
      orderBy: subPreference,
    });
  }
  if (!sub) {
    // Org-rækken manglede (eller der er ingen org): fald tilbage til brugerens
    // personlige/legacy række, men aldrig en række der hører til en ANDEN
    // organisation — ellers kunne et medlem uden egen org-subscription låses
    // op eller låses ned af en tidligere (forladt) organisations plan.
    sub = await ctx.db.query.subscriptions.findFirst({
      where: and(
        eq(subscriptions.userId, ctx.session.user.id),
        orgId
          ? or(
              isNull(subscriptions.organizationId),
              eq(subscriptions.organizationId, orgId),
            )
          : isNull(subscriptions.organizationId),
      ),
      orderBy: subPreference,
    });
  }

  if (!sub) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: await tr("serverErrors", "core.subscriptionRequired"),
    });
  }

  const now = Date.now();
  const isActive = sub.status === "active";
  // Gratis — inkl. opsagte betalere og tier "free"; samme test som resten af
  // billing-koden (getDetails, seat-tjek), så guard, lås og vist tier er ens.
  const isFree = isFreeSubscription(sub);
  const isTrialing =
    sub.status === "trialing" && sub.trialEndsAt.getTime() > now;
  const isPastDueGrace =
    sub.status === "past_due" &&
    (!sub.pastDueSince ||
      now - sub.pastDueSince.getTime() <= 7 * 24 * 60 * 60 * 1000);

  if (!isActive && !isFree && !isTrialing && !isPastDueGrace) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: await tr("serverErrors", "core.subscriptionExpired"),
    });
  }

  // Gratis har plads til FREE_MAX_SEATS brugere. Har orgen flere medlemmer
  // (udløbet team-prøve eller opsagt Team), beholder ejeren + de næste i
  // rækken adgang; resten er låst til ejeren opgraderer. Ingen data slettes.
  if (
    isFree &&
    orgId &&
    (await isFreeTierMemberLocked(ctx.db, orgId, ctx.session.user.id))
  ) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: freeMemberLockedMessage(),
    });
  }

  return isFree ? "free" : (sub.planTier ?? "solo");
}

// Org role guard — requires admin or owner role within the active organization.
// Solo freelancers (who are always "owner") pass automatically.
const requireOrgAdmin = t.middleware(async ({ next, ctx }) => {
  if (!ctx.session?.user) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  const orgId = (ctx as { orgId?: string | null }).orgId;
  if (orgId) {
    const userId = ctx.session.user.id;
    const role = await memoize(ctx.memo, `orgRole:${userId}:${orgId}`, () =>
      getOrgRole(ctx.db, userId, orgId),
    );
    assertMinRole(role, "admin");
  }
  return next({ ctx: { ...ctx, session: ctx.session } });
});

// Per-org, per-role module access guard (rolePermissions system). Owners get
// full access; other roles depend on the org's configured access level for the
// module. Solo users (no org) always pass. `required` is "read" or "write".
function requireModuleAccess(
  moduleKey: PermissionModuleKey,
  required: "read" | "write",
) {
  return t.middleware(async ({ next, ctx }) => {
    if (!ctx.session?.user) {
      throw new TRPCError({ code: "UNAUTHORIZED" });
    }
    const orgId = (ctx as { orgId?: string | null }).orgId;
    if (orgId) {
      const userId = ctx.session.user.id;
      const level = await memoize(
        ctx.memo,
        `moduleAccess:${userId}:${orgId}:${moduleKey}`,
        () => resolveModuleAccess(ctx.db, userId, orgId, moduleKey),
      );
      if (!accessSatisfies(level, required)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: await tr("serverErrors", "core.roleNoAccess"),
        });
      }
    }
    return next({ ctx: { ...ctx, session: ctx.session } });
  });
}

// Klientversion — hvem kalder (x-timetrack-client), Sentry-tags, og
// afvisning af beskyttede timer-/tidsskrivninger fra for gamle klienter.
// Ligger på både public- og protectedProcedure: extension.* er public
// (token i input), og REST v1/MCP kalder routeren via createCaller med
// requestens headers.
const withClientVersion = t.middleware(
  async ({ next, ctx, path, type, getRawInput }) => {
    try {
      const { client } = enforceClientVersion({
        headers: ctx.headers,
        path,
        type,
      });
      Sentry.setTag("client.kind", client.kind ?? "ukendt");
      Sentry.setTag("client.version", client.version ?? "ukendt");
    } catch (err) {
      const tooOld = clientTooOldCause(err);
      if (tooOld) {
        Sentry.setTag("client.kind", tooOld.kind);
        Sentry.setTag("client.version", tooOld.version ?? "ukendt");
        const { recordClientTooOld } = await import("../client-version/record");
        await recordClientTooOld({
          db: ctx.db,
          headers: ctx.headers,
          path,
          error: tooOld,
          userId: ctx.session?.user?.id,
          getRawInput,
        });
      }
      throw err;
    }
    return next();
  },
);

// Sætter kaldets sprog (cookie/Accept-Language), så fejlbeskeder og zod-tekster
// oversættes. Uden headers (tests, cron, createCaller uden kontekst) er det dansk.
// Brandet i teksterne følger hosten (TimeWren på timewren.com).
const withLocale = t.middleware(({ ctx, next }) =>
  runWithLocale(localeFromHeaders(ctx.headers), () =>
    runWithBrand(textBrandFromHeaders(ctx.headers), () => next()),
  ),
);

// rateLimiter.checkOrThrow kaster RateLimitError, som tRPC ellers gør til
// INTERNAL_SERVER_ERROR: brugeren får 500, og en forventet brugerfejl lander
// i Sentry (TIMETRACK-28). Her bliver den til 429 med beskeden bevaret.
// Navnet tjekkes frem for instanceof: Turbopack kan duplikere klassen.
const withRateLimitStatus = t.middleware(async ({ next }) => {
  const result = await next();
  if (!result.ok) {
    const cause = result.error.cause;
    if (cause instanceof Error && cause.name === "RateLimitError") {
      throw new TRPCError({
        code: "TOO_MANY_REQUESTS",
        message: cause.message,
        cause,
      });
    }
  }
  return result;
});

export const router = t.router;
export const mergeRouters = t.mergeRouters;
export const publicProcedure = t.procedure
  .use(withRateLimitStatus)
  .use(withLocale)
  .use(withClientVersion);
export const protectedProcedure = t.procedure
  .use(withRateLimitStatus)
  .use(withLocale)
  .use(withClientVersion)
  .use(isAuthed);

// All non-public procedure bases chain on protectedProcedure so isAuthed
// always runs first, populating ctx.modules and ctx.orgId. Downstream
// middlewares must forward ctx via spread so guardedRouter can read modules.
export const subscribedProcedure = protectedProcedure.use(
  hasActiveSubscription,
);
export const orgAdminProcedure = protectedProcedure.use(requireOrgAdmin);
// Destructive org-data operations (permanent delete, archiving shared business
// entities) require BOTH an active subscription AND org-admin/owner role, so a
// plain team member can't remove the org's projects, klippekort, etc. Solo
// freelancers are always "owner", so they're unaffected.
export const subscribedOrgAdminProcedure =
  subscribedProcedure.use(requireOrgAdmin);
// Module-scoped procedures (rolePermissions enforcement). Write ops that
// require an active subscription chain on subscribedProcedure; module access is
// checked on top. Use moduleWriteProcedure(key) / moduleReadProcedure(key) in
// routers, e.g. moduleWriteProcedure("invoices").
export const moduleWriteProcedure = (moduleKey: PermissionModuleKey) =>
  subscribedProcedure.use(requireModuleAccess(moduleKey, "write"));
export const moduleReadProcedure = (moduleKey: PermissionModuleKey) =>
  protectedProcedure.use(requireModuleAccess(moduleKey, "read"));
// Module reads that also require an active subscription (premium reads).
export const subscribedModuleReadProcedure = (moduleKey: PermissionModuleKey) =>
  subscribedProcedure.use(requireModuleAccess(moduleKey, "read"));
// Module writes without the subscription guard, for writes that were open to
// unsubscribed users before role access was enforced on them.
export const moduleWriteNoSubProcedure = (moduleKey: PermissionModuleKey) =>
  protectedProcedure.use(requireModuleAccess(moduleKey, "write"));
export const supporterProcedure = protectedProcedure.use(isSupporter);
export const adminProcedure = protectedProcedure.use(isAdmin);
