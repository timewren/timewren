/**
 * Storage state med givet cookie-samtykke (kun nødvendige), så cookie-banneret
 * ikke opsnapper klik. Bruges som default i playwright.config.ts og af tests,
 * der skal køre uden login.
 */
const BASE_URL = "http://localhost:3000";

const consent = {
  necessary: true,
  analytics: false,
  marketing: false,
  timestamp: Date.now(),
  version: "1.0",
};

export const CONSENT_STATE = {
  cookies: [
    {
      name: "tt_consent",
      value: encodeURIComponent(JSON.stringify(consent)),
      domain: "localhost",
      path: "/",
      expires: -1,
      httpOnly: false,
      secure: false,
      sameSite: "Lax" as const,
    },
  ],
  origins: [
    {
      origin: BASE_URL,
      localStorage: [
        { name: "timetrack_cookie_consent", value: JSON.stringify(consent) },
      ],
    },
  ],
};
