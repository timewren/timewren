import { verifyOAuthQueryParams } from "@better-auth/oauth-provider";
import { asc, eq } from "drizzle-orm";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { auth } from "@/lib/auth";
import { resolveActiveOrgId } from "@/lib/auth/active-org";
import { mcpPlanDenial } from "@/lib/auth/mcp-oauth-access";
import { parseScopes } from "@/lib/auth/mcp-oauth-query";
import { getRequestBrand } from "@/lib/brands/request";
import { db } from "@/lib/db";
import { members, organizations } from "@/lib/db/schema";
import { OAuthMessage } from "../OAuthMessage";
import { ConsentForm } from "./ConsentForm";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const t = await getTranslations("auth.consent");
  const { brand } = await getRequestBrand();
  return { title: t("metaTitle", { brand: brand.name }) };
}

/**
 * Samtykkeskærm for AI-apps, der forbinder til MCP-endpointet (#912).
 * Autorisationsserveren sender hertil med en signeret forespørgsel. Siden
 * viser klientens navn, scopes i klartekst og et org-valg; planen tjekkes pr.
 * organisation, så Gratis og udløbne abonnementer får en dansk forklaring.
 */
export default async function OAuthConsentPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) {
    for (const v of Array.isArray(value) ? value : value ? [value] : []) {
      query.append(key, v);
    }
  }

  const t = await getTranslations("auth.oauth");
  const context = await auth.$context;
  if (
    !query.get("sig") ||
    !(await verifyOAuthQueryParams(query.toString(), context.secret))
  ) {
    return <OAuthMessage title={t("expiredTitle")} text={t("expiredText")} />;
  }

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    const back = `/auth/oauth/consent?${query.toString()}`;
    redirect(`/login?redirect=${encodeURIComponent(back)}`);
  }

  const clientId = query.get("client_id") ?? "";
  const client = clientId
    ? await context.adapter.findOne<{
        name?: string | null;
        uri?: string | null;
        disabled?: boolean | null;
      }>({
        model: "oauthClient",
        where: [{ field: "clientId", value: clientId }],
      })
    : null;
  if (!client || client.disabled) {
    const { brand } = await getRequestBrand();
    return (
      <OAuthMessage
        title={t("unknownAppTitle")}
        text={t("unknownAppText", { brand: brand.name })}
      />
    );
  }

  const userId = session.user.id;
  const orgRows = await db
    .select({ id: organizations.id, name: organizations.name })
    .from(members)
    .innerJoin(organizations, eq(members.organizationId, organizations.id))
    .where(eq(members.userId, userId))
    .orderBy(asc(organizations.name));
  const orgs = await Promise.all(
    orgRows.map(async (org) => ({
      ...org,
      denial: await mcpPlanDenial(userId, org.id),
    })),
  );
  const activeOrgId = await resolveActiveOrgId({
    db,
    userId,
    session: session.session as unknown as Record<string, unknown>,
  });

  return (
    <ConsentForm
      clientName={client.name || t("anAiApp")}
      clientUri={client.uri ?? null}
      userLabel={session.user.name || session.user.email}
      userEmail={session.user.email}
      scopes={parseScopes(query.get("scope"))}
      orgs={orgs}
      activeOrgId={activeOrgId}
      oauthQuery={query.toString()}
    />
  );
}
