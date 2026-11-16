import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Cloud,
  Link2,
  Loader2,
  LogOut,
  RefreshCw,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import i18n from "@/lib/i18n";
import { useSyncStore } from "@/stores/syncStore";

/**
 * Nøglen til et tiers visningsnavn. Værdierne *er* nøgler, så `i18n.test.ts`
 * dømmer dem lige så hårdt som et `t("…")`-kald. `TIER_COLORS` derimod er
 * Tailwind-klasser og skal ikke røres af oversættelsen.
 */
const TIER_LABEL_KEYS: Record<string, string> = {
  free: "license.free",
  solo: "license.solo",
  team: "license.team",
  lifetime: "license.lifetime",
};

const TIER_COLORS: Record<string, string> = {
  free: "bg-(--color-border) text-(--color-text-muted)",
  solo: "bg-blue-500/15 text-blue-400",
  team: "bg-purple-500/15 text-purple-400",
  lifetime: "bg-amber-500/15 text-amber-400",
};

/**
 * Tid siden sidste synk. Læser i18n direkte (som `lib/format.ts` gør), fordi
 * den kaldes uden for komponenten — ellers skulle hvert kaldstedssted sende
 * `t` med. Datoen formateres i det *aktive* sprog: `da-DK` var hårdkodet, så en
 * tysk bruger så dansk datoformat.
 */
function formatSyncTime(iso: string | null): string {
  if (!iso) return i18n.t("sync.never");
  try {
    const d = new Date(iso);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMin = Math.floor(diffMs / 60000);

    if (diffMin < 1) return i18n.t("sync.justNow");
    if (diffMin < 60) return i18n.t("sync.minutesAgo", { count: diffMin });

    const diffHours = Math.floor(diffMin / 60);
    if (diffHours < 24) return i18n.t("sync.hoursAgo", { count: diffHours });

    return d.toLocaleDateString(i18n.language, {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export function SyncSettings() {
  const { t } = useTranslation();
  const {
    isLoggedIn,
    userEmail,
    userName,
    tier,
    lastSync,
    pendingChanges,
    isSyncing,
    isLoggingIn,
    isConnecting,
    error,
    login,
    logout,
    connect,
    cancelConnect,
    syncNow,
    loadStatus,
    clearError,
  } = useSyncStore();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState<string | null>(null);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [showEmailLogin, setShowEmailLogin] = useState(false);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  const handleConnect = useCallback(async () => {
    setLoginError(null);
    clearError();
    await connect();
  }, [connect, clearError]);

  const handleLogin = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!email.trim() || !password) return;

      setLoginError(null);
      try {
        await login(email.trim(), password);
        setEmail("");
        setPassword("");
        setShowEmailLogin(false);
      } catch (err) {
        setLoginError(typeof err === "string" ? err : t("sync.loginFailed"));
      }
    },
    [email, password, login, t],
  );

  const handleLogout = useCallback(async () => {
    await logout();
    setShowLogoutConfirm(false);
  }, [logout]);

  // Et tier serveren sender, men koden ikke kender, vises rå i stedet for at
  // blive noget gæt — ellers ville en ny plan vise sig som "Gratis". `||` og
  // ikke `??`, så en tom streng fra serveren ikke giver en tom badge.
  const tierKey = tier ? TIER_LABEL_KEYS[tier] : undefined;
  const tierLabel = tierKey ? t(tierKey) : tier || t("sync.tierUnknown");
  const tierColor =
    TIER_COLORS[tier ?? ""] ?? "bg-(--color-border) text-(--color-text-muted)";

  if (!isLoggedIn) {
    return (
      <div className="space-y-6">
        {/* Browser-based login */}
        <section className="space-y-4">
          <div className="rounded-lg border border-dashed border-(--color-border) px-6 py-10 text-center">
            <Cloud
              size={32}
              className="mx-auto mb-3 text-(--color-text-muted)"
            />
            <h3 className="text-sm font-semibold text-(--color-text)">
              {t("sync.title")}
            </h3>
            <p className="mx-auto mt-1 max-w-sm text-xs text-(--color-text-muted)">
              {t("sync.connectSubtitle")}
            </p>

            <div className="mx-auto mt-5 flex max-w-xs flex-col gap-3">
              <Button
                size="sm"
                onClick={handleConnect}
                disabled={isConnecting}
                className="w-full"
              >
                {isConnecting ? (
                  <>
                    <Loader2 size={14} className="animate-spin" />
                    {t("sync.waitingForApproval")}
                  </>
                ) : (
                  <>
                    <Link2 size={14} />
                    {t("sync.connect")}
                  </>
                )}
              </Button>

              {isConnecting && (
                <>
                  <p className="text-xs text-(--color-text-muted)">
                    {t("sync.browserOpened")}
                  </p>
                  <button
                    type="button"
                    onClick={cancelConnect}
                    className="text-xs text-(--color-text-muted) underline-offset-2 hover:text-(--color-text) hover:underline"
                  >
                    {t("common.cancel")}
                  </button>
                </>
              )}
            </div>

            {(loginError || error) && (
              <p className="mx-auto mt-3 max-w-xs text-xs text-red-400">
                <AlertTriangle
                  size={12}
                  className="mr-1 inline-block align-[-2px]"
                />
                {loginError || error}
              </p>
            )}

            {/* Collapsible email/password fallback */}
            <div className="mx-auto mt-5 max-w-xs">
              <button
                type="button"
                onClick={() => {
                  setShowEmailLogin(!showEmailLogin);
                  setLoginError(null);
                  clearError();
                }}
                className="flex items-center gap-1 text-xs text-(--color-text-muted) hover:text-(--color-text) transition-colors mx-auto"
              >
                {showEmailLogin ? (
                  <ChevronUp size={12} />
                ) : (
                  <ChevronDown size={12} />
                )}
                {t("sync.loginWithEmail")}
              </button>

              {showEmailLogin && (
                <form
                  onSubmit={handleLogin}
                  className="mt-3 flex flex-col gap-3"
                >
                  <Input
                    type="email"
                    value={email}
                    onChange={(e) => {
                      setEmail(e.target.value);
                      setLoginError(null);
                      clearError();
                    }}
                    placeholder={t("common.email")}
                    autoComplete="email"
                    aria-label={t("common.email")}
                  />
                  <Input
                    type="password"
                    value={password}
                    onChange={(e) => {
                      setPassword(e.target.value);
                      setLoginError(null);
                      clearError();
                    }}
                    placeholder={t("sync.password")}
                    autoComplete="current-password"
                    aria-label={t("sync.password")}
                  />
                  <Button
                    type="submit"
                    size="sm"
                    variant="secondary"
                    disabled={isLoggingIn || !email.trim() || !password}
                  >
                    {isLoggingIn ? (
                      <>
                        <Loader2 size={14} className="animate-spin" />
                        {t("sync.loggingIn")}
                      </>
                    ) : (
                      <>
                        <Cloud size={14} />
                        {t("sync.login")}
                      </>
                    )}
                  </Button>
                </form>
              )}
            </div>

            <p className="mt-4 text-xs text-(--color-text-muted)">
              {t("sync.noAccount")}{" "}
              <button
                type="button"
                onClick={() =>
                  window.open("https://timetrack.dk/signup", "_blank")
                }
                className="text-(--color-accent) hover:underline"
              >
                {t("sync.signupFree")}
              </button>
            </p>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Connected status */}
      <section className="space-y-4">
        <div className="flex items-start gap-3 rounded-lg border border-(--color-border) bg-(--color-bg) p-4">
          <Cloud size={20} className="mt-0.5 shrink-0 text-emerald-400" />
          <div className="min-w-0 flex-1 space-y-3">
            <div>
              <p className="text-sm font-medium text-(--color-text)">
                {userName || userEmail}
              </p>
              {userName && userEmail && (
                <p className="mt-0.5 text-xs text-(--color-text-muted)">
                  {userEmail}
                </p>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${tierColor}`}
              >
                {tierLabel}
              </span>

              <span className="flex items-center gap-1 rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-xs font-medium text-emerald-400">
                <CheckCircle2 size={12} />
                {t("sync.connected")}
              </span>
            </div>

            <div className="flex items-center gap-4 text-xs text-(--color-text-muted)">
              <span className="flex items-center gap-1">
                <Clock size={12} />
                {t("sync.lastSync")}: {formatSyncTime(lastSync)}
              </span>
              {pendingChanges > 0 && (
                <span className="text-yellow-400">
                  {t("sync.pendingCount", { count: pendingChanges })}
                </span>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Sync button */}
      <section className="space-y-3">
        <div className="flex items-center gap-3">
          <Button size="sm" onClick={() => syncNow()} disabled={isSyncing}>
            {isSyncing ? (
              <>
                <Loader2 size={14} className="animate-spin" />
                {t("sync.syncing")}
              </>
            ) : (
              <>
                <RefreshCw size={14} />
                {t("sync.syncNow")}
              </>
            )}
          </Button>

          {error && (
            <p className="text-xs text-red-400">
              <AlertTriangle
                size={12}
                className="mr-1 inline-block align-[-2px]"
              />
              {error}
            </p>
          )}
        </div>

        <p className="text-xs text-(--color-text-muted)">
          {t("sync.autoEveryFiveMinutes")}
        </p>
      </section>

      {/* Logout */}
      <section className="space-y-3 rounded-lg border border-red-500/30 bg-red-500/5 p-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-red-400">
              {t("sync.logout")}
            </h3>
            <p className="mt-0.5 text-xs text-(--color-text-muted)">
              {t("sync.logoutDescription")}
            </p>
          </div>
          {showLogoutConfirm ? (
            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setShowLogoutConfirm(false)}
              >
                {t("common.cancel")}
              </Button>
              <Button variant="danger" size="sm" onClick={handleLogout}>
                {t("sync.logoutConfirm")}
              </Button>
            </div>
          ) : (
            <Button
              variant="danger"
              size="sm"
              onClick={() => setShowLogoutConfirm(true)}
            >
              <LogOut size={14} />
              {t("sync.logout")}
            </Button>
          )}
        </div>
      </section>
    </div>
  );
}
