import { createHash } from "node:crypto";
import { cimd } from "@better-auth/cimd";
import { fetchClientMetadataResource } from "@better-auth/cimd/node";
import { oauthProvider } from "@better-auth/oauth-provider";
import type { BetterAuthPlugin } from "better-auth";
import {
  APIError,
  createAuthMiddleware,
  getSessionFromCtx,
} from "better-auth/api";
import { getT } from "@/i18n/server";
import { RESOURCES } from "@/lib/api/scopes";
import { appUrlEnv } from "@/lib/runtime-env";

/**
 * OAuth 2.1-autorisationsserver til MCP-endpointet (#912).
 *
 * better-auths officielle `@better-auth/oauth-provider` (DCR, PKCE S256,
 * refresh-rotation, revoke, samtykke) + `@better-auth/cimd` (Client ID
 * Metadata Documents, MCP-spec 2026-07-28). Adgangstokens er opake og
 * slås op i databasen ved hvert MCP-kald, så tilbagekald virker med det samme.
 *
 * Tokenet bindes til én organisation: samtykket og alle tokens bærer
 * `referenceId` = den organisation, brugeren valgte på samtykkeskærmen (samme
 * model som `tk_live_`-nøglernes organizationId). Kun betalende planer må
 * forbinde — tjekket ved samtykke og igen ved hvert MCP-kald.
 */

function appUrl(): string {
  return (appUrlEnv() || "http://localhost:3000").replace(/\/+$/, "");
}

/** MCP-endpointets kanoniske URL = OAuth-`resource` (RFC 8707/9728). */
export function mcpResourceUrl(): string {
  return `${appUrl()}/api/v1/mcp`;
}

/** Autorisationsserverens issuer (better-auths baseURL + basePath). */
export function oauthIssuer(): string {
  return `${appUrl()}/api/auth`;
}

/** RFC 9728-stien for MCP-ressourcens metadata (path-indsat efter well-known). */
export const MCP_RESOURCE_METADATA_PATH =
  "/.well-known/oauth-protected-resource/api/v1/mcp";

export function mcpResourceMetadataUrl(): string {
  return `${appUrl()}${MCP_RESOURCE_METADATA_PATH}`;
}

/**
 * Præfikser på udstedte tokens. Gemmes ikke i databasen; gør tokens
 * genkendelige for secret scanning og adskiller dem fra `tk_live_`-nøgler.
 */
export const OAUTH_TOKEN_PREFIX = {
  opaqueAccessToken: "tt_at_",
  refreshToken: "tt_rt_",
  clientSecret: "tt_cs_",
} as const;

/** Ressourcer en AI-app kan få adgang til (webhooks kun via API-nøgle). */
export const MCP_OAUTH_RESOURCES = RESOURCES.filter((r) => r !== "webhooks");

/**
 * OAuth-scopes = de eksisterende API-nøgle-scopes (læs/skriv pr. ressource),
 * plus `offline_access` til refresh tokens. Ingen `*`/`:all`: en AI-app får
 * aldrig mere end det, der står i klartekst på samtykkeskærmen.
 */
export const MCP_OAUTH_SCOPES: string[] = [
  ...MCP_OAUTH_RESOURCES.flatMap((r) => [`${r}:read`, `${r}:write`]),
  "offline_access",
];

/** SHA-256-hex af et token, som det gemmes i oauth-tabellerne. */
export function hashOAuthToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Det OAuth-laget skal vide om TimeTrack. Injiceres, så flowet kan testes
 * mod en hukommelsesdatabase uden Postgres.
 */
export interface McpOAuthDeps {
  /** Brugerens aktive organisation, medlemskabsverificeret (eller null). */
  resolveOrgForSession(
    userId: string,
    session: Record<string, unknown>,
  ): Promise<string | null>;
  /** Dansk fejltekst hvis orgens plan ikke må bruge MCP, ellers null. */
  planDenial(userId: string, orgId: string): Promise<string | null>;
  /** Én audit-række pr. forbindelse/tilbagekaldelse (fejl må ikke vælte flowet). */
  audit(
    orgId: string,
    userId: string,
    action: "mcp_app_connected" | "mcp_app_revoked",
    metadata: Record<string, unknown>,
  ): Promise<void>;
}

function oauthQueryFromBody(body: unknown): URLSearchParams | null {
  const query = (body as { oauth_query?: unknown } | undefined)?.oauth_query;
  return typeof query === "string" ? new URLSearchParams(query) : null;
}

function clientIdFromBody(body: unknown): string | null {
  return oauthQueryFromBody(body)?.get("client_id") ?? null;
}

/**
 * De scopes samtykket giver: et eksplicit `scope` i body er en delmængde, der
 * erstatter de oprindelige; ellers gælder `scope` fra autorisationsforespørgslen.
 */
export function grantedScopesFromBody(body: unknown): string[] | undefined {
  const explicit = (body as { scope?: unknown } | undefined)?.scope;
  const scope =
    typeof explicit === "string"
      ? explicit
      : (oauthQueryFromBody(body)?.get("scope") ?? undefined);
  return scope ? scope.split(" ").filter(Boolean) : undefined;
}

/**
 * Vagt om `/oauth2/consent`: et godkendt samtykke kræver en organisation,
 * brugeren er medlem af, på en betalende plan. Afvises med dansk besked, som
 * samtykkeskærmen viser. Efter et godkendt samtykke skrives en audit-række.
 */
function mcpConsentGuard(deps: McpOAuthDeps): BetterAuthPlugin {
  const isAcceptedConsent = (ctx: { path?: string; body?: unknown }) =>
    ctx.path === "/oauth2/consent" &&
    (ctx.body as { accept?: unknown } | undefined)?.accept === true;

  return {
    id: "timetrack-mcp-consent-guard",
    hooks: {
      before: [
        {
          matcher: isAcceptedConsent,
          handler: createAuthMiddleware(async (ctx) => {
            const session = await getSessionFromCtx(ctx);
            if (!session) return; // pluginet svarer selv 401
            const orgId = await deps.resolveOrgForSession(
              session.user.id,
              session.session as unknown as Record<string, unknown>,
            );
            if (!orgId) {
              const t = (await getT("auth")) as unknown as (
                key: string,
              ) => string;
              throw new APIError("FORBIDDEN", { message: t("oauth.noOrg") });
            }
            const denial = await deps.planDenial(session.user.id, orgId);
            if (denial) throw new APIError("FORBIDDEN", { message: denial });
          }),
        },
      ],
      after: [
        {
          matcher: isAcceptedConsent,
          handler: createAuthMiddleware(async (ctx) => {
            if (ctx.context.returned instanceof Error) return;
            const session = await getSessionFromCtx(ctx);
            if (!session) return;
            const clientId = clientIdFromBody(ctx.body);
            const orgId = await deps.resolveOrgForSession(
              session.user.id,
              session.session as unknown as Record<string, unknown>,
            );
            if (!orgId || !clientId) return;
            const client = await ctx.context.adapter
              .findOne<{ name?: string | null }>({
                model: "oauthClient",
                where: [{ field: "clientId", value: clientId }],
              })
              .catch(() => null);
            await deps
              .audit(orgId, session.user.id, "mcp_app_connected", {
                clientId,
                clientName: client?.name ?? null,
                scopes: grantedScopesFromBody(ctx.body),
              })
              .catch((err) => console.error("[mcp-oauth] audit fejlede:", err));
          }),
        },
      ],
    },
  };
}

/**
 * `next build` evaluerer auth-modulet i hver worker under "Collecting page
 * data" (#1096). oauth-provider seeder `resources` i databasen ved init, og
 * under build findes der ingen database. Ved kørsel seedes ressourcen som før
 * (og ellers ved første ressourceopslag).
 */
function isNextBuildPhase(): boolean {
  return process.env.NEXT_PHASE === "phase-production-build";
}

/** Plugins til `betterAuth({ plugins })`. */
export function mcpOAuthPlugins(deps: McpOAuthDeps): BetterAuthPlugin[] {
  const resource = mcpResourceUrl();
  return [
    oauthProvider({
      loginPage: "/auth/oauth/login",
      consentPage: "/auth/oauth/consent",
      scopes: MCP_OAUTH_SCOPES,
      // Kun brugerdelegeret adgang; ingen maskine-til-maskine-tokens.
      grantTypes: ["authorization_code", "refresh_token"],
      // Opake tokens slået op i DB: øjeblikkelig tilbagekaldelse, ingen JWKS.
      disableJwtPlugin: true,
      // Claude.ai, ChatGPT m.fl. registrerer sig selv (RFC 7591).
      allowDynamicClientRegistration: true,
      allowUnauthenticatedClientRegistration: true,
      // Native klienter (Cursor, Claude Code) sender ofte ikke application_type.
      clientRegistrationDefaultApplicationType: "infer",
      resources: isNextBuildPhase()
        ? undefined
        : [{ identifier: resource, name: "TimeTrack MCP" }],
      // Én ressource: alle klienter må bede om den.
      enforcePerClientResources: false,
      storeTokens: { hash: (token) => hashOAuthToken(token) },
      prefix: OAUTH_TOKEN_PREFIX,
      postLogin: {
        // Org-valget sker på samtykkeskærmen (den aktive organisation sættes
        // før samtykket sendes), så der er ingen separat post-login-side.
        page: "/auth/oauth/consent",
        shouldRedirect: () => false,
        consentReferenceId: async ({ user, session }) =>
          (await deps.resolveOrgForSession(
            user.id,
            session as unknown as Record<string, unknown>,
          )) ?? undefined,
      },
    }) as unknown as BetterAuthPlugin,
    cimd({
      fetchClientMetadataResource,
      metadataProfile: "mcp-2026-07-28",
    }) as unknown as BetterAuthPlugin,
    mcpConsentGuard(deps),
  ];
}
