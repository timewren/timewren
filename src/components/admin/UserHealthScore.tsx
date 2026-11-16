"use client";

import { Activity, Heart, ShieldAlert } from "lucide-react";
import { useTranslations } from "next-intl";
import { trpc } from "@/providers/trpc-provider";

interface UserHealthScoreProps {
  userId: string;
  variant?: "full" | "badge";
}

function scoreBgClass(score: number) {
  if (score >= 80) return "bg-green-100 text-green-800";
  if (score >= 60) return "bg-brand-100 text-brand-800";
  if (score >= 40) return "bg-amber-100 text-amber-800";
  if (score >= 20) return "bg-orange-100 text-orange-800";
  return "bg-red-100 text-red-800";
}

function scoreBarColor(score: number) {
  if (score >= 80) return "bg-green-500";
  if (score >= 60) return "bg-brand-500";
  if (score >= 40) return "bg-amber-500";
  if (score >= 20) return "bg-orange-500";
  return "bg-red-500";
}

function CategoryRow({
  label,
  score,
  max,
  detail,
}: {
  label: string;
  score: number;
  max: number;
  detail?: string;
}) {
  const pct = max > 0 ? (score / max) * 100 : 0;
  return (
    <div>
      <div className="flex items-baseline justify-between text-sm">
        <div className="flex items-baseline gap-2">
          <span className="font-medium text-gray-700">{label}</span>
          {detail && <span className="text-xs text-gray-500">{detail}</span>}
        </div>
        <span className="font-mono text-xs text-gray-600">
          {score} / {max}
        </span>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-gray-100">
        <div
          className={`h-full rounded-full ${scoreBarColor(score >= max * 0.6 ? 70 : score >= max * 0.3 ? 50 : 20)}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

export function UserHealthScore({
  userId,
  variant = "full",
}: UserHealthScoreProps) {
  const t = useTranslations("adminUsers");
  const { data, isLoading } = trpc.admin.getUserHealthScore.useQuery({
    userId,
  });

  if (variant === "badge") {
    if (isLoading || !data) {
      return (
        <span className="inline-flex h-5 w-12 animate-pulse rounded-full bg-gray-100" />
      );
    }
    return (
      <span
        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${scoreBgClass(data.score)}`}
        title={t("health.badgeTitle", {
          score: data.score,
          label: data.label,
        })}
      >
        <Heart className="h-3 w-3" />
        {data.score}
      </span>
    );
  }

  if (isLoading) {
    return <div className="h-48 animate-pulse rounded-lg bg-gray-100" />;
  }

  if (!data) {
    return null;
  }

  const { score, label, breakdown, penalties } = data;

  const totalPenalty = penalties.flagged + penalties.banned + penalties.pastDue;

  return (
    <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
        <div className="flex items-center gap-2">
          <Heart className="h-4 w-4 text-gray-500" />
          <h3 className="text-sm font-semibold text-gray-900">
            {t("health.title")}
          </h3>
        </div>
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-medium ${scoreBgClass(score)}`}
        >
          {label}
        </span>
      </div>

      <div className="p-5">
        {/* Big score */}
        <div className="flex items-baseline gap-2">
          <span className="text-4xl font-bold text-gray-900">{score}</span>
          <span className="text-sm text-gray-500">/ 100</span>
        </div>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-gray-100">
          <div
            className={`h-full rounded-full ${scoreBarColor(score)}`}
            style={{ width: `${score}%` }}
          />
        </div>

        {/* Breakdown */}
        <div className="mt-5 space-y-3">
          <CategoryRow
            label={t("health.recency")}
            score={breakdown.recency.score}
            max={breakdown.recency.max}
            detail={
              breakdown.recency.daysSinceLogin === Number.POSITIVE_INFINITY
                ? t("health.neverLoggedIn")
                : t("health.daysSinceLogin", {
                    days: breakdown.recency.daysSinceLogin,
                  })
            }
          />
          <CategoryRow
            label={t("health.activation")}
            score={breakdown.activation.score}
            max={breakdown.activation.max}
            detail={t("health.activationDetail", {
              clients: breakdown.activation.clients,
              projects: breakdown.activation.projects,
              timeEntries: breakdown.activation.timeEntries,
            })}
          />
          <CategoryRow
            label={t("health.monetization")}
            score={breakdown.monetization.score}
            max={breakdown.monetization.max}
            detail={
              breakdown.monetization.subscriptionStatus ??
              t("health.noSubscription")
            }
          />
          <CategoryRow
            label={t("health.engagement")}
            score={breakdown.engagement.score}
            max={breakdown.engagement.max}
            detail={t("health.logins", {
              count: breakdown.engagement.loginsLast30Days,
            })}
          />
          <CategoryRow
            label={t("health.value")}
            score={breakdown.value.score}
            max={breakdown.value.max}
            detail={t("health.invoices", { count: breakdown.value.invoices })}
          />
        </div>

        {/* Penalties */}
        {totalPenalty > 0 && (
          <div className="mt-4 rounded-lg border border-red-200 bg-red-50/50 p-3 text-sm">
            <div className="flex items-center gap-2 font-medium text-red-800">
              <ShieldAlert className="h-4 w-4" />
              {t("health.penalties", { total: totalPenalty })}
            </div>
            <ul className="mt-1 space-y-0.5 text-xs text-red-700">
              {penalties.flagged > 0 && (
                <li>{t("health.penaltyFlagged", { n: penalties.flagged })}</li>
              )}
              {penalties.banned > 0 && (
                <li>{t("health.penaltyBanned", { n: penalties.banned })}</li>
              )}
              {penalties.pastDue > 0 && (
                <li>{t("health.penaltyPastDue", { n: penalties.pastDue })}</li>
              )}
            </ul>
          </div>
        )}

        {/* Quick action hint when score is low */}
        {score < 40 && (
          <div className="mt-4 flex items-start gap-2 rounded-lg border border-brand-200 bg-brand-50/50 p-3 text-xs text-brand-900">
            <Activity className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <p>
              {t.rich("health.lowScore", {
                strong: (chunks) => <strong>{chunks}</strong>,
              })}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
