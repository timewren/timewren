import { useNavigate } from "@tanstack/react-router";
import { CreditCard } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { LoadError } from "@/components/ui/LoadError";
import { tauriInvoke } from "@/lib/tauri";
import type { Klippekort } from "@/lib/types";

export function ActiveKlippekort() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [klippekort, setKlippekort] = useState<Klippekort[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);

  const fetchKlippekort = useCallback(async () => {
    try {
      const result = await tauriInvoke<Klippekort[]>("list_klippekort", {
        includeInactive: false,
      });
      // Sort by most used (highest used_hours first) and take top 3
      result.sort((a, b) => b.used_hours - a.used_hours);
      setKlippekort(result.slice(0, 3));
      setLoadFailed(false);
    } catch (err) {
      console.error("Failed to load klippekort:", err);
      setLoadFailed(true);
      setKlippekort([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchKlippekort();
  }, [fetchKlippekort]);

  if (loading) {
    return (
      <div className="rounded-xl border border-(--color-border) bg-(--color-surface) p-4">
        <div className="flex items-center gap-2 mb-4">
          <CreditCard size={16} className="text-(--color-accent)" />
          <h3 className="text-sm font-semibold text-(--color-text)">
            {t("dashboard.activeKlippekort")}
          </h3>
        </div>
        <div className="flex items-center justify-center py-6">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-(--color-border) border-t-(--color-accent)" />
        </div>
      </div>
    );
  }

  if (loadFailed) {
    return (
      <div className="rounded-xl border border-(--color-border) bg-(--color-surface) p-4">
        <div className="flex items-center gap-2 mb-3">
          <CreditCard size={16} className="text-(--color-accent)" />
          <h3 className="text-sm font-semibold text-(--color-text)">
            {t("dashboard.activeKlippekort")}
          </h3>
        </div>
        <LoadError
          message={t("klippekort.loadFailed")}
          onRetry={() => {
            setLoading(true);
            fetchKlippekort();
          }}
          className="py-4"
        />
      </div>
    );
  }

  if (klippekort.length === 0) {
    return (
      <div className="rounded-xl border border-(--color-border) bg-(--color-surface) p-4">
        <div className="flex items-center gap-2 mb-3">
          <CreditCard size={16} className="text-(--color-accent)" />
          <h3 className="text-sm font-semibold text-(--color-text)">
            {t("dashboard.activeKlippekort")}
          </h3>
        </div>
        <p className="text-xs text-(--color-text-muted)">
          {t("dashboard.noActiveKlippekort")}
        </p>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => navigate({ to: "/klippekort" })}
      className="w-full rounded-xl border border-(--color-border) bg-(--color-surface) p-4 text-left transition-colors hover:border-(--color-text-muted)/30"
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <CreditCard size={16} className="text-(--color-accent)" />
          <h3 className="text-sm font-semibold text-(--color-text)">
            {t("dashboard.activeKlippekort")}
          </h3>
        </div>
        <span className="text-[10px] text-(--color-text-muted)">
          {t("dashboard.clickToView")}
        </span>
      </div>

      {/* Klippekort list */}
      <div className="space-y-3">
        {klippekort.map((kk) => {
          const percentage = Math.min(
            (kk.used_hours / kk.total_hours) * 100,
            100,
          );
          const remaining = Math.max(kk.total_hours - kk.used_hours, 0);
          const isLow = remaining < kk.total_hours * 0.2;

          return (
            <div key={kk.id} className="space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-(--color-text) truncate">
                  {kk.name}
                </span>
                <span
                  className={`font-mono text-[11px] ${
                    isLow ? "text-red-400" : "text-(--color-text-muted)"
                  }`}
                >
                  {Math.round(remaining * 10) / 10} {t("common.hours")}{" "}
                  {t("dashboard.remaining")}
                </span>
              </div>
              {/* Progress bar */}
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-(--color-border)/50">
                <div
                  className={`h-full rounded-full transition-all ${
                    isLow ? "bg-red-400" : "bg-(--color-accent)"
                  }`}
                  style={{ width: `${percentage}%` }}
                />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-(--color-text-muted)">
                  {kk.client_name}
                </span>
                <span className="font-mono text-[10px] text-(--color-text-muted)">
                  {Math.round(kk.used_hours * 10) / 10}/{kk.total_hours}{" "}
                  {t("common.hours")}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </button>
  );
}
