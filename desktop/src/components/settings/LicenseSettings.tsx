import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  Loader2,
  Shield,
  WifiOff,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Input } from "@/components/ui/Input";
import { tauriInvoke } from "@/lib/tauri";

interface LicenseProof {
  license_key: string;
  tier: string;
  valid_until: string | null;
  devices_allowed: number;
  issued_at: string;
  verified_at: string;
}

interface LicenseStatus {
  is_valid: boolean;
  tier: string | null;
  days_until_expiry: number | null;
  offline_days: number;
  needs_verification: boolean;
}

/**
 * Nøgler til de oversatte etiketter, ikke etiketterne selv. `license.lifetime`,
 * `license.solo` og `license.team` lå allerede i alle 5 locales brugt et andet
 * sted, mens den danske "Livstid" lå i denne tabel — så en tysk bruger så dansk
 * på den side, han betaler fra. Et niveau koden ikke kender vises som det, Rust
 * sendte, så en ny plan ikke forsvinder som "Ukendt".
 */
const TIER_LABELS: Record<string, string> = {
  lifetime: "license.lifetime",
  solo: "license.solo",
  team: "license.team",
};

const TIER_COLORS: Record<string, string> = {
  lifetime: "bg-amber-500/15 text-amber-400",
  solo: "bg-blue-500/15 text-blue-400",
  team: "bg-purple-500/15 text-purple-400",
};

function maskLicenseKey(key: string): string {
  const parts = key.split("-");
  if (parts.length < 5) return key;
  return `${parts[0]}-****-****-****-${parts[parts.length - 1]}`;
}

export function LicenseSettings() {
  const { t } = useTranslation();
  const [proof, setProof] = useState<LicenseProof | null>(null);
  const [status, setStatus] = useState<LicenseStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [activateKey, setActivateKey] = useState("");
  const [activating, setActivating] = useState(false);
  const [activateError, setActivateError] = useState<string | null>(null);
  const [showDeactivateDialog, setShowDeactivateDialog] = useState(false);
  const [deactivating, setDeactivating] = useState(false);
  const [deactivateError, setDeactivateError] = useState<string | null>(null);

  const loadLicense = useCallback(async () => {
    setLoading(true);
    try {
      const [cachedProof, licenseStatus] = await Promise.all([
        tauriInvoke<LicenseProof | null>("get_license_info"),
        tauriInvoke<LicenseStatus>("verify_license"),
      ]);
      setProof(cachedProof);
      setStatus(licenseStatus);
    } catch {
      // No license data
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadLicense();
  }, [loadLicense]);

  async function handleActivate(e: React.FormEvent) {
    e.preventDefault();
    const key = activateKey.trim();
    if (!key) return;

    setActivating(true);
    setActivateError(null);

    try {
      const newProof = await tauriInvoke<LicenseProof>("activate_license", {
        licenseKey: key,
      });
      setProof(newProof);
      setStatus({
        is_valid: true,
        tier: newProof.tier,
        days_until_expiry: null,
        offline_days: 0,
        needs_verification: false,
      });
      setActivateKey("");
    } catch (err) {
      setActivateError(
        typeof err === "string" ? err : t("license.activateFailed"),
      );
    } finally {
      setActivating(false);
    }
  }

  async function handleDeactivate() {
    setDeactivating(true);
    setDeactivateError(null);
    try {
      await tauriInvoke("deactivate_license");
      setProof(null);
      setStatus(null);
      setShowDeactivateDialog(false);
    } catch (err) {
      // `deactivate_license` kan fejle, hvis licensfilen ikke kan skrives. Det
      // var stille før her: dialogen blev stående med knappen deaktiveret og
      // ingen forklaring, så brugeren troede at have deaktiveret.
      setDeactivateError(
        typeof err === "string" ? err : t("license.deactivateFailed"),
      );
    } finally {
      setDeactivating(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-(--color-border) border-t-(--color-accent)" />
      </div>
    );
  }

  const hasLicense = proof && status?.is_valid;
  const tierKey = TIER_LABELS[proof?.tier ?? ""];
  const tierLabel = tierKey
    ? t(tierKey)
    : (proof?.tier ?? t("license.unknownTier"));
  const tierColor =
    TIER_COLORS[proof?.tier ?? ""] ??
    "bg-(--color-border) text-(--color-text-muted)";

  return (
    <div className="space-y-8">
      {hasLicense ? (
        <>
          {/* Active license */}
          <section className="space-y-4">
            <div className="flex items-start gap-3 rounded-lg border border-(--color-border) bg-(--color-bg) p-4">
              <Shield size={20} className="mt-0.5 shrink-0 text-emerald-400" />
              <div className="min-w-0 flex-1 space-y-3">
                <div>
                  <p className="text-sm font-medium text-(--color-text)">
                    {t("license.key")}
                  </p>
                  <p className="mt-0.5 font-mono text-sm text-(--color-text-muted)">
                    {maskLicenseKey(proof.license_key)}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${tierColor}`}
                  >
                    {tierLabel}
                  </span>

                  <span className="rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-xs font-medium text-emerald-400">
                    <CheckCircle2
                      size={12}
                      className="mr-1 inline-block align-[-2px]"
                    />
                    {t("license.active")}
                  </span>

                  {status.offline_days > 0 && (
                    <span className="flex items-center gap-1 rounded-full bg-yellow-500/15 px-2.5 py-0.5 text-xs font-medium text-yellow-400">
                      <WifiOff size={12} />
                      {t("license.offlineDays", { days: status.offline_days })}
                    </span>
                  )}
                </div>

                {proof.devices_allowed > 0 && (
                  <div>
                    <p className="text-xs text-(--color-text-muted)">
                      {t("license.devices")}
                    </p>
                    <p className="text-sm text-(--color-text)">
                      {t("license.devicesAllowed", {
                        count: proof.devices_allowed,
                      })}
                    </p>
                  </div>
                )}

                {status.days_until_expiry != null && (
                  <div>
                    <p className="text-xs text-(--color-text-muted)">
                      {t("license.expires")}
                    </p>
                    <p
                      className={`text-sm ${
                        status.days_until_expiry < 7
                          ? "text-red-400"
                          : status.days_until_expiry < 30
                            ? "text-yellow-400"
                            : "text-(--color-text)"
                      }`}
                    >
                      {status.days_until_expiry <= 0
                        ? t("license.expired")
                        : t("license.daysLeft", {
                            count: status.days_until_expiry,
                          })}
                    </p>
                  </div>
                )}

                {status.needs_verification && (
                  <p className="text-xs text-yellow-400">
                    <AlertTriangle
                      size={12}
                      className="mr-1 inline-block align-[-2px]"
                    />
                    {t("license.verifyOnline")}
                  </p>
                )}
              </div>
            </div>
          </section>

          {/* Deactivate */}
          <section className="space-y-3 rounded-lg border border-red-500/30 bg-red-500/5 p-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-red-400">
                  {t("license.deactivate")}
                </h3>
                <p className="mt-0.5 text-xs text-(--color-text-muted)">
                  {t("license.deactivateHint")}
                </p>
              </div>
              <Button
                variant="danger"
                size="sm"
                onClick={() => {
                  setDeactivateError(null);
                  setShowDeactivateDialog(true);
                }}
              >
                <AlertTriangle size={14} />
                {t("license.deactivateBtn")}
              </Button>
            </div>
          </section>
        </>
      ) : (
        <>
          {/* Activate license */}
          <section className="space-y-4">
            <div className="rounded-lg border border-dashed border-(--color-border) px-6 py-10 text-center">
              <Shield
                size={32}
                className="mx-auto mb-3 text-(--color-text-muted)"
              />
              <h3 className="text-sm font-semibold text-(--color-text)">
                {t("license.noLicense")}
              </h3>
              <p className="mx-auto mt-1 max-w-sm text-xs text-(--color-text-muted)">
                {t("license.buyPitch")}
              </p>

              <form
                onSubmit={handleActivate}
                className="mx-auto mt-5 flex max-w-md items-center gap-2"
              >
                <Input
                  value={activateKey}
                  onChange={(e) => {
                    setActivateKey(e.target.value);
                    setActivateError(null);
                  }}
                  placeholder="TT-XXXX-XXXX-XXXX-XXXX"
                  aria-label={t("license.enterKey")}
                  className="flex-1 font-mono text-sm"
                />
                <Button
                  type="submit"
                  size="sm"
                  disabled={activating || !activateKey.trim()}
                >
                  {activating ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    t("license.activate")
                  )}
                </Button>
              </form>

              {activateError && (
                <p className="mx-auto mt-2 max-w-md text-xs text-red-400">
                  {activateError}
                </p>
              )}

              <div className="mt-4">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    window.open("https://timetrack.dk/pricing", "_blank")
                  }
                >
                  <ExternalLink size={14} />
                  {t("license.buyLicense")}
                </Button>
              </div>
            </div>
          </section>
        </>
      )}

      {/* Upgrade link */}
      <section className="space-y-3">
        <div className="flex items-center justify-between rounded-lg border border-(--color-border) bg-(--color-bg) px-4 py-3">
          <div>
            <p className="text-sm text-(--color-text)">
              {hasLicense ? t("license.upgradePlan") : t("license.seePricing")}
            </p>
            <p className="text-xs text-(--color-text-muted)">
              timetrack.dk/pricing
            </p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              window.open("https://timetrack.dk/pricing", "_blank")
            }
          >
            <ExternalLink size={14} />
            {t("common.open")}
          </Button>
        </div>
      </section>

      {/* Deactivate dialog */}
      <Dialog
        open={showDeactivateDialog}
        onClose={() => setShowDeactivateDialog(false)}
        title={t("license.deactivateConfirmTitle")}
        footer={
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setShowDeactivateDialog(false)}
            >
              {t("common.cancel")}
            </Button>
            <Button
              variant="danger"
              size="sm"
              onClick={handleDeactivate}
              disabled={deactivating}
            >
              {deactivating
                ? t("license.deactivating")
                : t("license.deactivateConfirmBtn")}
            </Button>
          </div>
        }
      >
        <p className="text-sm text-(--color-text)">
          {t("license.deactivateConfirmText")}
        </p>
        {deactivateError && (
          <p className="mt-2 text-sm text-red-400">{deactivateError}</p>
        )}
      </Dialog>
    </div>
  );
}
