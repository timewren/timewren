/**
 * Hvad den offentlige demo (DEMO_MODE=1) spærrer. Alt står her, så listen
 * kan læses ét sted (docs/demo.md beskriver den). Kaldes kun i demo-tilstand.
 */

/**
 * Better-auth-endpoints uden for demoen: signup, OAuth, magic link, SMS og
 * alt der sender til en vilkårlig adresse. Demobrugere oprettes kun af
 * POST /api/demo/start. Præfikser, så undervarianter også rammes.
 */
const BLOCKED_AUTH_PREFIXES = [
  "/sign-up",
  "/sign-in/social",
  "/sign-in/oauth2",
  "/sign-in/magic-link",
  "/magic-link",
  "/sign-in/phone-number",
  "/phone-number",
  "/sign-in/email-otp",
  "/email-otp",
  "/request-password-reset",
  "/forget-password",
  "/send-verification-email",
  "/change-email",
  "/link-social",
  "/oauth2/link",
  // Ingen deling mellem demokonti: hver sandbox har præcis ét medlem, så
  // oprydningen altid kan slette kontoen og dens organisation helt (en
  // eneste ejer af et team afvises med owner_must_transfer).
  "/organization/invite-member",
  "/organization/accept-invitation",
];

export function isDemoBlockedAuthPath(path: string): boolean {
  return BLOCKED_AUTH_PREFIXES.some(
    (p) => path === p || path.startsWith(`${p}/`),
  );
}

/**
 * tRPC-procedurer, der i demoen svarer "ikke tilgængelig i demoen": betaling,
 * forbindelse til regnskab og kalender, AI med betalte API'er, udgående
 * webhooks og notifikationskanaler, egne domæner, API-nøgler og licenser.
 * Læsninger, der bare viser status, er ikke med.
 */
export const DEMO_BLOCKED_PROCEDURES: ReadonlySet<string> = new Set([
  // Betaling og checkout (Stripe, Alunta, butikker, desktop-licens)
  "subscription.createCheckoutSession",
  "subscription.purchaseExtraSeats",
  "subscription.createPortalSession",
  "subscription.changePlan",
  "subscription.cancel",
  "subscription.reactivate",
  "subscription.requestTrialExtension",
  "storeBilling.verifyApple",
  "storeBilling.verifyGoogle",
  "desktop.createLifetimeCheckout",
  "desktop.requestRefund",
  "desktop.resendLicenseKey",
  "desktop.refundOwnLicense",
  "aluntaKlippekort.regenerateToken",
  "aluntaKlippekort.createMapping",
  "aluntaKlippekort.updateMapping",
  // Regnskab (Billy, Dinero, e-conomic): nøgler og forbindelser
  "user.updateIntegrations",
  "integrations.testBillyConnection",
  "integrations.testDineroConnection",
  "integrations.testEconomicConnection",
  "integrations.completeDineroConnection",
  // Kalender (Google, Microsoft, iCloud) og mail-indbakke
  "calendar.getAuthUrl",
  "calendar.icloudConnect",
  "calendar.registerWebhook",
  "emailIntegration.upsertIntegration",
  "emailIntegration.testConnection",
  "emailIntegration.triggerSync",
  "emailIntegration.triggerBackfill",
  // AI (OpenAI-kald)
  "ai.parseTimeEntry",
  "ai.parseText",
  "ai.parseEmail",
  "ai.categorize",
  "ai.prioritize",
  "ai.estimateTime",
  "user.updateAISettings",
  "user.testAIConnection",
  "calendar.getAISuggestions",
  // Udgående webhooks og notifikationskanaler (Discord, Slack, push)
  "webhooks.create",
  "webhooks.update",
  "webhooks.test",
  "notifications.addDiscordWebhook",
  "notifications.addSlackWebhook",
  "notifications.testSlackWebhook",
  "notifications.testDiscordWebhook",
  "notifications.subscribePush",
  "notifications.testPush",
  // Kundeportal på eget domæne
  "portalBranding.setCustomDomain",
  "portalBranding.verifyCustomDomain",
  // API-nøgler
  "apiKeys.create",
  // Medarbejderimport opretter rigtige brugere og medlemskaber (se
  // invitationer i BLOCKED_AUTH_PREFIXES)
  "enterprise.importEmployees",
]);

export function isDemoBlockedProcedure(path: string): boolean {
  return DEMO_BLOCKED_PROCEDURES.has(path);
}
