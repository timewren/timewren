import { type inferRouterInputs, TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { tr } from "@/i18n/server-text";
import { withoutOrgOverride } from "@/lib/auth/org-header";
import type { db as dbType } from "@/lib/db";
import { extensionTokens, members, users } from "@/lib/db/schema";
import { activeTokenWhere, enforceExtensionWriteLimit } from "../extension";
import { tokenProcedure } from "./bearer-token";
import type { webRouterShape } from "./web-router-shape";

/**
 * Token-procedurer til desktop, udvidelse og mobil (`extension.<område>.*`).
 *
 * Kaldet autentificeres med extension-tokenet (samme regler som de
 * eksisterende extension-procedurer: ikke tilbagekaldt, ikke udløbet) og
 * kører derefter web's EGNE procedurer via en caller med en syntetisk
 * session — samme mønster som REST v1 og MCP. Dermed gælder præcis de
 * samme grænser som i web: org-medlemskab (isAuthed), moduler
 * (guardedRouter), abonnement og Gratis-medlemslås (subscribedProcedure),
 * rolle og erhvervs-tier (moduleWriteProcedure) og Gratis' kundeloft.
 */

export const deviceAuthInput = z.object({
  /** Kan i stedet sendes som `Authorization: Bearer <token>` (se bearer-token.ts). */
  token: z.string().min(1).optional(),
  /** Org for kaldet. Skal være en org, brugeren er medlem af. */
  organizationId: z.string().min(1).optional(),
});

export type WebCaller = ReturnType<typeof webRouterShape.createCaller>;

export interface DeviceAuth {
  tokenId: string;
  userId: string;
  orgId: string | null;
  user: { id: string; name: string; email: string };
}

type Db = typeof dbType;

/**
 * Org for et token-kald. Modsat de ældre extension-procedurer (som stille
 * falder tilbage til primær-orgen) afvises en eksplicit org, brugeren ikke
 * er medlem af: en kø-afspilning fra desktop må aldrig skrive i en anden
 * org end den, posten blev lavet i. Uden eksplicit org bruges den org,
 * brugeren valgte ved enheds-login (`preferredOrgId`, gemt på tokenet),
 * hvis medlemskabet stadig holder, og ellers primær-orgen.
 */
export async function resolveDeviceOrg(
  database: Db,
  userId: string,
  requestedOrgId: string | null | undefined,
  preferredOrgId?: string | null,
): Promise<string | null> {
  const memberships = await database.query.members.findMany({
    where: eq(members.userId, userId),
    columns: { organizationId: true, role: true, createdAt: true },
  });
  if (requestedOrgId) {
    if (!memberships.some((m) => m.organizationId === requestedOrgId)) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: await tr("serverErrors", "ext.notOrgMemberDot"),
      });
    }
    return requestedOrgId;
  }
  if (
    preferredOrgId &&
    memberships.some((m) => m.organizationId === preferredOrgId)
  ) {
    return preferredOrgId;
  }
  const sorted = [...memberships].sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
  );
  return (
    sorted.find((m) => m.role === "owner")?.organizationId ??
    sorted[0]?.organizationId ??
    null
  );
}

/** De felter vi bruger fra en token-række ved godkendelse. */
type TokenRow = {
  id: string;
  userId: string;
  organizationId: string | null;
  usageCount: number | null;
};

/** Bruger, org og brugsstatistik for en fundet token-række. */
async function resolveDeviceAuth(
  database: Db,
  tokenRecord: TokenRow,
  requestedOrgId: string | null | undefined,
  opts: { recordUse?: boolean },
): Promise<DeviceAuth> {
  const user = await database.query.users.findFirst({
    where: eq(users.id, tokenRecord.userId),
    columns: { id: true, name: true, email: true, banned: true },
  });
  if (!user || user.banned) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: await tr("serverErrors", "ext.invalidToken"),
    });
  }
  const orgId = await resolveDeviceOrg(
    database,
    tokenRecord.userId,
    requestedOrgId,
    tokenRecord.organizationId,
  );

  // Brugsstatistik til enhedslisten i web. Fejl må aldrig vælte kaldet.
  if (opts.recordUse !== false) {
    void database
      .update(extensionTokens)
      .set({
        lastUsedAt: new Date(),
        usageCount: (tokenRecord.usageCount ?? 0) + 1,
      })
      .where(and(eq(extensionTokens.id, tokenRecord.id)))
      .catch(() => {});
  }

  return {
    tokenId: tokenRecord.id,
    userId: user.id,
    orgId,
    user: { id: user.id, name: user.name, email: user.email },
  };
}

/** Slå et aktivt token op og find bruger + org. Kaster UNAUTHORIZED. */
export async function authenticateDeviceToken(
  database: Db,
  token: string,
  requestedOrgId?: string | null,
  /** false = kun gyldighedstjek (SSE-strømmens løbende tjek tæller ikke). */
  opts: { recordUse?: boolean } = {},
): Promise<DeviceAuth> {
  const tokenRecord = await database.query.extensionTokens.findFirst({
    where: activeTokenWhere(token),
    columns: {
      id: true,
      userId: true,
      organizationId: true,
      usageCount: true,
    },
  });
  if (!tokenRecord) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: await tr("serverErrors", "ext.invalidToken"),
    });
  }
  return resolveDeviceAuth(database, tokenRecord, requestedOrgId, opts);
}

/**
 * Godkend en token-række efter sit id i stedet for efter tokenstrengen.
 *
 * Strømmens løbende tjek bruger den: når klienten fornyer sit
 * adgangstoken, roteres tokenstrengen på den samme række, så et check på
 * strengen ville tage strømmen for død. Det er tilbagekaldelsen i web
 * (isRevoked) — og et udløbet adgangstoken — der skal lukke strømmen.
 */
export async function authenticateDeviceTokenById(
  database: Db,
  tokenId: string,
  requestedOrgId?: string | null,
  /** false = kun gyldighedstjek (SSE-strømmens løbende tjek tæller ikke). */
  opts: { recordUse?: boolean } = {},
): Promise<DeviceAuth> {
  const tokenRecord = await database.query.extensionTokens.findFirst({
    where: eq(extensionTokens.id, tokenId),
    columns: {
      id: true,
      userId: true,
      organizationId: true,
      usageCount: true,
      isRevoked: true,
      expiresAt: true,
    },
  });
  const now = new Date();
  if (
    !tokenRecord ||
    tokenRecord.isRevoked ||
    (tokenRecord.expiresAt !== null && tokenRecord.expiresAt <= now)
  ) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: await tr("serverErrors", "ext.invalidToken"),
    });
  }
  return resolveDeviceAuth(database, tokenRecord, requestedOrgId, opts);
}

/**
 * Caller mod web's routere som den token-ejende bruger i den valgte org.
 * appRouter importeres dovent: routers/index.ts importerer denne fil.
 */
export async function createWebCaller(
  database: Db,
  headers: Headers | null,
  auth: DeviceAuth,
): Promise<WebCaller> {
  const { appRouter } = await import("../index");
  return appRouter.createCaller({
    session: {
      user: auth.user,
      activeOrganizationId: auth.orgId ?? undefined,
    } as never,
    db: database,
    // Org-override er kun for web-sessionens offline-kø — aldrig for tokens.
    headers: withoutOrgOverride(new Headers(headers ?? undefined)),
  }) as unknown as WebCaller;
}

export const deviceProcedure = tokenProcedure
  .input(deviceAuthInput)
  .use(async ({ ctx, input, type, next }) => {
    const { token, organizationId } = input as z.infer<typeof deviceAuthInput>;
    if (!token) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: await tr("serverErrors", "ext.invalidToken"),
      });
    }
    const auth = await authenticateDeviceToken(ctx.db, token, organizationId);
    if (type === "mutation") await enforceExtensionWriteLimit(auth.tokenId);
    const web = await createWebCaller(ctx.db, ctx.headers, auth);
    return next({ ctx: { ...ctx, device: auth, web } });
  });

export type WebInputs = inferRouterInputs<typeof webRouterShape>;

/**
 * Input, der sendes uændret videre til web's procedure, som selv validerer
 * med sit eget schema (felter, grænser, fejltekster er derfor web's). Her
 * tjekkes kun, at det er et objekt; typen er web's input.
 */
export function webInput<T>() {
  return z.custom<T>(
    (value) => typeof value === "object" && value !== null,
    "Ugyldige data",
  );
}
