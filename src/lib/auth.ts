import { expo } from "@better-auth/expo";
import { passkey } from "@better-auth/passkey";
import { type BetterAuthOptions, betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import {
  APIError,
  createAuthMiddleware,
  getSessionFromCtx,
} from "better-auth/api";
import {
  admin,
  magicLink,
  organization,
  phoneNumber,
  twoFactor,
} from "better-auth/plugins";
import { and, desc, eq, gt, sql } from "drizzle-orm";
import { tr } from "@/i18n/server-text";
import { brand, getBrand } from "@/lib/brand";
import {
  type BrandKey,
  DEFAULT_BRAND_KEY,
  getBrandConfigsSafe,
} from "@/lib/brands/registry";
import { getEmailDomain } from "@/lib/config";
import { appUrlEnv, marketingUrlEnv } from "@/lib/runtime-env";
import { bootstrapAdmin } from "./auth/admin-bootstrap";
import { getAppleAppBundleId, getAppleClientSecret } from "./auth/apple";
import { isEmailVerificationRequired } from "./auth/email-verification";
import {
  authBrandForHost,
  type BrandAuthParams,
  brandAuthParams,
  isHostAuthEnabled,
  isRedirectFlow,
  isWrongBrand,
  signupLocale,
  toBrandKey,
  WRONG_BRAND_CODE,
  WRONG_BRAND_MESSAGE,
  WRONG_BRAND_QUERY,
} from "./auth/host-auth";
import { mcpOAuthPlugins } from "./auth/mcp-oauth";
import { mcpOAuthDeps } from "./auth/mcp-oauth-access";
import { microsoftEntra } from "./auth/microsoft-entra";
import { signupLocaleFromRequest } from "./auth/signup-locale";
import { microsoftTenant, socialClient } from "./auth/social-providers";
import { removeStaleOtherBrandSignup } from "./auth/stale-signup";
import { deriveTrustedOrigins } from "./auth/trusted-origins";
import { syncSeatsToUsage, tryAutoExpandSeats } from "./billing/auto-seats";
import { FREE_MAX_SEATS } from "./billing/plan-gate";
import { db } from "./db";
import * as schema from "./db/schema";
import { bannedDomains } from "./db/schema";
import { isDemoBlockedAuthPath } from "./demo/blocked";
import { isDemoMode, logDemoSuppressed } from "./demo/demo-mode";
import { sendDripWelcomeEmail } from "./email/drip";
import { wasEmailSentRecently } from "./email/logger";
import { sendMagicLinkEmail } from "./email/magic-link";
import { sendOrganizationInviteEmail } from "./email/organization";
import { sendPasswordResetEmail } from "./email/password-reset";
import {
  sendNewLoginEmail,
  sendPasswordChangedEmail,
  sendTwoFactorCodeEmail,
} from "./email/security";
import { sendVerificationEmail } from "./email/verification";
import { sendWelcomeEmail } from "./email/welcome";
import {
  autoJoinUserToVerifiedOrg,
  findVerifiedOrgForEmail,
} from "./enterprise/sso/auto-join";
import {
  callbackBypassesSso,
  isNonSsoSignInPath,
  SSO_PROVIDER_ID,
  shouldDeleteRejectedNewUser,
} from "./enterprise/sso/policy";
import { seedNewOrgModules } from "./modules/bundles";
import { notifyAdmin } from "./notifications/admin";
import { defaultWorkspaceName } from "./org/default-workspace-name";
import { newOrgRegionMetadata } from "./org/new-org-region";
import { logOrgAudit } from "./org-audit";
import {
  countOrgMembers,
  resolveOrgMaxSeats,
  resolveOrgSeatPolicy,
} from "./org-seats";
import { encryptIdTokenBeforeWrite } from "./security/oauth-token-crypto";
import { getAllowedDomains, parseOrgMetadata } from "./utils/org-metadata";

// Warn if production is running with localhost base URL
const authBaseURL = appUrlEnv() || "http://localhost:3000";
if (
  process.env.NODE_ENV === "production" &&
  authBaseURL.includes("localhost")
) {
  console.warn(
    "[Auth] WARNING: NEXT_PUBLIC_APP_URL is not set or points to localhost. " +
      "OAuth redirects and cookie security will not work correctly in production. " +
      "Set NEXT_PUBLIC_APP_URL to your production domain (e.g. https://timetrack.dk).",
  );
}

// Get base URL for passkey rpID
const getHostname = () => {
  try {
    return new URL(authBaseURL).hostname;
  } catch {
    return "localhost";
  }
};

// Cookie domain for cross-subdomain sessions. Set to ".timetrack.dk" at the
// subdomain-split cutover so the session is shared between timetrack.dk and
// app.timetrack.dk (no forced re-login). Unset = host-only cookie (current
// behaviour). Only meaningful in production with secure cookies.
const authCookieDomain = process.env.AUTH_COOKIE_DOMAIN || undefined;

// Passkey relying-party ID. WebAuthn credentials are domain-bound, so at the
// subdomain split this must be pinned to the registrable parent domain
// ("timetrack.dk") so existing passkeys keep working on BOTH the marketing
// domain and the app.* subdomain.
//
// SAFE DEFAULT: when the split is active (app host ≠ marketing host) and
// AUTH_RP_ID is unset, fall back to the MARKETING hostname — falling back to
// the app hostname (app.timetrack.dk) would silently invalidate every
// existing passkey. Single-host setups keep the old behaviour (app hostname).
const marketingHostname = (() => {
  try {
    return new URL(marketingUrlEnv() || "").hostname;
  } catch {
    return "";
  }
})();
const subdomainSplitActive = Boolean(
  marketingHostname && marketingHostname !== getHostname(),
);
const authRpID =
  process.env.AUTH_RP_ID ||
  (subdomainSplitActive ? marketingHostname : getHostname());
if (subdomainSplitActive && !process.env.AUTH_RP_ID) {
  console.warn(
    `[auth] Subdomain split is active but AUTH_RP_ID is unset — defaulting passkey rpID to the marketing hostname ("${marketingHostname}") so existing passkeys keep working. Set AUTH_RP_ID explicitly to silence this warning.`,
  );
}

/**
 * Opret en personlig freelance-workspace (org + owner-medlemskab + moduler)
 * til en ny bruger. Kaldes fra user.create-hooken og — som fallback — fra
 * session.create når en forventet domæne-auto-join (E12) alligevel afvises,
 * så brugeren ikke ender org-løs i onboarding/paywall-wizard'en.
 */
async function createPersonalWorkspace(user: {
  id: string;
  name: string | null;
  email: string;
  /** users.brand. Organisationen får ejerens brand (multibrand). */
  brand?: string | null;
  /** users.locale. Arbejdsområdets navn følger ejerens sprog. */
  locale?: string | null;
}): Promise<void> {
  // Auto-create personal workspace organization for the new user
  try {
    // Generate slug from name or email
    const baseSlug = (user.name || user.email.split("@")[0])
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 48);

    let slug = baseSlug || "workspace";
    let attempts = 0;

    // Check for slug conflicts and append suffix if needed
    while (attempts < 10) {
      const existing = await db
        .select({ id: schema.organizations.id })
        .from(schema.organizations)
        .where(eq(schema.organizations.slug, slug))
        .limit(1);
      if (existing.length === 0) break;
      const suffix = Math.random().toString(36).slice(2, 6);
      slug = `${baseSlug}-${suffix}`;
      attempts++;
    }

    if (attempts >= 10) {
      console.warn(
        `[Auth] Slug collision: exhausted 10 attempts for user ${user.id} (base: "${baseSlug}")`,
      );
    }

    const orgId = crypto.randomUUID();
    const memberId = crypto.randomUUID();
    const workspaceName = await defaultWorkspaceName(
      user.name || user.email.split("@")[0],
      user.locale,
    );

    // Atomic: create org + membership + modules in one transaction
    await db.transaction(async (tx) => {
      await tx.insert(schema.organizations).values({
        id: orgId,
        name: workspaceName,
        slug,
        // Valuta, land og sprog efter ejerens sprog (fund 11, 18, 19).
        metadata: { type: "freelance", ...newOrgRegionMetadata(user) },
        // Kun ikke-standardbrands skrives; timetrack bruger kolonnens default.
        ...(toBrandKey(user.brand) !== DEFAULT_BRAND_KEY && {
          brand: toBrandKey(user.brand),
        }),
      });

      await tx.insert(schema.members).values({
        id: memberId,
        organizationId: orgId,
        userId: user.id,
        role: "owner",
      });

      // @ts-expect-error - tx type is compatible with db for seedNewOrgModules
      await seedNewOrgModules(tx, orgId);
    });
  } catch (error) {
    // Don't let org creation failure block user signup
    console.error(
      "Failed to auto-create workspace org for user:",
      user.id,
      error,
    );
  }
}

/** Microsoft-login for brandet (TimeTrack: MICROSOFT_*, TimeWren: TIMEWREN_MICROSOFT_*). */
function microsoftLoginConfigured(key: BrandKey): boolean {
  return Boolean(socialClient(key, "microsoft"));
}

const SSO_REQUIRED_MESSAGE =
  "Jeres organisation kræver login med Microsoft. Brug knappen 'Log ind med Microsoft'.";

/**
 * Find e-mailen bag et login-request-body: direkte (e-mail/magic link) eller
 * via telefonnummer (phone-number-plugin). Null = intet at tjekke.
 */
async function resolveLoginEmail(body: unknown): Promise<string | null> {
  const b = body as { email?: unknown; phoneNumber?: unknown } | undefined;
  if (typeof b?.email === "string") return b.email;
  if (typeof b?.phoneNumber === "string" && b.phoneNumber) {
    const user = await db.query.users.findFirst({
      where: eq(schema.users.phoneNumber, b.phoneNumber),
      columns: { email: true },
    });
    return user?.email ?? null;
  }
  return null;
}

const appleConfigured = Boolean(getAppleClientSecret());

/**
 * Sociale udbydere for et brand. TimeTrack: præcis som før (alle fire
 * registreret, `enabled` styret af env). Andre brands (TimeWren): kun
 * udbydere med brandets egen klient (TIMEWREN_GOOGLE_CLIENT_ID osv., se
 * auth/social-providers.ts). TimeTracks klienter bruges aldrig dér, og uden
 * en klient er udbyderen slet ikke registreret.
 */
function socialProvidersFor(
  key: BrandKey,
): NonNullable<BetterAuthOptions["socialProviders"]> {
  if (key === DEFAULT_BRAND_KEY) {
    return {
      // Sign in with Apple (Apple 4.8 kræver det i appen når andre sociale logins tilbydes).
      // Web-flow bruger Services ID som clientId; native iOS sender et id-token, som
      // verificeres mod appens bundle-id (appBundleIdentifier). Client secret er en JWT
      // signeret med .p8-nøglen (maks. 6 måneders levetid — genereres ved hver opstart).
      apple: async () => ({
        clientId: process.env.APPLE_CLIENT_ID || "",
        clientSecret: getAppleClientSecret(),
        appBundleIdentifier: getAppleAppBundleId(),
        enabled: appleConfigured,
      }),
      google: {
        clientId: process.env.GOOGLE_CLIENT_ID || "",
        clientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
        enabled: Boolean(
          process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET,
        ),
      },
      discord: {
        clientId: process.env.DISCORD_CLIENT_ID || "",
        clientSecret: process.env.DISCORD_CLIENT_SECRET || "",
        enabled: Boolean(
          process.env.DISCORD_CLIENT_ID && process.env.DISCORD_CLIENT_SECRET,
        ),
      },
      github: {
        clientId: process.env.GITHUB_CLIENT_ID || "",
        clientSecret: process.env.GITHUB_CLIENT_SECRET || "",
        enabled: Boolean(
          process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET,
        ),
      },
    };
  }
  const providers: NonNullable<BetterAuthOptions["socialProviders"]> = {};
  for (const id of ["google", "discord", "github"] as const) {
    const client = socialClient(key, id);
    if (client) providers[id] = { ...client, enabled: true };
  }
  // Apple kun med brandets Services ID og en signeringsnøgle (APPLE_TEAM_ID,
  // APPLE_KEY_ID, APPLE_PRIVATE_KEY), så secret'en kan bygges.
  const apple = socialClient(key, "apple");
  if (apple && getAppleClientSecret(apple.clientId)) {
    // Ingen appBundleIdentifier: mobilappen er TimeTracks og bruger
    // standardinstansen; id-tokens skal være udstedt til brandets Services ID.
    providers.apple = async () => {
      const clientSecret = getAppleClientSecret(apple.clientId);
      return {
        clientId: apple.clientId,
        clientSecret,
        enabled: Boolean(clientSecret),
      };
    };
  }
  return providers;
}

/** Microsoft Entra ID for brandet; tom uden brandets klient. */
function microsoftPlugins(key: BrandKey) {
  const client = socialClient(key, "microsoft");
  if (!client) return [];
  return [
    microsoftEntra({
      clientId: client.clientId,
      clientSecret: client.clientSecret,
      // "common" = alle Microsoft-konti; sæt konkret tenant-GUID
      // for at begrænse til én organisation.
      tenantId: microsoftTenant(key),
      hasLegacyAccount: async (sub) => {
        const [row] = await db
          .select({ id: schema.accounts.id })
          .from(schema.accounts)
          .where(
            and(
              eq(schema.accounts.providerId, SSO_PROVIDER_ID),
              eq(schema.accounts.accountId, sub),
            ),
          )
          .limit(1);
        return Boolean(row);
      },
    }),
  ];
}

/**
 * users.brand for en konto (null = findes ikke). Uden host-auth-flagene slås
 * intet op, og mails og login er som før.
 */
async function brandOfUser(
  where: { id: string } | { email: string },
): Promise<string | null> {
  if (!isHostAuthEnabled()) return null;
  const [row] = await db
    .select({ brand: schema.users.brand })
    .from(schema.users)
    .where(
      "id" in where
        ? eq(schema.users.id, where.id)
        : sql`lower(${schema.users.email}) = ${where.email.toLowerCase()}`,
    )
    .limit(1);
  return row?.brand ?? null;
}

/** users.brand og emailVerified for en e-mail (null = findes ikke). */
async function userBrandAndVerified(
  email: string,
): Promise<{ brand: string | null; emailVerified: boolean } | null> {
  const [row] = await db
    .select({
      brand: schema.users.brand,
      emailVerified: schema.users.emailVerified,
    })
    .from(schema.users)
    .where(sql`lower(${schema.users.email}) = ${email.toLowerCase()}`)
    .limit(1);
  return row ?? null;
}

/** organizations.brand for en organisation (null uden host-auth-flagene). */
async function brandOfOrg(orgId: string): Promise<string | null> {
  if (!isHostAuthEnabled()) return null;
  const [row] = await db
    .select({ brand: schema.organizations.brand })
    .from(schema.organizations)
    .where(eq(schema.organizations.id, orgId))
    .limit(1);
  return row?.brand ?? null;
}

/**
 * Standardinstansen: timetrack.dk, selvhost og alle hosts uden for TimeWren.
 * Værdierne er de samme som før multibrand (baseURL, RP ID, cookies, origins).
 */
const DEFAULT_AUTH: BrandAuthParams = {
  key: DEFAULT_BRAND_KEY,
  appName: brand.name,
  shortName: brand.shortName,
  baseURL: authBaseURL,
  rpID: authRpID,
  trustedOrigins: deriveTrustedOrigins({
    appUrl: authBaseURL,
    marketingUrl: marketingUrlEnv(),
    trustedOriginsEnv: process.env.TRUSTED_ORIGINS,
    appSchemesEnv: process.env.APP_SCHEMES,
    isDevelopment: process.env.NODE_ENV === "development",
  }),
  cookieDomain: authCookieDomain,
};

/** Typetjek og kontekst-typer som i betterAuth({...}), uden at miste typen. */
const defineOptions = <T extends BetterAuthOptions>(
  build: (b: BrandAuthParams) => T,
) => build;

/**
 * better-auth-opsætningen for ét brand. Standardinstansen bygges med
 * DEFAULT_AUTH; TimeWren får sin egen instans (authForBrand) med egen
 * baseURL, RP ID, host-only cookies og origins. Database, secret og hooks er
 * fælles, så sessioner læses ens af begge.
 */
const authOptions = defineOptions((b: BrandAuthParams) => ({
  appName: b.appName,
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: {
      user: schema.users,
      session: schema.sessions,
      account: schema.accounts,
      verification: schema.verifications,
      // Passkey plugin tables
      passkey: schema.passkeys,
      // Two-Factor plugin tables
      twoFactor: schema.twoFactors,
      // Organization plugin tables
      organization: schema.organizations,
      member: schema.members,
      invitation: schema.invitations,
      // OAuth-provider til MCP (#912)
      oauthClient: schema.oauthClients,
      oauthResource: schema.oauthResources,
      oauthClientResource: schema.oauthClientResources,
      oauthRefreshToken: schema.oauthRefreshTokens,
      oauthAccessToken: schema.oauthAccessTokens,
      oauthConsent: schema.oauthConsents,
      oauthClientAssertion: schema.oauthClientAssertions,
    },
  }),
  baseURL: b.baseURL,
  secret: process.env.BETTER_AUTH_SECRET,

  // Login-rate-limit (#203): Better-Auths default (~10/60s) er for løs til
  // credential stuffing. Stram politik på de følsomme endpoints — matcher
  // RATE_LIMIT_CONFIGS.login (5/15 min) fra appens øvrige rate-limiting.
  rateLimit: {
    enabled: true,
    window: 60,
    max: 60,
    customRules: {
      "/sign-in/email": { window: 15 * 60, max: 5 },
      "/sign-up/email": { window: 15 * 60, max: 10 },
      "/request-password-reset": { window: 15 * 60, max: 5 },
      "/reset-password": { window: 15 * 60, max: 5 },
      "/two-factor/verify-totp": { window: 15 * 60, max: 10 },
      // Email-OTP-fallbacken (otpOptions.sendOTP) verificerer via sit EGET
      // endpoint — uden denne regel kan en 6-cifret kode gaettes med den
      // loese default (60/min).
      "/two-factor/verify-otp": { window: 15 * 60, max: 10 },
      // Backup-kode-fallbacken og email-afsendelsen fra /login/two-factor:
      // stram så koder ikke kan gaettes og mails ikke kan spammes.
      "/two-factor/verify-backup-code": { window: 15 * 60, max: 10 },
      "/two-factor/send-otp": { window: 15 * 60, max: 5 },
      // Magic link og SMS sender til en vilkårlig modtager. Pluginenes egne
      // regler (5/min og 10/min pr. IP) tillader mailbombning af en fremmed
      // adresse og dyre SMS-udsendelser; stram dem som password-reset.
      "/sign-in/magic-link": { window: 15 * 60, max: 5 },
      "/phone-number/send-otp": { window: 15 * 60, max: 5 },
      "/phone-number/request-password-reset": { window: 15 * 60, max: 5 },
      "/phone-number/verify": { window: 15 * 60, max: 10 },
    },
  },

  emailAndPassword: {
    enabled: true,
    autoSignIn: !isEmailVerificationRequired(), // Kun slået til, når mailverifikation er slået fra (selvhosting uden mail)
    requireEmailVerification: isEmailVerificationRequired(),
    sendResetPassword: async ({ user, url }) => {
      // Konto på et andet brand: ingen mail (svaret er det samme som altid,
      // så adressen lækkes ikke mellem brands).
      const userBrand = await brandOfUser({ id: user.id });
      if (isWrongBrand(userBrand, b.key)) return;
      await sendPasswordResetEmail({
        to: user.email,
        name: user.name,
        resetUrl: url,
        userId: user.id,
        brand: userBrand,
      });
    },
    resetPasswordTokenExpiresIn: 60 * 60, // 1 hour
  },

  emailVerification: {
    sendOnSignUp: isEmailVerificationRequired(),
    autoSignInAfterVerification: true,
    sendVerificationEmail: async ({ user, url }) => {
      const userBrand = await brandOfUser({ id: user.id });
      if (isWrongBrand(userBrand, b.key)) return;
      await sendVerificationEmail({
        to: user.email,
        name: user.name,
        verificationUrl: url,
        userId: user.id,
        brand: userBrand,
      });
    },
    expiresIn: 60 * 60 * 24, // 24 hours
  },

  socialProviders: socialProvidersFor(b.key),

  // Multibrand: users.brand stemples i samme insert som kontoen
  // (databaseHooks.user.create.before). Ikke input fra klienten og ikke en del
  // af svarene, så get-session er uændret.
  user: {
    additionalFields: {
      brand: {
        type: "string",
        required: false,
        input: false,
        returned: false,
      },
      // Kun ikke-standardbrands: users.locale sættes i samme insert
      // (signupLocale). TimeTracks felter og svar er som før: kolonnens
      // default ("da"), og feltet er ikke erklæret (typen følger TimeTrack).
      ...((b.key !== DEFAULT_BRAND_KEY
        ? {
            locale: {
              type: "string",
              required: false,
              input: false,
            },
          }
        : {}) as Record<never, never>),
    },
  },

  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7 days
    updateAge: 60 * 60 * 24, // Update session every 24 hours
  },

  trustedOrigins: b.trustedOrigins,

  // Account linking - allows users to link multiple OAuth providers to one account
  account: {
    // OAuth-login-tokens (access/refresh) krypteres at rest med
    // BETTER_AUTH_SECRET (#710). Gamle klartekst-rækker læses uændret og
    // krypteres af scripts/backfill-encrypt-secrets.ts. Rotation af
    // BETTER_AUTH_SECRET gør krypterede tokens ulæselige for token-refresh —
    // brug i så fald BETTER_AUTH_SECRETS (versioneret) eller lad brugerne logge
    // ind igen (login skriver nye tokens). idToken krypteres i databaseHooks.
    encryptOAuthTokens: true,
    accountLinking: {
      enabled: true,
      // Discord er ikke trusted: dens konti linkes kun, når Discord selv
      // melder e-mailen verificeret (#1117).
      trustedProviders: ["google", "github"],
    },
  },

  advanced: {
    // Env-styret så beta.timetrack.dk kan bruge et separat cookie-navn og
    // dermed ikke kollidere med prods `.timetrack.dk`-scopede session-cookie
    // (som ellers lækker til alle subdomæner). Default uændret i prod.
    cookiePrefix: process.env.AUTH_COOKIE_PREFIX || "better-auth",
    // Share the session cookie across timetrack.dk and app.timetrack.dk when a
    // cookie domain is configured; otherwise stay host-only (current behaviour).
    crossSubDomainCookies: b.cookieDomain
      ? { enabled: true, domain: b.cookieDomain }
      : { enabled: false },
    useSecureCookies: process.env.NODE_ENV === "production",
  },

  plugins: [
    // Native mobilapp: oversætter `expo-origin` → Origin så CSRF-tjekket
    // accepterer app-schemes, og sender session-cookien med i deep-link-
    // redirects (OAuth/magic link) så expoClient kan gemme den i SecureStore.
    expo(),
    // Microsoft Entra ID (Azure AD) — enterprise-kunder (fx kunde C) logger ind
    // med deres arbejdskonto. Aktiveres kun når brandets env-vars er sat
    // (MICROSOFT_* for TimeTrack, TIMEWREN_MICROSOFT_* for TimeWren).
    // Callback-URL til Azure app registration (better-auth 1.7):
    //   {baseURL}/api/auth/callback/microsoft-entra-id
    ...microsoftPlugins(b.key),

    // Admin plugin: unlocks impersonation, ban, and role management.
    // We treat `admin` and `supporter` as admin-capable roles so support
    // staff can also trigger impersonation, but only if they pass the
    // plugin's adminRoles check.
    admin({
      adminRoles: ["admin"],
      defaultRole: "user",
      impersonationSessionDuration: 60 * 60, // 1 hour — must stop + return
    }),

    // Organization plugin for teams
    organization({
      allowUserToCreateOrganization: true,
      organizationLimit: 5,
      creatorRole: "owner",
      membershipLimit: 50,
      invitationExpiresIn: 60 * 60 * 48, // 48 hours
      // Multibrand: organizations.brand skrives i samme insert som org'en.
      // Ikke input fra klienten og ikke en del af svarene.
      schema: {
        organization: {
          additionalFields: {
            brand: {
              type: "string",
              required: false,
              input: false,
              returned: false,
            },
          },
        },
      },
      organizationHooks: {
        // Ny organisation får ejerens brand (kun ikke-standardbrands skrives;
        // timetrack bruger kolonnens default som før).
        // Valuta, land og sprog følger ejeren som ved den personlige
        // workspace; metadata fra klienten vinder over standarderne.
        async beforeCreateOrganization({ organization: orgData, user }) {
          // Ét opslag fodrer både brand og region.
          const [owner] = await db
            .select({ brand: schema.users.brand, locale: schema.users.locale })
            .from(schema.users)
            .where(eq(schema.users.id, user.id))
            .limit(1);
          const ownerBrand = toBrandKey(
            isHostAuthEnabled() ? owner?.brand : null,
          );
          const metadata = {
            ...newOrgRegionMetadata(owner ?? {}),
            ...parseOrgMetadata(orgData.metadata),
          };
          return {
            data: {
              ...orgData,
              metadata,
              ...(ownerBrand !== DEFAULT_BRAND_KEY && { brand: ownerBrand }),
            },
          };
        },
        // Server-side seat enforcement. The invite UI disables the button at
        // the limit, but this is the authoritative check — it blocks invites
        // that would exceed the plan's maxSeats regardless of how they're
        // triggered. Mirrors organization.checkSeatAvailability: counts
        // current members + pending invitations against the seat allowance.
        async beforeCreateInvitation({ invitation, organization: org }) {
          const orgId = invitation.organizationId;
          const email = invitation.email.toLowerCase();

          // Domain whitelist — checked here (before the invitation row is
          // created) rather than in sendInvitationEmail, so a disallowed
          // invite never leaves an orphaned pending row in the DB.
          // Case-insensitive, and tolerant of metadata that Better-Auth stored
          // as a JSON string (getAllowedDomains parses + lowercases). `email`
          // is already lowercased above, so the domain compares cleanly.
          const allowedDomains = getAllowedDomains(org.metadata);
          if (allowedDomains.length > 0) {
            const domain = email.split("@")[1];
            if (!domain) {
              throw new Error(
                await tr("sharedLabels", "orgInvite.invalidEmail"),
              );
            }
            if (!allowedDomains.includes(domain)) {
              throw new Error(
                await tr("sharedLabels", "orgInvite.domainNotAllowed", {
                  domain,
                }),
              );
            }
          }

          // Reject if the email is already a member of the org.
          const existingMember = await db
            .select({ id: schema.members.id })
            .from(schema.members)
            .innerJoin(schema.users, eq(schema.members.userId, schema.users.id))
            .where(
              and(
                eq(schema.members.organizationId, orgId),
                sql`lower(${schema.users.email}) = ${email}`,
              ),
            )
            .limit(1);
          if (existingMember.length > 0) {
            throw new Error(
              await tr("sharedLabels", "orgInvite.alreadyMember"),
            );
          }

          // Reject if a pending invitation already exists for this email.
          const existingInvite = await db.query.invitations.findFirst({
            where: and(
              eq(schema.invitations.organizationId, orgId),
              eq(schema.invitations.status, "pending"),
              sql`lower(${schema.invitations.email}) = ${email}`,
            ),
            columns: { id: true },
          });
          if (existingInvite) {
            throw new Error(
              await tr("sharedLabels", "orgInvite.alreadyInvited"),
            );
          }

          // Multibrand: users.email er unik på tværs af brands, så en konto
          // på et andet brand kan aldrig acceptere (beforeAcceptInvitation).
          // Afvis før pladstjekket, så der ikke købes en plads til ingen.
          // Neutral tekst: brandet nævnes ikke. APIError, så teksten når
          // frem til invitationsdialogen (et rent Error bliver en tom 500).
          const inviteeBrand = await brandOfUser({ email });
          if (
            inviteeBrand !== null &&
            toBrandKey(inviteeBrand) !== toBrandKey(await brandOfOrg(orgId))
          ) {
            throw new APIError("BAD_REQUEST", {
              message: await tr("sharedLabels", "orgInvite.otherBrand"),
            });
          }

          // Kun gyldige invitationer optager en plads — udløbne bliver
          // hængende som "pending" og må hverken blokere en ny invitation
          // eller koste en betalt plads (se billing/seat-usage.ts).
          const pendingInvites = await db
            .select({ count: sql<number>`count(*)::int` })
            .from(schema.invitations)
            .where(
              and(
                eq(schema.invitations.organizationId, orgId),
                eq(schema.invitations.status, "pending"),
                gt(schema.invitations.expiresAt, new Date()),
              ),
            );

          const { maxSeats, isFree } = await resolveOrgSeatPolicy(orgId);
          const seatsUsed =
            (await countOrgMembers(orgId)) + (pendingInvites[0]?.count ?? 0);

          // Gratis kan ikke købe pladser — afvis med opgraderingsbesked.
          if (isFree && seatsUsed >= maxSeats) {
            throw new Error(
              await tr("sharedLabels", "freeSeatLimit", {
                seats: FREE_MAX_SEATS,
              }),
            );
          }
          if (seatsUsed >= maxSeats) {
            // Team/Business med pladsabonnement i Alunta: hæv pladserne
            // automatisk med én i stedet for at afvise (Mads 8/9-2026).
            const expanded = await tryAutoExpandSeats(orgId);
            if (!expanded.expanded) {
              console.warn(
                `[Seats] Auto-udvidelse afvist for org ${orgId}: ${expanded.reason}`,
              );
              throw new Error(
                await tr("sharedLabels", "orgInvite.noSeats", {
                  used: seatsUsed,
                  max: maxSeats,
                }),
              );
            }
            console.log(
              `[Seats] Auto-udvidet org ${orgId} til ${expanded.newMaxSeats} pladser (Alunta quantity ${expanded.newQuantity})`,
            );
          }
        },
        // Block accepting an invitation when the org has no free member seat
        // (e.g. the plan was downgraded after the invite was sent). Counts
        // members only — the pending invite being accepted is about to become
        // one. Closes the over-seat race that beforeCreateInvitation can't.
        async beforeAcceptInvitation({ invitation, user }) {
          const orgId = invitation.organizationId;
          // Multibrand: en konto kan kun blive medlem af en organisation på
          // sit eget brand (ellers et medlemskab, kontoen ikke kan logge ind
          // til). Neutral fejl som ved login på forkert brand.
          if (isHostAuthEnabled()) {
            const [org] = await db
              .select({ brand: schema.organizations.brand })
              .from(schema.organizations)
              .where(eq(schema.organizations.id, orgId))
              .limit(1);
            const userBrand = await brandOfUser({ id: user.id });
            if (!org || toBrandKey(org.brand) !== toBrandKey(userBrand)) {
              throw new APIError("FORBIDDEN", {
                code: WRONG_BRAND_CODE,
                message: WRONG_BRAND_MESSAGE,
              });
            }
          }
          const [maxSeats, memberCount] = await Promise.all([
            resolveOrgMaxSeats(orgId),
            countOrgMembers(orgId),
          ]);
          if (memberCount >= maxSeats) {
            throw new Error(
              await tr("sharedLabels", "orgInvite.noSeatsAccept"),
            );
          }
        },
        // Record invitation acceptance in the org audit log (the invite/cancel
        // actions are logged from the UI, but accept happens here).
        async afterAcceptInvitation({ invitation, user, organization: org }) {
          await logOrgAudit(db, org.id, user.id, "invitation_accepted", {
            targetEmail: invitation.email,
          });
          // An invited member joins an org the admin already set up
          // (subscription + imported data), so they must NOT be forced through
          // subscription/payment/import onboarding, and must not hit the
          // "no active subscription" paywall. Marking onboarding complete and
          // switching their active org to the one they just joined makes their
          // whole context inherit the org's (trialing) subscription.
          await Promise.all([
            db
              .update(schema.users)
              .set({ onboardingCompleted: true })
              .where(eq(schema.users.id, user.id)),
            db
              .update(schema.sessions)
              .set({ activeOrganizationId: org.id })
              .where(eq(schema.sessions.userId, user.id)),
          ]);

          // Notify the inviter that their invitee joined (best-effort).
          const inviterId = (invitation as { inviterId?: string }).inviterId;
          if (inviterId && inviterId !== user.id) {
            const { pushToUser } = await import("./notifications/push");
            const inviter = await db.query.users.findFirst({
              where: eq(schema.users.id, inviterId),
              columns: { locale: true },
            });
            await pushToUser(inviterId, {
              title: await tr(
                "sharedLabels",
                "orgInvite.acceptedPushTitle",
                undefined,
                inviter?.locale,
              ),
              body: await tr(
                "sharedLabels",
                "orgInvite.acceptedPushBody",
                { name: user.name || invitation.email, org: org.name },
                inviter?.locale,
              ),
              url: "/dashboard/organization",
              tag: `invite-accepted-${invitation.id}`,
              data: { type: "invitation_accepted", orgId: org.id },
            });
          }
        },
        // Prevent removing the last owner, which would leave the org with no
        // one able to manage it. Ownership must be transferred first.
        async beforeRemoveMember({ member }) {
          if (member.role !== "owner") return;
          const owners = await db
            .select({ count: sql<number>`count(*)::int` })
            .from(schema.members)
            .where(
              and(
                eq(schema.members.organizationId, member.organizationId),
                eq(schema.members.role, "owner"),
              ),
            );
          if ((owners[0]?.count ?? 0) <= 1) {
            throw new Error(
              await tr("sharedLabels", "orgInvite.lastOwnerRemove"),
            );
          }
        },
        // Prevent demoting the last owner. beforeRemoveMember guards removal,
        // but a role change from owner→admin/member could otherwise strand the
        // org with no owner (nobody able to manage billing, transfer ownership,
        // or delete the org). Mirror the last-owner count check here.
        async beforeUpdateMemberRole({ member, newRole }) {
          if (member.role !== "owner" || newRole === "owner") return;
          const owners = await db
            .select({ count: sql<number>`count(*)::int` })
            .from(schema.members)
            .where(
              and(
                eq(schema.members.organizationId, member.organizationId),
                eq(schema.members.role, "owner"),
              ),
            );
          if ((owners[0]?.count ?? 0) <= 1) {
            throw new Error(
              await tr("sharedLabels", "orgInvite.lastOwnerDemote"),
            );
          }
        },
        // Revoke the removed member's org-scoped API keys so a departed member
        // can't keep programmatic access to the org's data.
        async afterRemoveMember({ member, organization: org }) {
          // Pladser følger forbrug: skru Aluntas seats-add-on ned med det
          // samme, så kunden ikke betaler for en tom plads (Mads 8/9-2026).
          void syncSeatsToUsage(org.id, { reason: "medlem fjernet" }).catch(
            (err) =>
              console.warn(
                `[Seats] Nedjustering efter medlemsfjernelse fejlede for org ${org.id}:`,
                err,
              ),
          );

          await db
            .update(schema.apiKeys)
            .set({ isRevoked: true, revokedAt: new Date() })
            .where(
              and(
                eq(schema.apiKeys.userId, member.userId),
                eq(schema.apiKeys.organizationId, org.id),
                eq(schema.apiKeys.isRevoked, false),
              ),
            );

          // Remove the departed member's employee profile so it doesn't linger
          // as an orphan in HR lists, head counts, or as a manager for others.
          // The managerId FK on employee_profiles is ON DELETE SET NULL, so any
          // direct reports are detached cleanly. memberRates cascade via the
          // members-row deletion Better-Auth already performed.
          await db
            .delete(schema.employeeProfiles)
            .where(
              and(
                eq(schema.employeeProfiles.userId, member.userId),
                eq(schema.employeeProfiles.organizationId, org.id),
              ),
            );

          // Unassign the departed member's tasks in this org. The FK is ON
          // DELETE SET NULL, but removing a member does NOT delete the user, so
          // without this the tasks dangle as "assigned to a non-member" and
          // can't be reassigned via the normal UI.
          await db
            .update(schema.tasks)
            .set({ assignedToUserId: null })
            .where(
              and(
                eq(schema.tasks.assignedToUserId, member.userId),
                eq(schema.tasks.organizationId, org.id),
              ),
            );
        },
      },
      async sendInvitationEmail({ invitation, organization: org, inviter }) {
        // Domain whitelist + seat + duplicate checks run in
        // organizationHooks.beforeCreateInvitation (before the row is created).

        // Build invite URL
        const inviteUrl = `${b.baseURL}/auth/accept-invitation?token=${invitation.id}`;

        // Send invitation email
        await sendOrganizationInviteEmail({
          to: invitation.email,
          inviterName: inviter.user.name,
          organizationName: org.name,
          inviteUrl,
          role: invitation.role,
          // Mailen følger organisationens brand (afsender, navn, links).
          brand: await brandOfOrg(org.id),
        });
      },
    }),

    // Magic Link plugin for passwordless email login
    magicLink({
      sendMagicLink: async ({ email, url }) => {
        // Findes kontoen på et andet brand, sendes intet (svaret er det samme).
        const userBrand = await brandOfUser({ email });
        if (userBrand && isWrongBrand(userBrand, b.key)) return;
        await sendMagicLinkEmail({
          to: email,
          magicLinkUrl: url,
          // Ny konto via linket får sitets brand (user.create.before).
          brand: userBrand ?? b.key,
        });
      },
      expiresIn: 60 * 15, // 15 minutes
      // GHSA-965c-763c-88jm: with plain tokens an OAuth state value is accepted
      // as a magic link token. Hashed tokens close that path until better-auth
      // 1.7.7 (#624). Global verification.storeIdentifier must stay unset.
      storeToken: "hashed",
    }),

    // Phone number plugin for SMS login. Kun standardinstansen: TimeWren har
    // hverken SMS-login eller -signup (/api/auth/providers melder phone: false).
    ...(b.key === DEFAULT_BRAND_KEY
      ? [
          phoneNumber({
            sendOTP: async ({ phoneNumber: phone, code }) => {
              if (isDemoMode()) {
                logDemoSuppressed("SMS");
                return;
              }
              // MessageBird SMS sending
              const messagebirdApiKey = process.env.MESSAGEBIRD_API_KEY;
              if (!messagebirdApiKey) {
                console.error("MESSAGEBIRD_API_KEY is not configured");
                throw new Error(
                  "SMS service not configured. Contact administrator to set up MESSAGEBIRD_API_KEY.",
                );
              }

              try {
                // Dynamic import to avoid build issues if not installed
                const messagebird = await import("messagebird").then((m) =>
                  m.default(messagebirdApiKey),
                );

                await new Promise<void>((resolve, reject) => {
                  messagebird.messages.create(
                    {
                      originator:
                        process.env.MESSAGEBIRD_ORIGINATOR || b.shortName,
                      recipients: [phone],
                      body: `Din ${b.appName} kode er: ${code}`,
                    },
                    (err: Error | null) => {
                      if (err) {
                        console.error("MessageBird error:", err);
                        reject(err);
                      } else {
                        resolve();
                      }
                    },
                  );
                });
              } catch (error) {
                console.error("SMS sending error:", error);
                throw new Error("Failed to send SMS verification code");
              }
            },
            otpLength: 6,
            expiresIn: 60 * 5, // 5 minutes
            signUpOnVerification: {
              getTempEmail: (phone: string) => {
                // Generate temporary email for phone-only users
                const digits = phone.replace(/\D/g, "");
                return `phone-${digits}@phone.${getEmailDomain()}`;
              },
            },
          }),
        ]
      : []),

    // Passkey plugin for WebAuthn/biometric login
    passkey({
      rpName: b.appName,
      rpID: b.rpID,
    }),

    // Two-Factor Authentication plugin
    twoFactor({
      issuer: b.appName,
      totpOptions: {
        digits: 6,
        period: 30,
      },
      backupCodeOptions: {
        length: 10, // 10 backup codes
      },
      // Optional: Send 2FA code via email as fallback
      otpOptions: {
        async sendOTP({ user, otp }) {
          await sendTwoFactorCodeEmail({
            to: user.email,
            userName: user.name,
            code: otp,
            userId: user.id,
            brand: await brandOfUser({ id: user.id }),
          });
        },
      },
    }),

    // OAuth 2.1-autorisationsserver til MCP-endpointet (#912): DCR, CIMD,
    // PKCE, refresh, revoke og samtykke med org-valg. Se auth/mcp-oauth.ts.
    ...mcpOAuthPlugins(mcpOAuthDeps),
  ],

  hooks: {
    // "Kun SSO" (E12, #470): brugere på et verificeret domæne med politikken
    // slået til må ikke logge ind/oprette sig med e-mail/password eller magic
    // link — kun via Microsoft. Kun aktiv når Microsoft-login er konfigureret,
    // så en fejlkonfiguration aldrig kan lukke et helt domæne ude.
    before: createAuthMiddleware(async (ctx) => {
      // Offentlig demo: ingen signup, OAuth, magic link, SMS eller mails til
      // vilkårlige adresser. Demobrugere oprettes af POST /api/demo/start.
      if (isDemoMode() && isDemoBlockedAuthPath(ctx.path)) {
        throw new APIError("FORBIDDEN", {
          message: "Not available in the demo",
        });
      }
      // Multibrand: en ubekræftet, ubrugt konto på det andet brand må ikke
      // spærre adressen her (auth/stale-signup.ts). Fejler oprydningen, får
      // signup det sædvanlige dubletsvar.
      if (
        (ctx.path === "/sign-up/email" || ctx.path === "/sign-in/magic-link") &&
        isHostAuthEnabled()
      ) {
        const email = (ctx.body as { email?: unknown })?.email;
        if (typeof email === "string") {
          try {
            await removeStaleOtherBrandSignup(db, email, b.key);
          } catch (error) {
            console.error(
              "[Auth] Oprydning af ubekræftet konto fejlede:",
              error,
            );
          }
        }
      }
      // Multibrand: en ubekræftet konto på et andet brand ville ellers få
      // EMAIL_NOT_VERIFIED (før session.create.before) og dermed afsløre, at
      // adressen findes. Samme svar som en ukendt adresse, også i tid.
      if (ctx.path === "/sign-in/email" && isHostAuthEnabled()) {
        const body = ctx.body as { email?: unknown; password?: unknown };
        if (typeof body?.email === "string") {
          const row = await userBrandAndVerified(body.email);
          if (row && !row.emailVerified && isWrongBrand(row.brand, b.key)) {
            await ctx.context.password.hash(String(body.password ?? ""));
            throw new APIError("UNAUTHORIZED", {
              code: "INVALID_EMAIL_OR_PASSWORD",
              message: "Invalid email or password",
            });
          }
        }
      }
      if (!microsoftLoginConfigured(b.key)) return;
      if (!isNonSsoSignInPath(ctx.path)) return;
      // /phone-number/verify bruges også af allerede indloggede brugere til
      // at bekræfte et nyt nummer — kun login-varianten (ingen session) blokeres.
      if (
        ctx.path === "/phone-number/verify" &&
        (await getSessionFromCtx(ctx))
      ) {
        return;
      }
      const email = await resolveLoginEmail(ctx.body);
      if (!email) return;
      const match = await findVerifiedOrgForEmail(db, email);
      if (match?.requireSsoForDomains) {
        throw new APIError("FORBIDDEN", { message: SSO_REQUIRED_MESSAGE });
      }
    }),
    // Sociale providers (Google/GitHub/Discord) har ingen e-mail i body før
    // callback — derfor tjekkes de EFTER at sessionen er oprettet: sessionen
    // slettes og brugeren sendes tilbage til login med forklaring. En helt ny
    // bruger (kun denne konto, ingen medlemskaber) slettes også, så Microsoft-
    // login bagefter kan oprette kontoen rent (Microsoft er bevidst ikke
    // trusted provider → auto-link på e-mail ville ellers fejle).
    after: createAuthMiddleware(async (ctx) => {
      if (!microsoftLoginConfigured(b.key)) return;
      if (!callbackBypassesSso(ctx.path, ctx.params, ctx.body)) return;
      const newSession = ctx.context.newSession;
      if (!newSession) return;

      // Fail-open for domæner UDEN kun-SSO (en uventet fejl må aldrig ramme
      // alle sociale logins) — men fail-closed så snart et match er fundet:
      // afvis altid, også hvis oprydningen fejler.
      let matched = false;
      try {
        const match = await findVerifiedOrgForEmail(db, newSession.user.email);
        if (!match?.requireSsoForDomains) return;
        matched = true;

        const userId = newSession.user.id;
        await ctx.context.internalAdapter.deleteSession(
          newSession.session.token,
        );
        const [accountRows, memberRows] = await Promise.all([
          db
            .select({ id: schema.accounts.id })
            .from(schema.accounts)
            .where(eq(schema.accounts.userId, userId)),
          db
            .select({ id: schema.members.id })
            .from(schema.members)
            .where(eq(schema.members.userId, userId)),
        ]);
        if (
          shouldDeleteRejectedNewUser({
            accountCount: accountRows.length,
            membershipCount: memberRows.length,
            createdAt: new Date(newSession.user.createdAt),
          })
        ) {
          // session → account → user i den rækkefølge FK'erne (ON DELETE NO
          // ACTION, migration 0017) kræver. Et direkte delete på users ville
          // fejle med 23503 og efterlade en orphan Google-konto, som så
          // blokerer Microsoft-login med "account not linked".
          await ctx.context.internalAdapter.deleteUser(userId);
          const [still] = await db
            .select({ id: schema.users.id })
            .from(schema.users)
            .where(eq(schema.users.id, userId))
            .limit(1);
          if (still) {
            console.error(
              "[kun-sso] rejected signup still exists after deleteUser:",
              userId,
            );
          }
        }
      } catch (error) {
        console.error("[kun-sso] callback policy hook failed:", error);
        if (!matched) return;
      }
      // Id-token-login (mobilappen) er et JSON-kald: svar med en fejl, som
      // klienten kan vise, i stedet for en redirect til login-siden.
      if (ctx.path === "/sign-in/social") {
        throw new APIError("FORBIDDEN", { message: SSO_REQUIRED_MESSAGE });
      }
      const params = new URLSearchParams({ error: "sso_required" });
      throw ctx.redirect(`${b.baseURL}/login?${params.toString()}`);
    }),
  },

  databaseHooks: {
    organization: {
      create: {
        after: async (org: { id: string }) => {
          // Seed opt-in core modules for every new organization so the
          // owner lands on a functional dashboard. Enterprise orgs can
          // be configured later via the admin panel.
          try {
            await seedNewOrgModules(db, org.id);
          } catch (error) {
            console.error("Failed to seed modules for new org:", org.id, error);
          }
        },
      },
    },
    user: {
      create: {
        before: async (user, context) => {
          const domain = user.email?.split("@")[1]?.toLowerCase();
          if (domain) {
            const banned = await db
              .select({ id: bannedDomains.id })
              .from(bannedDomains)
              .where(eq(bannedDomains.domain, domain))
              .limit(1);
            if (banned.length > 0) {
              throw new Error(
                "Registrering er ikke mulig med denne email-adresse",
              );
            }
          }
          // Multibrand: kontoen får sitets brand i samme insert. Kun
          // ikke-standardbrands skrives; timetrack bruger kolonnens default.
          // Sproget ligeså (ellers "da" fra kolonnens default).
          const stamped =
            isHostAuthEnabled() && b.key !== DEFAULT_BRAND_KEY
              ? {
                  ...user,
                  brand: b.key,
                  locale: signupLocale(
                    getBrandConfigsSafe()[b.key],
                    context?.headers ?? context?.request?.headers,
                  ),
                }
              : user;
          // Verifikation slået fra (selvhosting uden mail): ingen kan bekræfte
          // adressen, så kontoen markeres som bekræftet fra start.
          if (!isEmailVerificationRequired()) {
            return { data: { ...stamped, emailVerified: true } };
          }
          return { data: stamped };
        },
        after: async (user, context) => {
          // Admin-bootstrap (ADMIN_EMAIL / første bruger). Må ikke vælte signup.
          try {
            await bootstrapAdmin(db, user.id);
          } catch (error) {
            console.error("Admin-bootstrap fejlede ved signup:", error);
          }

          // Brandet er stemplet i user.create.before (samme insert).
          const signupBrand: BrandKey =
            isHostAuthEnabled() && b.key !== DEFAULT_BRAND_KEY
              ? b.key
              : DEFAULT_BRAND_KEY;

          // Sproget fra oprettelsen (sprogvælger-cookie, ellers browseren),
          // så appen og mailene ikke skifter til kolonnens "da" efter login.
          // TimeWren Cloud har sat det i samme insert. Før velkomstmailen,
          // som læser users.locale. Må ikke vælte signup.
          let savedLocale: string | null = null;
          if (signupBrand === DEFAULT_BRAND_KEY) {
            try {
              const locale = signupLocaleFromRequest(
                context?.headers ?? context?.request?.headers,
              );
              if (locale && locale !== "da") {
                await db
                  .update(schema.users)
                  .set({ locale })
                  .where(eq(schema.users.id, user.id));
                savedLocale = locale;
              }
            } catch (error) {
              console.error("Failed to save signup locale:", error);
            }
          }

          // Persist signup attribution from the tt_attr cookie. Non-blocking.
          try {
            const cookieHeader =
              context?.request?.headers?.get?.("cookie") ?? null;
            const match = cookieHeader?.match(/tt_attr=([^;]+)/);
            if (match) {
              const attr = JSON.parse(decodeURIComponent(match[1])) as {
                source?: string;
                medium?: string;
                campaign?: string;
                referrer?: string;
                landingPage?: string;
                gclid?: string;
              };
              await db
                .update(schema.users)
                .set({
                  attrSource: attr.source ?? null,
                  attrMedium: attr.medium ?? null,
                  attrCampaign: attr.campaign ?? null,
                  attrReferrer: attr.referrer ?? null,
                  attrLandingPage: attr.landingPage ?? null,
                  attrGclid: attr.gclid ?? null,
                })
                .where(eq(schema.users.id, user.id));
            }
          } catch (error) {
            console.error("Failed to save signup attribution:", error);
          }

          // Send welcome email to new users. Guard with a dedup check so a
          // retried user.create hook can't send the welcome email twice.
          try {
            const alreadyWelcomed = await wasEmailSentRecently(
              user.id,
              "drip_welcome",
              24 * 60 * 60 * 1000,
            );
            if (!alreadyWelcomed && signupBrand !== "timetrack") {
              // Brand-bevidst velkomstmail (afsender, navn, links, sprog).
              await sendWelcomeEmail({
                to: user.email,
                name: user.name,
                brand: signupBrand,
                userId: user.id,
              });
            } else if (!alreadyWelcomed) {
              await sendDripWelcomeEmail({
                to: user.email,
                userName: user.name,
                userId: user.id,
              });
            }
          } catch {
            console.error("Failed to send welcome email", { userId: user.id });
          }

          // Notify admin of new signup
          notifyAdmin("signup", {
            userName: user.name,
            userEmail: user.email,
            userId: user.id,
          });

          // Invited users (a pending invitation exists for their email) join an
          // existing org — they must NOT also get a personal workspace, since a
          // sub-less personal org would become their active org and trigger the
          // onboarding/paywall gates.
          // Multibrand: kun invitationer til organisationer på kontoens brand.
          // En TimeWren-tilmelding må ikke bruge en TimeTrack-invitation (og
          // en plads i kundens organisation), som kontoen ikke kan logge ind på.
          const [pendingInvite] = await db
            .select({
              id: schema.invitations.id,
              organizationId: schema.invitations.organizationId,
              role: schema.invitations.role,
            })
            .from(schema.invitations)
            .innerJoin(
              schema.organizations,
              eq(schema.organizations.id, schema.invitations.organizationId),
            )
            .where(
              and(
                eq(schema.invitations.status, "pending"),
                sql`lower(${schema.invitations.email}) = ${user.email.toLowerCase()}`,
                isHostAuthEnabled()
                  ? eq(schema.organizations.brand, signupBrand)
                  : undefined,
              ),
            )
            .orderBy(desc(schema.invitations.createdAt))
            .limit(1);
          if (pendingInvite) {
            // Auto-accept the pending invitation at signup. Better-Auth's
            // afterAcceptInvitation only fixes up the member when they click the
            // accept-invitation link; an invited user who registers directly
            // (e.g. "Log ind med Google" from the normal login page) would
            // otherwise land org-less — no personal workspace (skipped here) and
            // no membership — stuck in the onboarding/paywall wizard. Mirror
            // afterAcceptInvitation so they join the org and inherit its
            // (trialing) subscription. Respect the seat limit; on any failure we
            // still return (no personal workspace) so the user can accept the
            // invite manually rather than getting a sub-less owner org.
            try {
              const orgId = pendingInvite.organizationId;
              const [maxSeats, memberCount] = await Promise.all([
                resolveOrgMaxSeats(orgId),
                countOrgMembers(orgId),
              ]);
              if (memberCount < maxSeats) {
                await db.transaction(async (tx) => {
                  await tx.insert(schema.members).values({
                    id: crypto.randomUUID(),
                    organizationId: orgId,
                    userId: user.id,
                    role: pendingInvite.role || "member",
                  });
                  await tx
                    .update(schema.invitations)
                    .set({ status: "accepted" })
                    .where(eq(schema.invitations.id, pendingInvite.id));
                  await tx
                    .update(schema.users)
                    .set({ onboardingCompleted: true })
                    .where(eq(schema.users.id, user.id));
                  await tx
                    .update(schema.sessions)
                    .set({ activeOrganizationId: orgId })
                    .where(eq(schema.sessions.userId, user.id));
                });
                await logOrgAudit(db, orgId, user.id, "invitation_accepted", {
                  targetEmail: user.email,
                });
              }
            } catch (error) {
              console.error(
                "Failed to auto-accept pending invite at signup:",
                user.id,
                error,
              );
            }
            return;
          }

          // Verificeret domæne (E12, #470): brugeren auto-joines i
          // session.create-hooken, hvor Microsoft-kontoen (tenant-claim)
          // findes. Ingen personlig workspace — den ville blive aktiv org og
          // skygge for enterprise-org'en. Fallback hvis joinet afvises: se
          // session.create.
          try {
            // Multibrand: kun en organisation på kontoens brand (som i
            // autoJoinUserToVerifiedOrg), ellers får kontoen sin egen workspace.
            const domainBrand = isHostAuthEnabled() ? signupBrand : undefined;
            if (await findVerifiedOrgForEmail(db, user.email, domainBrand)) {
              return;
            }
          } catch (error) {
            console.error("[auto-join] domain lookup failed:", user.id, error);
          }

          await createPersonalWorkspace({
            ...user,
            brand: signupBrand,
            locale: (user as { locale?: string | null }).locale ?? savedLocale,
          });
        },
      },
    },
    account: {
      // better-auths encryptOAuthTokens dækker ikke idToken — det krypteres
      // her med ENCRYPTION_KEY (#710) og læses via readStoredIdToken.
      create: {
        before: encryptIdTokenBeforeWrite,
      },
      update: {
        before: encryptIdTokenBeforeWrite,
        after: async (account) => {
          // Send "password changed" email — but ONLY when a password actually
          // changed. Better-Auth rewrites the account row on every login for
          // OAuth/social providers (refreshing access/refresh/id tokens), which
          // previously triggered a bogus "password changed" email on each
          // sign-in. OAuth accounts have no password (it is NULL), so guarding
          // on `account.password` filters out those token refreshes. Credential
          // accounts only have their row updated when the password is set, so
          // this still fires for genuine password changes/resets.
          if (!account.password) return;

          try {
            const user = await db.query.users.findFirst({
              where: (users, { eq }) => eq(users.id, account.userId),
            });

            if (!user) return;

            // Check email preferences
            const prefs = await db.query.emailPreferences.findFirst({
              where: (emailPreferences, { eq }) =>
                eq(emailPreferences.userId, account.userId),
            });

            // Skip if user has disabled password change notifications
            if (prefs && prefs.passwordChanged === false) return;

            // Defense in depth: never send more than one password-changed email
            // within a short window, even if the row is written repeatedly.
            if (
              await wasEmailSentRecently(
                account.userId,
                "password_changed",
                10 * 60 * 1000,
              )
            ) {
              return;
            }

            await sendPasswordChangedEmail({
              to: user.email,
              userName: user.name,
              changedAt: new Date(),
              userId: user.id,
              brand: user.brand,
            });
          } catch (error) {
            console.error("Failed to send password changed email:", error);
          }
        },
      },
    },
    session: {
      create: {
        // Multibrand: en konto kan kun logge ind på sit eget brands site
        // (alle metoder: adgangskode, magic link, OAuth, passkey, SMS). Admin-
        // impersonation er undtaget (support). Uden flagene en no-op.
        before: async (session, context) => {
          if (!isHostAuthEnabled()) return;
          if ((session as { impersonatedBy?: string | null }).impersonatedBy) {
            return;
          }
          const userBrand = await brandOfUser({ id: session.userId });
          if (userBrand === null || !isWrongBrand(userBrand, b.key)) return;
          if (context && isRedirectFlow(context.path)) {
            throw context.redirect(
              `${b.baseURL}/login?error=${WRONG_BRAND_QUERY}`,
            );
          }
          // Adgangskode-login: samme svar som en forkert adgangskode, ellers
          // afslører en særlig fejl, at adgangskoden til en konto på det
          // andet brand er rigtig.
          if (context?.path === "/sign-in/email") {
            throw new APIError("UNAUTHORIZED", {
              code: "INVALID_EMAIL_OR_PASSWORD",
              message: "Invalid email or password",
            });
          }
          throw new APIError("UNAUTHORIZED", {
            code: WRONG_BRAND_CODE,
            message: WRONG_BRAND_MESSAGE,
          });
        },
        after: async (session) => {
          // Admin-bootstrap ved login (efter at adressen er bekræftet).
          try {
            await bootstrapAdmin(db, session.userId);
          } catch (error) {
            console.error("Admin-bootstrap fejlede ved login:", error);
          }

          // Don't alert the user when an admin impersonates / takes over their
          // account — it isn't a real login by the user, so a "new device"
          // warning would be confusing and misleading. Impersonation sessions
          // carry the admin's id in impersonatedBy.
          if (session.impersonatedBy) return;

          // Domæne-auto-join (E12, #470). Idempotent — eksisterende medlem
          // er uændret. Kører her (ikke i user.create) fordi Microsoft-
          // kontoen med tenant-claim først findes når sessionen oprettes.
          try {
            const result = await autoJoinUserToVerifiedOrg(db, session.userId);
            if (
              !result.joined &&
              (result.reason === "tenant_mismatch" ||
                result.reason === "email_not_proven" ||
                result.reason === "no_seats")
            ) {
              // user.create skippede den personlige workspace i forventning
              // om auto-join. Afvist → sørg for at brugeren ikke er org-løs.
              const anyMembership = await db.query.members.findFirst({
                where: eq(schema.members.userId, session.userId),
                columns: { id: true },
              });
              if (!anyMembership) {
                const user = await db.query.users.findFirst({
                  where: eq(schema.users.id, session.userId),
                  columns: {
                    id: true,
                    name: true,
                    email: true,
                    brand: true,
                    locale: true,
                  },
                });
                if (user) await createPersonalWorkspace(user);
              }
            }
          } catch (error) {
            console.error("[auto-join] failed:", session.userId, error);
          }

          // Send new login alert email
          try {
            const user = await db.query.users.findFirst({
              where: (users, { eq }) => eq(users.id, session.userId),
            });

            if (!user) return;

            // Check email preferences
            const prefs = await db.query.emailPreferences.findFirst({
              where: (emailPreferences, { eq }) =>
                eq(emailPreferences.userId, session.userId),
            });

            // Skip if user has disabled login alerts
            if (prefs && prefs.newLoginAlert === false) return;

            // Skip for first-time login (user hasn't completed onboarding yet)
            if (!user.onboardingCompleted) return;

            // Deduplicate so routine logins don't spam the user. Better-Auth
            // fires this hook on every genuine sign-in.
            const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
            const canFingerprint = Boolean(
              session.ipAddress && session.userAgent,
            );

            if (canFingerprint) {
              // We can identify the device — only alert when it's a device we
              // have NOT seen in the last 24h (i.e. a genuinely new login).
              const recentSessions = await db.query.sessions.findMany({
                where: (sessions, { eq, and, gte }) =>
                  and(
                    eq(sessions.userId, session.userId),
                    gte(sessions.createdAt, oneDayAgo),
                  ),
                columns: {
                  id: true,
                  ipAddress: true,
                  userAgent: true,
                },
              });

              const knownDevice = recentSessions.some(
                (s) =>
                  s.id !== session.id &&
                  s.ipAddress === session.ipAddress &&
                  s.userAgent === session.userAgent,
              );

              if (knownDevice) return;
            } else {
              // No IP/user-agent to fingerprint the device (e.g. behind a proxy
              // that strips them). Fall back to a hard rate cap so we never send
              // more than one new-login alert per 24h.
              if (
                await wasEmailSentRecently(
                  session.userId,
                  "new_login",
                  24 * 60 * 60 * 1000,
                )
              ) {
                return;
              }
            }

            await sendNewLoginEmail({
              to: user.email,
              userName: user.name,
              loginAt: new Date(),
              ipAddress: session.ipAddress || undefined,
              userAgent: session.userAgent || undefined,
              userId: user.id,
              brand: user.brand,
            });
          } catch (error) {
            // Log error but don't fail login
            console.error("Failed to send new login email:", error);
          }
        },
      },
    },
  },
}));

export const auth = betterAuth(authOptions(DEFAULT_AUTH));

const brandAuths: Partial<Record<BrandKey, typeof auth>> = {};

/**
 * Auth-instansen for et brand. Uden MULTIBRAND_ENABLED=1 og
 * TIMEWREN_APP_ENABLED=1 (og for timetrack) altid standardinstansen. Brug den
 * til kald, der bygger links eller sætter cookies for en bestemt konto.
 */
export function authForBrand(key: string | null | undefined): typeof auth {
  const k = toBrandKey(key);
  if (k === DEFAULT_BRAND_KEY || !isHostAuthEnabled()) return auth;
  brandAuths[k] ??= betterAuth(
    authOptions(brandAuthParams(getBrandConfigsSafe()[k], getBrand(k))),
  );
  return brandAuths[k];
}

/** Auth-instansen for en request-host (route-handleren /api/auth). */
export function authForHost(host: string | null | undefined): typeof auth {
  return authForBrand(authBrandForHost(host));
}

export type Session = typeof auth.$Infer.Session;
