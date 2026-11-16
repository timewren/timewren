import type { BetterAuthPlugin } from "better-auth";
import { APIError, createAuthEndpoint, getOAuthState } from "better-auth/api";
import {
  generateIdTokenNonce,
  generateState,
  getOAuthCallbackPath,
  type OAuthProvider,
  verifyProviderIdToken,
} from "better-auth/oauth2";
import {
  type MicrosoftEntraIDProfile,
  microsoft,
} from "better-auth/social-providers";
import { z } from "zod";
import { SSO_PROVIDER_ID } from "@/lib/enterprise/sso/policy";

/**
 * Microsoft Entra ID-login (enterprise SSO, #470) på better-auth 1.7.
 *
 * 1.7 fjernede generic-oauth-endpoints (`/sign-in/oauth2`, `/oauth2/link`,
 * `/oauth2/callback/:id`), og dens `microsoftEntraId`-helper afviser
 * tenant "common". Vi registrerer derfor better-auths indbyggede
 * Microsoft-provider (multi-tenant, verificerer id_tokenens signatur, aud og
 * iss/tid) under det id, eksisterende konti allerede har:
 * "microsoft-entra-id". Login og kobling går nu via `signIn.social` og
 * `linkSocial`, og callbacken er `/api/auth/callback/microsoft-entra-id`.
 */

export interface MicrosoftEntraOptions {
  clientId: string;
  clientSecret: string;
  /** "common", "organizations" eller en tenant-GUID */
  tenantId: string;
  /**
   * Findes der en Microsoft-konto, som 1.6 gemte med `sub` som accountId?
   * 1.6 nøglede på `sub` fra Graph-userinfo, 1.7 nøgler på `oid`.
   */
  hasLegacyAccount: (sub: string) => Promise<boolean>;
}

/**
 * Konto-nøglen for en Microsoft-profil. Konti fra 1.6 har `sub` som
 * accountId; dem bliver vi ved med at finde på `sub`, så eksisterende
 * koblinger ikke brækker. Nye konti nøgles på `oid` som i better-auth 1.7
 * (dem finder en rollback til 1.6 ikke). Begge claims kommer fra den
 * verificerede id_token.
 */
export async function resolveMicrosoftAccountId(
  profile: Pick<MicrosoftEntraIDProfile, "oid" | "sub">,
  hasLegacyAccount: (sub: string) => Promise<boolean>,
): Promise<string> {
  const { oid, sub } = profile;
  if (typeof sub === "string" && sub && sub !== oid) {
    if (await hasLegacyAccount(sub)) return sub;
  }
  return oid;
}

/**
 * E-mail fra id_tokenen; uden `email`-claim falder vi tilbage til
 * `preferred_username` som 1.6-helperen gjorde (arbejdskonti har ofte kun
 * UPN). Påvirker ikke emailVerified.
 */
export function microsoftProfileEmail(
  profile: Partial<
    Pick<MicrosoftEntraIDProfile, "email" | "preferred_username">
  >,
): string | undefined {
  return profile.email || profile.preferred_username || undefined;
}

export function createMicrosoftEntraProvider(
  options: MicrosoftEntraOptions,
): OAuthProvider<MicrosoftEntraIDProfile> {
  const base = microsoft({
    clientId: options.clientId,
    clientSecret: options.clientSecret,
    tenantId: options.tenantId,
    // Samme scopes som før: ingen User.Read/offline_access, så kundernes
    // IT ikke skal give nyt samtykke.
    disableDefaultScope: true,
    scope: ["openid", "profile", "email"],
    disableProfilePhoto: true,
    mapProfileToUser: (profile) => {
      const email = microsoftProfileEmail(profile);
      return email ? { email } : {};
    },
  });

  return {
    ...base,
    id: SSO_PROVIDER_ID,
    name: "Microsoft",
    // Kun redirect-flowet; intet id_token-login fra klienten.
    options: { ...base.options, disableIdTokenSignIn: true },
    async getUserInfo(tokens) {
      if (!tokens.idToken) return null;
      // Den indbyggede provider afkoder kun id_tokenen. Verificér signatur,
      // aud og iss/tid mod Microsofts nøgler, før vi stoler på oid/sub.
      if (!(await verifyProviderIdToken(base, tokens.idToken))) return null;
      const info = await base.getUserInfo(tokens);
      if (!info) return null;
      // Kobling fra Indstillinger → Sikkerhed: brugeren er logget ind, og
      // better-auth kræver at e-mailen matcher kontoens. 1.6's /oauth2/link
      // krævede ikke mere; 1.7's linkSocial kræver desuden emailVerified for
      // ikke-trusted providers, hvilket Entra sjældent sender. `link` sættes
      // kun af serveren (ud fra sessionen) og ligger i den signerede state.
      // Ved login (ingen link) er der fortsat ingen auto-link på e-mail.
      const state = await getOAuthState();
      if (state?.link) {
        return { ...info, user: { ...info.user, emailVerified: true } };
      }
      return info;
    },
    accountSubject: ({ profile }) =>
      resolveMicrosoftAccountId(profile, options.hasLegacyAccount),
  };
}

/**
 * Registrerer Microsoft-provideren som social provider.
 *
 * `/sign-in/oauth2` er 1.6's generic-oauth-endpoint. Udgivne builds af
 * mobilappen kalder det stadig (`signIn.oauth2`), så det bevares for
 * Microsoft og starter samme redirect-flow som `/sign-in/social`.
 */
export function microsoftEntra(options: MicrosoftEntraOptions) {
  const provider = createMicrosoftEntraProvider(options);
  return {
    id: "microsoft-entra-id-provider",
    init: (ctx) => ({
      context: {
        socialProviders: [provider, ...ctx.socialProviders],
      },
    }),
    endpoints: {
      signInOAuth2Legacy: createAuthEndpoint(
        "/sign-in/oauth2",
        {
          method: "POST",
          body: z.object({
            providerId: z.string(),
            callbackURL: z.string().optional(),
            errorCallbackURL: z.string().optional(),
            newUserCallbackURL: z.string().optional(),
            disableRedirect: z.boolean().optional(),
            requestSignUp: z.boolean().optional(),
          }),
        },
        async (ctx) => {
          if (ctx.body.providerId !== provider.id) {
            throw new APIError("NOT_FOUND", { message: "Provider not found" });
          }
          const idTokenNonce = generateIdTokenNonce(provider);
          const { codeVerifier, state } = await generateState(ctx, {
            idTokenNonce,
          });
          const url = await provider.createAuthorizationURL({
            state,
            codeVerifier,
            idTokenNonce,
            redirectURI: `${ctx.context.baseURL}${getOAuthCallbackPath(provider)}`,
          });
          if (!ctx.body.disableRedirect) {
            ctx.setHeader("Location", url.toString());
          }
          return ctx.json({
            url: url.toString(),
            redirect: !ctx.body.disableRedirect,
          });
        },
      ),
    },
  } satisfies BetterAuthPlugin;
}
