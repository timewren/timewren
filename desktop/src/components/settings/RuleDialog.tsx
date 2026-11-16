import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Input } from "@/components/ui/Input";
import { PickerLoadError } from "@/components/ui/PickerLoadError";
import type { PickerLoadKind } from "@/hooks/useProjectClientPicker";
import { tauriInvoke } from "@/lib/tauri";
import type { Project } from "@/lib/types";
import { toast } from "@/stores/toastStore";

export interface ClassificationRule {
  id: number;
  name: string;
  priority: number;
  condition_type: string;
  condition_op: string;
  condition_value: string;
  target_project_id: string | null;
  target_category: string | null;
  is_active: boolean;
  created_at: string;
}

export interface CreateRuleInput {
  name: string;
  priority?: number;
  condition_type: string;
  condition_op: string;
  condition_value: string;
  target_project_id?: string | null;
  target_category?: string | null;
}

export const CONDITION_TYPE_KEYS: Record<string, string> = {
  app_name: "ai.conditionAppName",
  window_title: "ai.conditionWindowTitle",
  url: "ai.conditionUrl",
  git_repo: "ai.conditionGitRepo",
};

export const CONDITION_OP_KEYS: Record<string, string> = {
  contains: "ai.opContains",
  equals: "ai.opEquals",
  starts_with: "ai.opStartsWith",
  regex: "ai.opRegex",
};

const CONDITION_TYPE_VALUES = ["app_name", "window_title", "url", "git_repo"];
const CONDITION_OP_VALUES = ["contains", "equals", "starts_with", "regex"];

interface RuleFormState {
  name: string;
  condition_type: string;
  condition_op: string;
  condition_value: string;
  target_project_id: string | null;
  target_category: string | null;
}

interface RuleDialogProps {
  open: boolean;
  onClose: () => void;
  /** Called after a successful save (and optional retroactive apply). */
  onSaved: () => void;
  projects: Project[];
  /**
   * Kun den kunde, der har hentet listerne, ved om de kom. Uden den er en
   * dropdown uden valg det samme som «brugeren har ingen projekter» — men
   * her kommer listerne fra den kaldende komponent, så den skal også fortælle
   * det, når de *ikke* kom. `TimelineView` henter dem sammen med aktiviteterne
   * og har derfor sin egen fejlskærm over hele visningen.
   */
  projectsLoadFailed?: PickerLoadKind;
  onRetryProjects?: () => void;
  /** When set, the dialog edits an existing rule instead of creating one. */
  editingRule?: ClassificationRule | null;
  /** Prefilled fields for a brand-new rule (e.g. from a timeline activity). */
  initialForm?: Partial<CreateRuleInput> | null;
}

function buildInitialState(
  editingRule?: ClassificationRule | null,
  initialForm?: Partial<CreateRuleInput> | null,
): RuleFormState {
  if (editingRule) {
    return {
      name: editingRule.name,
      condition_type: editingRule.condition_type,
      condition_op: editingRule.condition_op,
      condition_value: editingRule.condition_value,
      target_project_id: editingRule.target_project_id,
      target_category: editingRule.target_category,
    };
  }
  return {
    name: initialForm?.name ?? "",
    condition_type: initialForm?.condition_type ?? "app_name",
    condition_op: initialForm?.condition_op ?? "contains",
    condition_value: initialForm?.condition_value ?? "",
    target_project_id: initialForm?.target_project_id ?? null,
    target_category: initialForm?.target_category ?? null,
  };
}

export function RuleDialog({
  open,
  onClose,
  onSaved,
  projects,
  projectsLoadFailed,
  onRetryProjects,
  editingRule,
  initialForm,
}: RuleDialogProps) {
  const { t } = useTranslation();
  const [form, setForm] = useState<RuleFormState>(() =>
    buildInitialState(editingRule, initialForm),
  );
  const [applyToHistory, setApplyToHistory] = useState(false);
  const [previewCount, setPreviewCount] = useState<number | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  // Re-seed the form whenever the dialog opens or its subject changes.
  useEffect(() => {
    if (!open) return;
    setForm(buildInitialState(editingRule, initialForm));
    setApplyToHistory(false);
    setPreviewCount(null);
  }, [open, editingRule, initialForm]);

  // When "apply to history" is on, ask the backend how many unconfirmed
  // activities the current condition would reclassify. Uses the exact same
  // matcher as the real apply, so the number shown is what will change.
  useEffect(() => {
    if (!open || !applyToHistory || !form.condition_value) {
      setPreviewCount(null);
      return;
    }
    let cancelled = false;
    setPreviewLoading(true);
    tauriInvoke<number>("preview_rule_application", {
      conditionType: form.condition_type,
      conditionOp: form.condition_op,
      conditionValue: form.condition_value,
    })
      .then((n) => {
        if (!cancelled) setPreviewCount(n);
      })
      .catch(() => {
        if (!cancelled) setPreviewCount(null);
      })
      .finally(() => {
        if (!cancelled) setPreviewLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [
    open,
    applyToHistory,
    form.condition_type,
    form.condition_op,
    form.condition_value,
  ]);

  async function handleSave() {
    if (!form.name || !form.condition_value) return;
    setSaving(true);

    // Save the rule first. Only a failure HERE means the rule wasn't saved —
    // a later history-apply failure must not be reported as a save failure
    // (that would make the user re-save and create a duplicate rule).
    try {
      if (editingRule) {
        await tauriInvoke("update_rule", {
          rule: {
            ...editingRule,
            name: form.name,
            condition_type: form.condition_type,
            condition_op: form.condition_op,
            condition_value: form.condition_value,
            target_project_id: form.target_project_id,
            target_category: form.target_category,
          },
        });
      } else {
        const input: CreateRuleInput = {
          name: form.name,
          condition_type: form.condition_type,
          condition_op: form.condition_op,
          condition_value: form.condition_value,
          target_project_id: form.target_project_id,
          target_category: form.target_category,
        };
        await tauriInvoke("create_rule", { input });
      }
    } catch (err) {
      console.error("Failed to save rule:", err);
      toast.error(t("ai.couldNotSaveRule"));
      setSaving(false);
      return;
    }

    toast.success(editingRule ? t("ai.ruleUpdated") : t("ai.ruleCreated"));

    // The rule is now persisted. Applying it to history is a separate,
    // non-fatal step — its failure gets its own message.
    if (applyToHistory) {
      try {
        const changed = await tauriInvoke<number>("apply_rule_to_history", {
          conditionType: form.condition_type,
          conditionOp: form.condition_op,
          conditionValue: form.condition_value,
          projectId: form.target_project_id,
          category: form.target_category,
        });
        toast.success(t("ai.appliedToHistory", { count: changed }));
      } catch (err) {
        console.error("Failed to apply rule to history:", err);
        toast.error(t("ai.historyApplyFailed"));
      }
    }

    setSaving(false);
    onSaved();
  }

  const activeProjects = projects.filter((p) => !p.is_archived);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={editingRule ? t("ai.editRule") : t("ai.createRule")}
      footer={
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={onClose}
            disabled={saving}
          >
            {t("common.cancel")}
          </Button>
          <Button
            size="sm"
            onClick={handleSave}
            disabled={saving || !form.name || !form.condition_value}
          >
            {saving
              ? t("common.saving")
              : editingRule
                ? t("common.save")
                : t("common.create")}
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
        {projectsLoadFailed && onRetryProjects && (
          <PickerLoadError
            kind={projectsLoadFailed}
            onRetry={onRetryProjects}
          />
        )}

        <Input
          label={t("ai.ruleName")}
          value={form.name}
          onChange={(e) =>
            setForm((prev) => ({ ...prev, name: e.target.value }))
          }
          placeholder={t("ai.ruleNamePlaceholder")}
        />

        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="rule-condition-type"
            className="text-xs font-medium text-(--color-text-muted)"
          >
            {t("ai.conditionType")}
          </label>
          <select
            id="rule-condition-type"
            value={form.condition_type}
            onChange={(e) =>
              setForm((prev) => ({ ...prev, condition_type: e.target.value }))
            }
            className="h-9 rounded-md border border-(--color-border) bg-(--color-bg) px-3 text-sm text-(--color-text) focus:border-(--color-accent) focus:outline-none focus:ring-2 focus:ring-(--color-accent)/20"
          >
            {CONDITION_TYPE_VALUES.map((val) => (
              <option key={val} value={val}>
                {t(CONDITION_TYPE_KEYS[val] ?? val)}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="rule-condition-op"
            className="text-xs font-medium text-(--color-text-muted)"
          >
            {t("ai.operator")}
          </label>
          <select
            id="rule-condition-op"
            value={form.condition_op}
            onChange={(e) =>
              setForm((prev) => ({ ...prev, condition_op: e.target.value }))
            }
            className="h-9 rounded-md border border-(--color-border) bg-(--color-bg) px-3 text-sm text-(--color-text) focus:border-(--color-accent) focus:outline-none focus:ring-2 focus:ring-(--color-accent)/20"
          >
            {CONDITION_OP_VALUES.map((val) => (
              <option key={val} value={val}>
                {t(CONDITION_OP_KEYS[val] ?? val)}
              </option>
            ))}
          </select>
        </div>

        <Input
          label={t("ai.value")}
          value={form.condition_value}
          onChange={(e) =>
            setForm((prev) => ({ ...prev, condition_value: e.target.value }))
          }
          placeholder={t("ai.valuePlaceholder")}
        />

        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="rule-target-project"
            className="text-xs font-medium text-(--color-text-muted)"
          >
            {t("ai.targetProject")}
          </label>
          <select
            id="rule-target-project"
            value={form.target_project_id ?? ""}
            onChange={(e) =>
              setForm((prev) => ({
                ...prev,
                target_project_id: e.target.value || null,
              }))
            }
            className="h-9 rounded-md border border-(--color-border) bg-(--color-bg) px-3 text-sm text-(--color-text) focus:border-(--color-accent) focus:outline-none focus:ring-2 focus:ring-(--color-accent)/20"
          >
            <option value="">{t("common.noProject")}</option>
            {activeProjects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
                {project.client_name ? ` (${project.client_name})` : ""}
              </option>
            ))}
          </select>
        </div>

        <Input
          label={t("ai.category")}
          value={form.target_category ?? ""}
          onChange={(e) =>
            setForm((prev) => ({
              ...prev,
              target_category: e.target.value || null,
            }))
          }
          placeholder={t("ai.categoryPlaceholder")}
        />

        {/* Retroactive application */}
        <div className="rounded-md border border-(--color-border) bg-(--color-bg) p-3">
          <label className="flex cursor-pointer items-start gap-2.5">
            <input
              type="checkbox"
              checked={applyToHistory}
              onChange={(e) => setApplyToHistory(e.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 accent-(--color-accent)"
            />
            <span className="flex flex-col gap-0.5">
              <span className="text-sm font-medium text-(--color-text)">
                {t("ai.applyToHistory")}
              </span>
              <span className="text-xs text-(--color-text-muted)">
                {t("ai.applyToHistoryDescription")}
              </span>
            </span>
          </label>

          {applyToHistory && (
            <div className="mt-2 pl-6 text-xs text-(--color-text-muted)">
              {previewLoading ? (
                <span className="flex items-center gap-1.5">
                  <Loader2 size={12} className="animate-spin" />
                  {t("ai.previewLoading")}
                </span>
              ) : previewCount !== null ? (
                <span className="text-(--color-accent)">
                  {t("ai.applyPreview", { count: previewCount })}
                </span>
              ) : (
                <span>{t("ai.applyPreviewEmpty")}</span>
              )}
            </div>
          )}
        </div>
      </div>
    </Dialog>
  );
}
