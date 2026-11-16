import { EyeOff, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { AddMatcherForm } from "@/components/identity/AddMatcherForm";
import {
  KIND_ICON,
  KIND_LABEL_KEY,
  truncateMiddle,
} from "@/components/identity/kinds";
import { ProjectMatcherWizard } from "@/components/identity/ProjectMatcherWizard";
import { tauriInvoke } from "@/lib/tauri";
import type { ApplyResult, ProjectMatcher } from "@/lib/types";
import { toast } from "@/stores/toastStore";

/**
 * "Projekt-genkendelse": bind the signals the tracker captures (git repo,
 * folder, domain) to projects, so time is attributed automatically — and see or
 * remove the bindings that already exist.
 */
export function IdentitySettings() {
  const { t } = useTranslation();
  const [matchers, setMatchers] = useState<ProjectMatcher[]>([]);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);

  const loadMatchers = useCallback(async () => {
    try {
      setMatchers(await tauriInvoke<ProjectMatcher[]>("list_project_matchers"));
    } catch {
      // Non-critical: the wizard still works without the list.
    }
  }, []);

  useEffect(() => {
    loadMatchers();
  }, [loadMatchers]);

  async function handleDelete(id: number) {
    setConfirmDeleteId(null);
    try {
      await tauriInvoke<ApplyResult>("delete_project_matcher", { id });
      toast.success(t("identity.matcherDeleted"));
      loadMatchers();
    } catch {
      toast.error(t("identity.deleteFailed"));
    }
  }

  return (
    <div className="space-y-8">
      <p className="text-xs text-(--color-text-muted)">{t("identity.intro")}</p>

      <section>
        <ProjectMatcherWizard onChanged={loadMatchers} />
      </section>

      <section className="space-y-3">
        <div>
          <h3 className="text-sm font-semibold text-(--color-text)">
            {t("identity.matchersTitle")}
          </h3>
          <p className="mt-0.5 text-xs text-(--color-text-muted)">
            {t("identity.matchersDescription")}
          </p>
        </div>

        <AddMatcherForm onChanged={loadMatchers} />

        {matchers.length === 0 ? (
          <p className="text-xs text-(--color-text-muted)">
            {t("identity.noMatchers")}
          </p>
        ) : (
          <ul className="space-y-1.5">
            {matchers.map((m) => {
              // Only a signal naming NEITHER a project nor a customer is
              // "not work" — a customer-only binding is a real, billable target
              // and must not be shown as private.
              const isPrivate = !m.projectId && !m.clientId;
              const Icon = isPrivate ? EyeOff : KIND_ICON[m.kind];
              return (
                <li
                  key={m.id}
                  className="flex items-center justify-between gap-2 rounded-md border border-(--color-border) bg-(--color-bg) px-3 py-1.5 text-xs"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <Icon
                      size={13}
                      className="shrink-0 text-(--color-text-muted)"
                    />
                    <span className="shrink-0 text-(--color-text-muted)">
                      {t(KIND_LABEL_KEY[m.kind])}
                    </span>
                    <span
                      title={m.value}
                      className="min-w-0 truncate font-medium text-(--color-text)"
                    >
                      {truncateMiddle(m.value, 40)}
                    </span>
                    <span className="shrink-0 text-(--color-text-muted)">
                      →
                    </span>
                    <span
                      className={`shrink-0 font-medium ${
                        isPrivate
                          ? "text-(--color-text-muted)"
                          : "text-(--color-accent)"
                      }`}
                    >
                      {m.projectId
                        ? (m.projectName ?? t("identity.unknownProject"))
                        : m.clientId
                          ? (m.clientName ?? t("identity.unknownClient"))
                          : t("identity.matcherPrivate")}
                    </span>
                  </span>

                  {confirmDeleteId === m.id ? (
                    <span className="flex shrink-0 items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => handleDelete(m.id)}
                        className="rounded px-1.5 py-0.5 text-[11px] font-medium text-red-500 transition-colors hover:bg-red-500/10"
                      >
                        {t("common.delete")}
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteId(null)}
                        className="rounded px-1.5 py-0.5 text-[11px] text-(--color-text-muted) transition-colors hover:text-(--color-text)"
                      >
                        {t("common.cancel")}
                      </button>
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmDeleteId(m.id)}
                      aria-label={t("identity.deleteMatcher")}
                      className="shrink-0 rounded p-1 text-(--color-text-muted) transition-colors hover:text-red-500"
                    >
                      <Trash2 size={13} />
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
