"use client";

import {
  Filter,
  Mail,
  Plus,
  Shield,
  ToggleLeft,
  ToggleRight,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useId, useState } from "react";
import { toast } from "sonner";
import { LoadingScreen } from "@/components/ui/LoadingScreen";
import { toIntlLocale } from "@/i18n/format-locale";
import { useSession } from "@/lib/auth-client";
import { trpc } from "@/providers/trpc-provider";

const RULE_TYPE_KEYS: Record<string, string> = {
  sender_email: "ruleSenderEmail",
  sender_domain: "ruleSenderDomain",
  subject_contains: "ruleSubject",
};

export default function EmailFiltersPage() {
  const fid = useId();
  const t = useTranslations("settingsEmailIntegration.filters");
  const { data: session, isPending } = useSession();
  const utils = trpc.useUtils();

  const { data: rules, isLoading } = trpc.emailTasks.getFilterRules.useQuery();

  const [newRuleType, setNewRuleType] = useState<string>("sender_domain");
  const [newPattern, setNewPattern] = useState("");
  const [showAddForm, setShowAddForm] = useState(false);

  const deleteMutation = trpc.emailTasks.deleteFilterRule.useMutation({
    onSuccess: () => {
      utils.emailTasks.getFilterRules.invalidate();
      toast.success(t("deleted"));
    },
  });

  const toggleMutation = trpc.emailTasks.toggleFilterRule.useMutation({
    onSuccess: () => {
      utils.emailTasks.getFilterRules.invalidate();
    },
  });

  const addManualMutation = trpc.emailTasks.addManualRule.useMutation({
    onSuccess: () => {
      utils.emailTasks.getFilterRules.invalidate();
      toast.success(t("created"));
      setNewPattern("");
      setShowAddForm(false);
    },
    onError: (error) => {
      toast.error(error.message || t("createFailed"));
    },
  });

  if (isPending || isLoading) {
    return <LoadingScreen message={t("loading")} />;
  }

  if (!session) {
    return null;
  }

  const activeRules = rules?.filter((r) => r.isActive) || [];
  const inactiveRules = rules?.filter((r) => !r.isActive) || [];

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
          <Mail className="h-4 w-4" />
          <Link
            href="/dashboard/settings/email?tab=integration"
            className="hover:text-gray-700 dark:hover:text-gray-300"
          >
            {t("breadcrumb")}
          </Link>
          <span>/</span>
          <span>{t("breadcrumbCurrent")}</span>
        </div>
        <h1 className="text-2xl font-semibold text-gray-900 dark:text-white">
          {t("title")}
        </h1>
        <p className="text-gray-600 dark:text-gray-400">{t("intro")}</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-gray-200/80 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
          <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
            <Shield className="h-4 w-4" />
            {t("statActive")}
          </div>
          <div className="mt-1 text-2xl tabular-nums font-semibold text-gray-900 dark:text-white">
            {activeRules.length}
          </div>
        </div>
        <div className="rounded-xl border border-gray-200/80 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
          <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
            <Filter className="h-4 w-4" />
            {t("statFiltered")}
          </div>
          <div className="mt-1 text-2xl tabular-nums font-semibold text-gray-900 dark:text-white">
            {rules?.reduce((sum, r) => sum + r.matchCount, 0) || 0}
          </div>
        </div>
        <div className="rounded-xl border border-gray-200/80 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
          <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
            <Mail className="h-4 w-4" />
            {t("statTypes")}
          </div>
          <div className="mt-1 text-2xl tabular-nums font-semibold text-gray-900 dark:text-white">
            {new Set(rules?.map((r) => r.ruleType)).size || 0}
          </div>
        </div>
      </div>

      {/* Add manual rule */}
      <div className="rounded-xl border border-gray-200/80 bg-white p-6 dark:border-gray-800 dark:bg-gray-900">
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-white">
            <Plus className="h-4 w-4" /> {t("addManual")}
          </h2>
          <button
            type="button"
            onClick={() => setShowAddForm(!showAddForm)}
            className="text-sm text-brand-600 hover:text-brand-700 dark:text-brand-400 dark:hover:text-brand-300"
          >
            {showAddForm ? t("cancel") : t("addRule")}
          </button>
        </div>

        {showAddForm && (
          <div className="mt-4 flex flex-wrap items-end gap-3">
            <div>
              <label
                htmlFor={`${fid}-f1`}
                className="mb-1.5 block text-xs font-medium text-gray-500 dark:text-gray-400"
              >
                {t("ruleType")}
              </label>
              <select
                id={`${fid}-f1`}
                className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white px-3 py-1.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20"
                value={newRuleType}
                onChange={(e) => setNewRuleType(e.target.value)}
              >
                <option value="sender_domain">{t("ruleSenderDomain")}</option>
                <option value="sender_email">{t("ruleSenderEmail")}</option>
                <option value="subject_contains">{t("ruleSubject")}</option>
              </select>
            </div>
            <div className="flex-1">
              <label
                htmlFor={`${fid}-f2`}
                className="mb-1.5 block text-xs font-medium text-gray-500 dark:text-gray-400"
              >
                {newRuleType === "sender_domain"
                  ? t("labelDomain")
                  : newRuleType === "sender_email"
                    ? t("labelEmail")
                    : t("labelSubject")}
              </label>
              <input
                id={`${fid}-f2`}
                type="text"
                className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white px-3 py-1.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20"
                placeholder={
                  newRuleType === "sender_domain"
                    ? t("phDomain")
                    : newRuleType === "sender_email"
                      ? t("phEmail")
                      : t("phSubject")
                }
                value={newPattern}
                onChange={(e) => setNewPattern(e.target.value)}
              />
            </div>
            <button
              type="button"
              className="rounded-lg bg-tt-gran px-4 py-2 text-sm font-medium text-tt-paa-gran hover:bg-tt-gran-moerk disabled:opacity-50"
              disabled={!newPattern.trim() || addManualMutation.isPending}
              onClick={() => {
                addManualMutation.mutate({
                  ruleType: newRuleType as
                    | "sender_email"
                    | "sender_domain"
                    | "subject_contains",
                  pattern: newPattern.trim(),
                });
              }}
            >
              {t("add")}
            </button>
          </div>
        )}
      </div>

      {/* Active rules */}
      <div className="rounded-xl border border-gray-200/80 bg-white p-6 dark:border-gray-800 dark:bg-gray-900">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-white">
          <Shield className="h-4 w-4" />{" "}
          {t("activeTitle", { count: activeRules.length })}
        </h2>
        <div className="mt-4 space-y-2">
          {activeRules.length > 0 ? (
            activeRules.map((rule) => (
              <RuleRow
                key={rule.id}
                rule={rule}
                onToggle={() =>
                  toggleMutation.mutate({
                    ruleId: rule.id,
                    isActive: false,
                  })
                }
                onDelete={() => deleteMutation.mutate({ ruleId: rule.id })}
              />
            ))
          ) : (
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {t("activeEmpty")}
            </p>
          )}
        </div>
      </div>

      {/* Inactive rules */}
      {inactiveRules.length > 0 && (
        <div className="rounded-xl border border-gray-200/80 bg-white p-6 dark:border-gray-800 dark:bg-gray-900">
          <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400">
            {t("inactiveTitle", { count: inactiveRules.length })}
          </h2>
          <div className="mt-4 space-y-2">
            {inactiveRules.map((rule) => (
              <RuleRow
                key={rule.id}
                rule={rule}
                onToggle={() =>
                  toggleMutation.mutate({
                    ruleId: rule.id,
                    isActive: true,
                  })
                }
                onDelete={() => deleteMutation.mutate({ ruleId: rule.id })}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function RuleRow({
  rule,
  onToggle,
  onDelete,
}: {
  rule: {
    id: string;
    ruleType: string;
    pattern: string;
    isActive: boolean;
    matchCount: number;
    lastMatchedAt: Date | null;
    sourceEmailSubject: string | null;
    sourceEmailFrom: string | null;
    createdAt: Date;
  };
  onToggle: () => void;
  onDelete: () => void;
}) {
  const t = useTranslations("settingsEmailIntegration.filters");
  const locale = useLocale();
  const dateOf = (d: Date) =>
    new Date(d).toLocaleDateString(toIntlLocale(locale));
  return (
    <div
      className={`flex items-center justify-between rounded-lg border p-3 ${
        rule.isActive
          ? "border-gray-200 bg-gray-50"
          : "border-gray-100 bg-gray-25 opacity-60"
      }`}
    >
      <div className="flex-1">
        <div className="flex items-center gap-2">
          <span className="rounded bg-brand-100 px-2 py-0.5 text-xs font-medium text-brand-700 dark:text-brand-400">
            {RULE_TYPE_KEYS[rule.ruleType]
              ? t(RULE_TYPE_KEYS[rule.ruleType])
              : rule.ruleType}
          </span>
          <span className="font-mono text-sm text-gray-900">
            {rule.pattern}
          </span>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-gray-500">
          <span>{t("matched", { count: rule.matchCount })}</span>
          {rule.lastMatchedAt && (
            <span>
              {t("lastMatched", { date: dateOf(rule.lastMatchedAt) })}
            </span>
          )}
          {rule.sourceEmailSubject && (
            <span className="max-w-xs truncate" title={rule.sourceEmailSubject}>
              {t("from", { subject: rule.sourceEmailSubject })}
            </span>
          )}
          <span>{t("createdOn", { date: dateOf(rule.createdAt) })}</span>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onToggle}
          className="rounded p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
          title={rule.isActive ? t("deactivate") : t("activate")}
        >
          {rule.isActive ? (
            <ToggleRight className="h-5 w-5 text-green-600" />
          ) : (
            <ToggleLeft className="h-5 w-5" />
          )}
        </button>
        <button
          type="button"
          onClick={onDelete}
          className="rounded p-1 text-gray-400 hover:text-red-600 dark:hover:text-red-400"
          title={t("delete")}
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
