// Forbundne AI-apps (#912): OAuth-samtykker til MCP-endpointet. Per bruger —
// en bruger ser og afbryder kun sine egne forbindelser, uanset plan, så en
// forbindelse altid kan tilbagekaldes.
import { TRPCError } from "@trpc/server";
import { and, eq, inArray, isNull, max } from "drizzle-orm";
import { z } from "zod";
import { tr } from "@/i18n/server-text";
import {
  oauthAccessTokens,
  oauthClients,
  oauthConsents,
  oauthRefreshTokens,
  organizations,
} from "@/lib/db/schema";
import { logOrgAudit } from "@/lib/org-audit";
import { protectedProcedure, router } from "../trpc";

export const connectedAppsRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.user.id;
    const consents = await ctx.db
      .select({
        id: oauthConsents.id,
        clientId: oauthConsents.clientId,
        organizationId: oauthConsents.referenceId,
        scopes: oauthConsents.scopes,
        createdAt: oauthConsents.createdAt,
        clientName: oauthClients.name,
        clientUri: oauthClients.uri,
        organizationName: organizations.name,
      })
      .from(oauthConsents)
      .innerJoin(
        oauthClients,
        eq(oauthConsents.clientId, oauthClients.clientId),
      )
      .leftJoin(organizations, eq(oauthConsents.referenceId, organizations.id))
      .where(eq(oauthConsents.userId, userId));
    if (consents.length === 0) return [];

    // "Sidst brugt" ≈ seneste udstedte adgangstoken (fornyes hver time, mens
    // appen er i brug). Vi skriver ikke ved hvert MCP-kald.
    const usage = await ctx.db
      .select({
        clientId: oauthAccessTokens.clientId,
        referenceId: oauthAccessTokens.referenceId,
        lastUsedAt: max(oauthAccessTokens.createdAt),
      })
      .from(oauthAccessTokens)
      .where(
        and(
          eq(oauthAccessTokens.userId, userId),
          inArray(
            oauthAccessTokens.clientId,
            consents.map((c) => c.clientId),
          ),
        ),
      )
      .groupBy(oauthAccessTokens.clientId, oauthAccessTokens.referenceId);

    return consents
      .map((c) => ({
        ...c,
        lastUsedAt:
          usage.find(
            (u) =>
              u.clientId === c.clientId && u.referenceId === c.organizationId,
          )?.lastUsedAt ?? null,
      }))
      .sort(
        (a, b) =>
          (b.lastUsedAt ?? b.createdAt ?? new Date(0)).getTime() -
          (a.lastUsedAt ?? a.createdAt ?? new Date(0)).getTime(),
      );
  }),

  /**
   * Afbryd en forbindelse: alle appens adgangs- og refresh tokens for den
   * organisation tilbagekaldes (MCP afviser dem straks), og samtykket slettes,
   * så næste forbindelse kræver nyt samtykke.
   */
  revoke: protectedProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const consent = await ctx.db.query.oauthConsents.findFirst({
        where: and(
          eq(oauthConsents.id, input.id),
          eq(oauthConsents.userId, userId),
        ),
      });
      if (!consent) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: await tr("serverErrors", "connectedApps.notFound"),
        });
      }
      const client = await ctx.db.query.oauthClients.findFirst({
        where: eq(oauthClients.clientId, consent.clientId),
        columns: { name: true },
      });

      const now = new Date();
      const sameGrant = <
        T extends typeof oauthAccessTokens | typeof oauthRefreshTokens,
      >(
        table: T,
      ) =>
        and(
          eq(table.userId, userId),
          eq(table.clientId, consent.clientId),
          consent.referenceId
            ? eq(table.referenceId, consent.referenceId)
            : isNull(table.referenceId),
          isNull(table.revoked),
        );

      await ctx.db.transaction(async (tx) => {
        await tx
          .update(oauthAccessTokens)
          .set({ revoked: now })
          .where(sameGrant(oauthAccessTokens));
        await tx
          .update(oauthRefreshTokens)
          .set({ revoked: now })
          .where(sameGrant(oauthRefreshTokens));
        await tx.delete(oauthConsents).where(eq(oauthConsents.id, consent.id));
      });

      if (consent.referenceId) {
        await logOrgAudit(
          ctx.db,
          consent.referenceId,
          userId,
          "mcp_app_revoked",
          {
            metadata: {
              clientId: consent.clientId,
              clientName: client?.name ?? null,
            },
          },
        );
      }
      return { success: true };
    }),
});
