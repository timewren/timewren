import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { create } from "zustand";
import { getOfflineMessage, isNetworkError } from "@/hooks/useNetworkStatus";
import { erKlientForGammel, udenKlientMarkoer } from "@/lib/klientVersion";
import { tauriInvoke } from "@/lib/tauri";

interface SyncStatus {
  is_logged_in: boolean;
  user_email: string | null;
  user_name: string | null;
  tier: string | null;
  last_sync: string | null;
  pending_changes: number;
}

interface SyncResult {
  pushed: number;
  pulled: number;
  conflicts: number;
  server_time: string | null;
  afvist: number;
  afvisning: string | null;
  i_koen: number;
  /** Serveren afviste pushen: versionen er under minimummet (HTTP 426). */
  klient_for_gammel?: boolean;
}

interface AuthResponse {
  token: string;
  user: { id: string; name: string; email: string };
  tier: string;
}

interface DeepLinkPayload {
  token: string;
  orgId: string | null;
  email: string | null;
  name: string | null;
  tier: string | null;
}

interface SyncState {
  // Status
  isLoggedIn: boolean;
  userEmail: string | null;
  userName: string | null;
  tier: string | null;
  lastSync: string | null;
  pendingChanges: number;

  // UI state
  isSyncing: boolean;
  isLoggingIn: boolean;
  isConnecting: boolean;
  error: string | null;
  lastResult: SyncResult | null;
  /**
   * Serveren afviser skrivninger fra denne version (`CLIENT_TOO_OLD`).
   * Lokale ændringer bliver i køen; `UpdateBanner` viser opdateringsprompten.
   */
  klientForGammel: boolean;

  // Actions
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  connect: () => Promise<void>;
  cancelConnect: () => void;
  syncNow: () => Promise<void>;
  syncFull: () => Promise<void>;
  loadStatus: () => Promise<void>;
  clearError: () => void;
}

// Track deep-link listener so we don't double-subscribe
let deepLinkUnlisten: UnlistenFn | null = null;

// Auto-cancel a pending browser connection if no callback arrives in time.
let connectTimeout: ReturnType<typeof setTimeout> | null = null;
const CONNECT_TIMEOUT_MS = 120_000;

function clearConnectTimeout() {
  if (connectTimeout) {
    clearTimeout(connectTimeout);
    connectTimeout = null;
  }
}

/**
 * Rust's egen fejlstreng er uegnet til at vise: en synk der fejler uden
 * internet gav "Forbindelsesfejl: error sending request for url (...)". En
 * netværksfejl bliver derfor den oversatte sætning, og kun den beholder den
 * rå streng — den kan være en fejl, brugeren skal læse (ugyldig adgangskode).
 */
function synkFejl(err: unknown, reserve: string): string {
  if (isNetworkError(err)) return getOfflineMessage("sync");
  return typeof err === "string" ? udenKlientMarkoer(err) : reserve;
}

/** Hvad en synk siger om `klientForGammel` (tomt objekt = uændret). */
function klientFlag(result: SyncResult): { klientForGammel?: boolean } {
  if (result.klient_for_gammel === true) return { klientForGammel: true };
  if (result.pushed > 0) return { klientForGammel: false };
  return {};
}

export const useSyncStore = create<SyncState>()((set, get) => ({
  isLoggedIn: false,
  userEmail: null,
  userName: null,
  tier: null,
  lastSync: null,
  pendingChanges: 0,
  isSyncing: false,
  isLoggingIn: false,
  isConnecting: false,
  error: null,
  lastResult: null,
  klientForGammel: false,

  login: async (email: string, password: string) => {
    set({ isLoggingIn: true, error: null });
    try {
      const auth = await tauriInvoke<AuthResponse>("sync_login", {
        email,
        password,
      });
      set({
        isLoggedIn: true,
        userEmail: auth.user.email,
        userName: auth.user.name,
        tier: auth.tier,
        isLoggingIn: false,
      });

      // Do an initial full sync after login
      get().syncFull();
    } catch (err) {
      set({
        isLoggingIn: false,
        error: synkFejl(err, "Login fejlede"),
      });
      throw err;
    }
  },

  connect: async () => {
    clearConnectTimeout();
    set({ isConnecting: true, error: null });

    // Don't spin forever if the browser tab is closed without approving.
    connectTimeout = setTimeout(() => {
      if (get().isConnecting) {
        set({
          isConnecting: false,
          error:
            "Forbindelsen blev ikke godkendt i tide. Prøv igen, eller log ind med email.",
        });
      }
      connectTimeout = null;
    }, CONNECT_TIMEOUT_MS);

    try {
      // Set up deep link listener before opening browser
      if (!deepLinkUnlisten) {
        deepLinkUnlisten = await listen<DeepLinkPayload>(
          "deep-link-callback",
          async (event) => {
            const { token, orgId, email, name, tier } = event.payload;

            clearConnectTimeout();
            try {
              const status = await tauriInvoke<SyncStatus>(
                "sync_handle_callback",
                {
                  token,
                  orgId: orgId ?? null,
                  email: email ?? null,
                  name: name ?? null,
                  tier: tier ?? null,
                },
              );

              set({
                isLoggedIn: status.is_logged_in,
                userEmail: status.user_email,
                userName: status.user_name,
                tier: status.tier,
                lastSync: status.last_sync,
                pendingChanges: status.pending_changes,
                isConnecting: false,
              });

              // Do an initial full sync after connecting
              get().syncFull();
            } catch (err) {
              set({
                isConnecting: false,
                error: synkFejl(err, "Forbindelse fejlede"),
              });
            }
          },
        );
      }

      // Open browser to the auth page
      await tauriInvoke<string>("sync_connect");
    } catch (err) {
      clearConnectTimeout();
      set({
        isConnecting: false,
        error: typeof err === "string" ? err : "Kunne ikke åbne browser",
      });
    }
  },

  cancelConnect: () => {
    clearConnectTimeout();
    set({ isConnecting: false });
  },

  logout: async () => {
    clearConnectTimeout();
    try {
      await tauriInvoke("sync_logout");
    } catch {
      // Best effort
    }

    // Clean up deep link listener
    if (deepLinkUnlisten) {
      deepLinkUnlisten();
      deepLinkUnlisten = null;
    }

    set({
      isLoggedIn: false,
      userEmail: null,
      userName: null,
      tier: null,
      lastSync: null,
      pendingChanges: 0,
      isConnecting: false,
      error: null,
      lastResult: null,
    });
  },

  syncNow: async () => {
    if (get().isSyncing || !get().isLoggedIn) return;

    set({ isSyncing: true, error: null });
    try {
      const result = await tauriInvoke<SyncResult>("sync_now");
      set({
        isSyncing: false,
        lastResult: result,
        lastSync: result.server_time,
        pendingChanges: result.i_koen,
        error: result.afvisning,
        // Kun en push siger noget om versionen: afvist = for gammel, sendte
        // rækker = ikke længere blokeret. Ingen push = flaget bliver stående.
        ...klientFlag(result),
      });
    } catch (err) {
      set({
        isSyncing: false,
        error: synkFejl(err, "Sync fejlede"),
        ...(erKlientForGammel(err) ? { klientForGammel: true } : {}),
      });
    }
  },

  syncFull: async () => {
    if (get().isSyncing || !get().isLoggedIn) return;

    set({ isSyncing: true, error: null });
    try {
      const result = await tauriInvoke<SyncResult>("sync_full");
      set({
        isSyncing: false,
        lastResult: result,
        lastSync: result.server_time,
        pendingChanges: result.i_koen,
        error: result.afvisning,
      });
    } catch (err) {
      set({
        isSyncing: false,
        error: synkFejl(err, "Fuld sync fejlede"),
        ...(erKlientForGammel(err) ? { klientForGammel: true } : {}),
      });
    }
  },

  loadStatus: async () => {
    try {
      const status = await tauriInvoke<SyncStatus>("get_sync_status");
      set({
        isLoggedIn: status.is_logged_in,
        userEmail: status.user_email,
        userName: status.user_name,
        tier: status.tier,
        lastSync: status.last_sync,
        pendingChanges: status.pending_changes,
      });
    } catch {
      // Ignore — not critical
    }
  },

  clearError: () => set({ error: null }),
}));
