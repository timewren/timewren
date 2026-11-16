import { create } from "zustand";
import { apiClient } from "../api/client";
import { resolveWebAppUrl } from "../config";
import { t } from "../i18n/core";
import { userErrorMessage } from "../lib/api-error";
import type { AuthState, Organization, User } from "../types";

const sessionExpiredMessage = () => t("errors.sessionExpired");

/** Brugeren fra seneste validering, så navnet kan vises før den næste. */
const CACHED_USER_KEY = "cachedUser";

/** Sat af API-klienten (popup/ny fane) og baggrunden ved UNAUTHORIZED. */
async function sessionWasExpired(): Promise<boolean> {
  try {
    const result = await chrome.storage.local.get(["sessionExpired"]);
    return result.sessionExpired === true;
  } catch {
    return false;
  }
}

function clearSessionExpired(): void {
  void chrome.storage.local.remove(["sessionExpired"]).catch(() => {});
}

const LOGGED_OUT = {
  token: null,
  user: null,
  isAuthenticated: false,
  isLoading: false,
  organizations: [],
  selectedOrgId: null,
  orgsLoaded: true,
};

export const useAuthStore = create<AuthState>((set, get) => ({
  token: null,
  user: null,
  isAuthenticated: false,
  isLoading: true,
  error: null,
  organizations: [],
  selectedOrgId: null,
  orgsLoaded: false,

  setToken: async (token: string) => {
    set({ isLoading: true, error: null });

    try {
      // Validate token with API
      const server = await resolveWebAppUrl();
      const result = await apiClient.validateToken(token, server);

      if (result.valid && result.user) {
        if (server !== (await resolveWebAppUrl()))
          throw new Error(t("errors.server.changedRetry"));
        // Save token to chrome storage
        await chrome.storage.local.set({
          extensionToken: token,
          extensionTokenServer: server,
          [CACHED_USER_KEY]: result.user,
        });
        clearSessionExpired();

        set({
          token,
          user: result.user as User,
          isAuthenticated: true,
          isLoading: false,
          error: null,
        });
        // Load the org list so the switcher appears and queries get scoped
        // immediately after a manual token login (mirrors checkAuth()).
        await get().loadOrganizations();
      } else {
        set({
          token: null,
          user: null,
          isAuthenticated: false,
          isLoading: false,
          error: t("errors.auth.invalidToken"),
        });
      }
    } catch (error) {
      set({
        token: null,
        user: null,
        isAuthenticated: false,
        isLoading: false,
        error: userErrorMessage(error, t("errors.auth.validateFailed")),
      });
    }
  },

  loginWithOAuth: async () => {
    set({ isLoading: true, error: null });
    try {
      const res = (await chrome.runtime.sendMessage({
        type: "START_OAUTH",
      })) as { success: boolean; error?: string } | undefined;

      if (res?.success) {
        // Token was stored by the background worker — load it into state.
        await get().checkAuth();
      } else {
        set({
          isLoading: false,
          error: res?.error ?? t("errors.auth.loginFailed"),
        });
      }
    } catch {
      // The popup is often torn down while the OAuth window has focus; the
      // background completes the flow and stores the token regardless, so the
      // next popup open will pick it up via checkAuth(). Just clear loading.
      set({ isLoading: false });
    }
  },

  loadOrganizations: async () => {
    const { token } = get();
    if (!token) return;
    try {
      const orgs = (await apiClient.listOrganizations(token)) as Organization[];
      // Logget ud (eller ind som en anden) imens: rør ikke den nye tilstand
      if (get().token !== token) return;
      const stored = await chrome.storage.local.get(["selectedOrgId"]);
      let selectedOrgId =
        typeof stored.selectedOrgId === "string" ? stored.selectedOrgId : null;
      // Reset to first org if the stored selection is gone / invalid.
      if (!selectedOrgId || !orgs.some((o) => o.id === selectedOrgId)) {
        selectedOrgId = orgs[0]?.id ?? null;
        if (selectedOrgId) {
          await chrome.storage.local.set({ selectedOrgId });
        }
      }
      if (get().token !== token) return;
      set({ organizations: orgs, selectedOrgId, orgsLoaded: true });
    } catch {
      if (get().token !== token) return;
      // Keep whatever org state we already have on a transient failure, but
      // mark resolution as done so data queries are allowed to run (they fall
      // back to the org persisted in chrome.storage / the server default).
      set({ orgsLoaded: true });
    }
  },

  setSelectedOrg: async (orgId: string) => {
    if (!get().organizations.some((o) => o.id === orgId)) return;
    await chrome.storage.local.set({ selectedOrgId: orgId });
    set({ selectedOrgId: orgId });
  },

  logout: () => {
    chrome.storage.local.remove([
      "extensionToken",
      "selectedOrgId",
      "sessionExpired",
      CACHED_USER_KEY,
    ]);
    set({
      token: null,
      user: null,
      isAuthenticated: false,
      isLoading: false,
      error: null,
      organizations: [],
      selectedOrgId: null,
      orgsLoaded: false,
    });
  },

  // Viser UI'et straks ud fra token, organisation og bruger i storage og
  // validerer i baggrunden. Før ventede popup'en på validateToken (op til
  // 8 s) og derefter på organisationerne, før noget som helst blev vist.
  checkAuth: async () => {
    set({ isLoading: true });

    const stored = await chrome.storage.local
      .get(["extensionToken", "selectedOrgId", CACHED_USER_KEY])
      .catch(() => ({}) as Record<string, unknown>);
    const token =
      typeof stored.extensionToken === "string" ? stored.extensionToken : null;

    if (!token) {
      set({
        ...LOGGED_OUT,
        error: (await sessionWasExpired()) ? sessionExpiredMessage() : null,
      });
      return;
    }

    const storedOrgId =
      typeof stored.selectedOrgId === "string" ? stored.selectedOrgId : null;
    set({
      token,
      user: (stored[CACHED_USER_KEY] as User | undefined) ?? get().user,
      isAuthenticated: true,
      isLoading: false,
      error: null,
      selectedOrgId: storedOrgId,
      // Med en gemt organisation kan data hentes med det samme; ellers
      // venter de på organisationslisten
      orgsLoaded: storedOrgId !== null,
    });

    const organizations = get().loadOrganizations();
    try {
      const validation = await apiClient.validateToken(token);
      if (get().token !== token) return; // Logget ud eller ind imens
      if (validation.valid && validation.user) {
        clearSessionExpired();
        set({ user: validation.user as User });
        void chrome.storage.local
          .set({ [CACHED_USER_KEY]: validation.user })
          .catch(() => {});
      } else {
        // Token invalid (udløbet eller tilbagekaldt), clear it. Flaget sættes
        // først, så storage-lytteren også viser beskeden.
        set({ ...LOGGED_OUT, error: sessionExpiredMessage() });
        await chrome.storage.local.set({ sessionExpired: true });
        await chrome.storage.local.remove([
          "extensionToken",
          "selectedOrgId",
          CACHED_USER_KEY,
        ]);
        return;
      }
    } catch {
      // Network error / timeout — the server is unreachable but the token
      // may still be perfectly valid. Do NOT delete it; keep the user logged
      // in so they can use offline features. Queries use the org persisted
      // in chrome.storage.
      if (get().token === token && !get().orgsLoaded) {
        set({ orgsLoaded: true });
      }
    }
    await organizations;
  },
}));

/**
 * Popup og ny fane deler tokenet i chrome.storage. Ryddes det et andet sted
 * (API-klienten eller baggrunden ved et udløbet token, eller log ud i en
 * anden visning), skifter denne visning til login med det samme i stedet for
 * at blive ved med at vise fejl. Et token der dukker op (login i en anden
 * visning) indlæses tilsvarende.
 */
if (typeof chrome !== "undefined" && chrome.storage?.onChanged) {
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local" || !changes.extensionToken) return;
    const state = useAuthStore.getState();
    if (state.isLoading) return; // Et login/tjek er i gang og afgør selv
    if (!changes.extensionToken.newValue) {
      if (!state.isAuthenticated) return;
      void sessionWasExpired().then((expired) => {
        useAuthStore.setState({
          ...LOGGED_OUT,
          error: expired ? sessionExpiredMessage() : null,
        });
      });
    } else if (!state.isAuthenticated) {
      void state.checkAuth();
    }
  });
}
