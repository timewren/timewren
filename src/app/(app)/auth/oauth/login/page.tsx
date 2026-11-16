import { verifyOAuthQueryParams } from "@better-auth/oauth-provider";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { auth } from "@/lib/auth";
import { authorizePathFromSignedQuery } from "@/lib/auth/mcp-oauth-query";
import { OAuthMessage } from "../OAuthMessage";

export const dynamic = "force-dynamic";

/**
 * Login-side for OAuth-flowet (#912). Autorisationsserveren sender hertil med
 * en signeret forespørgsel, når brugeren ikke er logget ind. Uden session
 * går vi til den almindelige login-side og tilbage hertil; med session
 * fortsætter vi /oauth2/authorize med den oprindelige forespørgsel.
 */
export default async function OAuthLoginPage({
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
  const { secret } = await auth.$context;
  if (
    !query.get("sig") ||
    !(await verifyOAuthQueryParams(query.toString(), secret))
  ) {
    return <OAuthMessage title={t("expiredTitle")} text={t("expiredText")} />;
  }

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    const back = `/auth/oauth/login?${query.toString()}`;
    redirect(`/login?redirect=${encodeURIComponent(back)}`);
  }
  redirect(authorizePathFromSignedQuery(query));
}
