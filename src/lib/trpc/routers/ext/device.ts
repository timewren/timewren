import { TRPCError } from "@trpc/server";
import { and, eq, gt, gte, isNull, lt, type SQL, sql } from "drizzle-orm";
import { z } from "zod";
import { st, tr } from "@/i18n/server-text";
import type { db as dbType } from "@/lib/db";
import { deviceAuthCodes, extensionTokens, users } from "@/lib/db/schema";
import {
  DEVICE_ACCESS_TTL_MS,
  DEVICE_REFRESH_TTL_MS,
  type DeviceClientKind,
  deviceTokenName,
  safeEqual,
  verifierMatchesChallenge,
} from "@/lib/device-login";
import { generateExtensionToken } from "@/lib/extension-auth";
import { hashToken } from "@/lib/security/token-hash";
import {
  getClientIp,
  ipRateLimitKey,
  rateLimiter,
} from "@/lib/utils/rate-limiter";
import { publicProcedure, router } from "../../trpc";
import { deviceProcedure, resolveDeviceOrg } from "./device-procedure";

/**
 * Enheds-login (se src/lib/device-login.ts for hele forløbet): veksl
 * engangskoden fra browser-godkendelsen til adgangs- og refresh-token,
 * forny uden nyt login, og log enheden ud. Tokens er almindelige
 * extension-tokens med enhedsinfo, så de vises og tilbagekaldes i web
 * under Indstillinger → Integrationer.
 */

type Db = typeof dbType;

/**
 * Et roteret refresh-token giver ét nyt par inden for dette vindue (svaret
 * gik tabt); senere er det genbrug.
 */
export const REFRESH_REUSE_GRACE_MS = 60_000;

async function enforceIpLimit(headers: Headers | null, op: string) {
  const ip = headers ? getClientIp(headers) : "unknown";
  const result = await rateLimiter.check(
    ipRateLimitKey(ip, op),
    "extensionToken",
  );
  if (!result.allowed) {
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message: await tr("serverErrors", "ext.tooManyAttempts", {
        seconds: Math.ceil(result.resetIn / 1000),
      }),
    });
  }
}

const invalidCode = () =>
  new TRPCError({
    code: "UNAUTHORIZED",
    message: st("ext.loginCodeInvalid"),
  });

function issueTokens(now: Date) {
  const accessToken = generateExtensionToken();
  const refreshToken = generateExtensionToken();
  return {
    accessToken,
    refreshToken,
    expiresAt: new Date(now.getTime() + DEVICE_ACCESS_TTL_MS),
    refreshExpiresAt: new Date(now.getTime() + DEVICE_REFRESH_TTL_MS),
  };
}

async function loadUser(database: Db, userId: string) {
  const user = await database.query.users.findFirst({
    where: eq(users.id, userId),
    columns: { id: true, name: true, email: true, banned: true },
  });
  if (!user || user.banned) throw invalidCode();
  return { id: user.id, name: user.name, email: user.email };
}

export const extDeviceAuthRouter = router({
  /**
   * Veksl engangskoden fra deep linket. Kræver den `state`, det enheds-id
   * og den PKCE-verifier, som login blev startet med. Et nyt login på samme
   * enhed tilbagekalder enhedens tidligere tokens.
   */
  exchangeCode: publicProcedure
    .input(
      z.object({
        code: z.string().min(20).max(200),
        codeVerifier: z.string().min(43).max(128),
        state: z.string().min(16).max(256),
        deviceId: z.string().min(8).max(128),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await enforceIpLimit(ctx.headers, "ext.device.exchangeCode");
      const now = new Date();
      const codeHash = hashToken(input.code);

      const row = await ctx.db.query.deviceAuthCodes.findFirst({
        where: and(
          eq(deviceAuthCodes.codeHash, codeHash),
          isNull(deviceAuthCodes.usedAt),
          gt(deviceAuthCodes.expiresAt, now),
        ),
      });
      if (
        !row ||
        !safeEqual(row.state, input.state) ||
        row.deviceId !== input.deviceId ||
        !verifierMatchesChallenge(input.codeVerifier, row.codeChallenge)
      ) {
        throw invalidCode();
      }

      // Engangs: kun ét kald kan tage koden, også ved samtidige forsøg.
      const [claimed] = await ctx.db
        .update(deviceAuthCodes)
        .set({ usedAt: now })
        .where(
          and(eq(deviceAuthCodes.id, row.id), isNull(deviceAuthCodes.usedAt)),
        )
        .returning({ id: deviceAuthCodes.id });
      if (!claimed) throw invalidCode();

      const user = await loadUser(ctx.db, row.userId);
      // Medlemskabet kan være væk siden godkendelsen: så primær-orgen.
      const organizationId = await resolveDeviceOrg(
        ctx.db,
        row.userId,
        null,
        row.organizationId,
      );
      const tokens = issueTokens(now);

      await ctx.db.transaction(async (tx) => {
        await tx
          .update(extensionTokens)
          .set({ isRevoked: true, revokedAt: now })
          .where(
            and(
              eq(extensionTokens.userId, row.userId),
              eq(extensionTokens.deviceId, row.deviceId),
              eq(extensionTokens.isRevoked, false),
            ),
          );
        await tx.insert(extensionTokens).values({
          userId: row.userId,
          organizationId,
          tokenHash: hashToken(tokens.accessToken),
          name: deviceTokenName(
            row.clientKind as DeviceClientKind,
            row.deviceName,
          ),
          expiresAt: tokens.expiresAt,
          deviceId: row.deviceId,
          deviceName: row.deviceName,
          deviceOs: row.deviceOs,
          clientKind: row.clientKind,
          refreshTokenHash: hashToken(tokens.refreshToken),
          refreshExpiresAt: tokens.refreshExpiresAt,
        });
      });

      return { ...tokens, organizationId, user };
    }),

  /**
   * Forny adgangstokenet. Begge tokens roteres. To samtidige kald med samme
   * token kan begge lykkes inden for nådeperioden, og kun det sidste par
   * virker bagefter; appen skal derfor kun have én fornyelse i gang ad gangen.
   *
   * Genbrug: kommer et allerede roteret refresh-token igen senere end
   * REFRESH_REUSE_GRACE_MS efter rotationen, er det et tegn på, at det er
   * stjålet (enten tyven eller den rigtige app bruger det nu). Sessionen
   * tilbagekaldes, og brugeren skal logge ind igen. Inden for nådeperioden
   * er svaret gået tabt: det roterede token giver ét nyt par, og parret fra
   * det tabte svar holder op med at virke.
   */
  refresh: publicProcedure
    .input(
      z.object({
        refreshToken: z.string().min(20).max(200),
        deviceId: z.string().min(8).max(128),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await enforceIpLimit(ctx.headers, "ext.device.refresh");
      const now = new Date();
      const tokens = issueTokens(now);
      const inputHash = hashToken(input.refreshToken);
      // Rotationstidspunktet er expiresAt minus adgangstokenets levetid.
      const graceStart = new Date(
        now.getTime() + DEVICE_ACCESS_TTL_MS - REFRESH_REUSE_GRACE_MS,
      );
      const rotate = (match: SQL, previousRefreshTokenHash: SQL | string) =>
        ctx.db
          .update(extensionTokens)
          .set({
            tokenHash: hashToken(tokens.accessToken),
            expiresAt: tokens.expiresAt,
            refreshTokenHash: hashToken(tokens.refreshToken),
            previousRefreshTokenHash,
            refreshExpiresAt: tokens.refreshExpiresAt,
            lastUsedAt: now,
          })
          .where(
            and(
              match,
              eq(extensionTokens.deviceId, input.deviceId),
              eq(extensionTokens.isRevoked, false),
              gt(extensionTokens.refreshExpiresAt, now),
            ),
          )
          .returning({
            userId: extensionTokens.userId,
            organizationId: extensionTokens.organizationId,
          });
      let [row] = await rotate(
        eq(extensionTokens.refreshTokenHash, inputHash),
        inputHash,
      );
      if (!row) {
        // Det netop roterede token inden for nådeperioden: svaret gik tabt.
        // Genudsted, og gør det token, svaret indeholdt, til det roterede,
        // så det gamle ikke kan genudstede igen eller forlænge perioden.
        [row] = await rotate(
          and(
            eq(extensionTokens.previousRefreshTokenHash, inputHash),
            gte(extensionTokens.expiresAt, graceStart),
          ) as SQL,
          sql`${extensionTokens.refreshTokenHash}`,
        );
      }
      if (!row) {
        // Kun rotationer ældre end nådeperioden tæller som genbrug.
        await ctx.db
          .update(extensionTokens)
          .set({ isRevoked: true, revokedAt: now })
          .where(
            and(
              eq(extensionTokens.previousRefreshTokenHash, inputHash),
              eq(extensionTokens.isRevoked, false),
              lt(extensionTokens.expiresAt, graceStart),
            ),
          );
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: await tr("serverErrors", "ext.sessionExpired"),
        });
      }
      const user = await loadUser(ctx.db, row.userId);
      // Som ved exchangeCode: medlemskabet af den valgte org kan være væk.
      const organizationId = await resolveDeviceOrg(
        ctx.db,
        row.userId,
        null,
        row.organizationId,
      );
      return { ...tokens, organizationId, user };
    }),

  /**
   * Hvem tokenet tilhører, og hvilken org kaldet kører i (samme form som
   * `user` og `organizationId` fra exchangeCode).
   */
  me: deviceProcedure.query(({ ctx }) => ({
    user: ctx.device.user,
    organizationId: ctx.device.orgId,
  })),

  /** Log denne enhed ud (tilbagekald dens token). */
  logout: deviceProcedure.mutation(async ({ ctx }) => {
    await ctx.db
      .update(extensionTokens)
      .set({ isRevoked: true, revokedAt: new Date() })
      .where(eq(extensionTokens.id, ctx.device.tokenId));
    return { success: true };
  }),
});
