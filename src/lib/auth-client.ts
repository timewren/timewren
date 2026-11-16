import { passkeyClient } from "@better-auth/passkey/client";
import {
  adminClient,
  magicLinkClient,
  organizationClient,
  phoneNumberClient,
  twoFactorClient,
} from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import { buildTwoFactorUrl } from "@/lib/auth/login-helpers";
import { prepareFeedbackForSignOut } from "@/lib/feedback/sign-out";
import { clearPrivateCaches } from "@/lib/pwa/private-caches";
import { appUrlEnv } from "@/lib/runtime-env";

// Get base URL from environment or fallback
const getBaseURL = () => {
  if (typeof window !== "undefined") {
    // Client-side: use window.location.origin
    return window.location.origin;
  }
  // Server-side: use env variable
  return appUrlEnv() || "http://localhost:3000";
};

export const authClient = createAuthClient({
  baseURL: getBaseURL(),
  fetchOptions: {
    credentials: "include", // Important: Include cookies in requests
    onError(context) {
      console.error("Auth client error:", context);
    },
  },
  plugins: [
    adminClient(),
    organizationClient(),
    magicLinkClient(),
    phoneNumberClient(),
    passkeyClient(),
    twoFactorClient({
      // better-auth svarer 200 { twoFactorRedirect: true } UDEN session, når
      // brugeren har 2FA slået til. Send brugeren videre til kode-siden og
      // bevar ?redirect= (fx desktop-/extension-login), valideret som intern sti.
      onTwoFactorRedirect({ twoFactorMethods }) {
        if (typeof window === "undefined") return;
        const redirect = new URLSearchParams(window.location.search).get(
          "redirect",
        );
        window.location.assign(buildTwoFactorUrl(redirect, twoFactorMethods));
      },
    }),
  ],
});

// Export individual methods for convenience
export const {
  signIn,
  signUp,
  useSession,
  requestPasswordReset,
  resetPassword,
  // Organization exports
  organization,
  useActiveOrganization,
  useListOrganizations,
} = authClient;

/**
 * Log ud og ryd service workerens private caches, så næste bruger på samme
 * enhed aldrig kan få den forriges svar serveret. Feedback i panelets
 * offline-kø sendes først (højst 1,5 s) og smides så ud, af samme grund.
 */
export const signOut: typeof authClient.signOut = (async (
  ...args: Parameters<typeof authClient.signOut>
) => {
  void clearPrivateCaches();
  await prepareFeedbackForSignOut();
  return authClient.signOut(...args);
}) as typeof authClient.signOut;

// Alias for backwards compatibility
export const forgetPassword = requestPasswordReset;
