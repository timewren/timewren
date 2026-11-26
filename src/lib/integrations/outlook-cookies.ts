/**
 * Cookies til Outlook-OAuth-flowet. Callbacken er en almindelig top-level
 * GET-redirect fra Microsoft (response_mode=query), så SameSite=Lax er nok,
 * og sessionens cookie følger også med.
 */
export const OUTLOOK_STATE_COOKIE = "outlook_oauth_state";
export const OUTLOOK_PKCE_COOKIE = "outlook_oauth_pkce";

export function outlookCookieOptions(maxAge = 600) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/api/integrations/outlook",
    maxAge,
  };
}
