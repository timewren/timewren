import { Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { tauriInvoke } from "@/lib/tauri";
import { toast } from "@/stores/toastStore";

type TFunction = (key: string) => string;

interface ExclusionRule {
  id: number;
  field: string;
  op: string;
  value: string;
  is_active: boolean;
  created_at: string;
}

/**
 * `value` er Rust's egne strenge — de må ikke oversættes, for så matcher
 * reglen ikke længere vinduet. `key` er etiketten, brugeren læser.
 */
const FIELDS = [
  { value: "window_title", key: "exclusion.windowTitle" },
  { value: "app_name", key: "exclusion.appName" },
];
const OPS = [
  { value: "contains", key: "exclusion.opContains" },
  { value: "equals", key: "exclusion.opEquals" },
  { value: "starts_with", key: "exclusion.opStartsWith" },
  { value: "regex", key: "exclusion.opRegex" },
];

const fieldClass =
  "rounded-md border border-(--color-border) bg-(--color-bg) px-2 text-xs text-(--color-text)";

/**
 * En regel kan have et felt eller en operator, der ikke findes i kortene —
 * fx en regel fra en nyere version af appen. Så viser vi den rå værdi, for
 * brugeren skal kunne genkende den og slette den.
 */
function fieldLabel(t: TFunction, v: string) {
  const felt = FIELDS.find((f) => f.value === v);
  return felt ? t(felt.key) : v;
}
function opLabel(t: TFunction, v: string) {
  const op = OPS.find((o) => o.value === v);
  return op ? t(op.key) : v;
}

/**
 * Manage privacy exclusion rules — windows matching an active rule are never
 * tracked. New rules take effect on the next app restart (the tracker reads
 * them at startup).
 */
export function ExclusionRulesManager() {
  const { t } = useTranslation();
  const [rules, setRules] = useState<ExclusionRule[]>([]);
  const [field, setField] = useState("window_title");
  const [op, setOp] = useState("contains");
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);

  const load = useCallback(() => {
    tauriInvoke<ExclusionRule[]>("list_exclusion_rules")
      .then(setRules)
      .catch(() => {
        // Listen er tom, og brugeren skal ikke tro han har ingen regler. En
        // regel han ikke kan se, er en regel han ikke kan slette.
        toast.error(t("exclusion.loadFailed"));
      });
  }, [t]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleAdd() {
    if (!value.trim() || busy) return;
    setBusy(true);
    try {
      await tauriInvoke("add_exclusion_rule", { field, op, value });
      setValue("");
      toast.success(t("exclusion.ruleAdded"));
      load();
    } catch {
      // Samme som ved sletning: brugeren skal vide at reglen *ikke* er med,
      // ellers går han og regner med at et vindue han vil skjule bliver
      // registreret alligevel.
      toast.error(t("exclusion.addFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(id: number) {
    setConfirmDeleteId(null);
    try {
      await tauriInvoke("delete_exclusion_rule", { id });
      load();
    } catch {
      // Råt viser vi ikke database-fejlen, men konsekvensen: reglen er stadig
      // med, og den bruger troede var væk. Det er det han skal vide.
      toast.error(t("exclusion.deleteFailed"));
    }
  }

  return (
    <div className="space-y-3">
      {rules.length > 0 && (
        <ul className="space-y-1.5">
          {rules.map((r) => (
            <li
              key={r.id}
              className="flex items-center justify-between gap-2 rounded-md border border-(--color-border) bg-(--color-bg) px-3 py-1.5 text-xs"
            >
              <span className="min-w-0 truncate text-(--color-text)">
                <span className="text-(--color-text-muted)">
                  {fieldLabel(t, r.field)} {opLabel(t, r.op)}{" "}
                </span>
                <span className="font-medium">"{r.value}"</span>
              </span>
              {confirmDeleteId === r.id ? (
                <span className="flex shrink-0 items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => handleDelete(r.id)}
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
                  onClick={() => setConfirmDeleteId(r.id)}
                  aria-label={t("exclusion.deleteRule")}
                  className="shrink-0 rounded p-1 text-(--color-text-muted) transition-colors hover:text-red-500"
                >
                  <Trash2 size={13} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <select
          aria-label={t("exclusion.field")}
          value={field}
          onChange={(e) => setField(e.target.value)}
          className={`h-8 ${fieldClass}`}
        >
          {FIELDS.map((f) => (
            <option key={f.value} value={f.value}>
              {t(f.key)}
            </option>
          ))}
        </select>
        <select
          aria-label={t("exclusion.operator")}
          value={op}
          onChange={(e) => setOp(e.target.value)}
          className={`h-8 ${fieldClass}`}
        >
          {OPS.map((o) => (
            <option key={o.value} value={o.value}>
              {t(o.key)}
            </option>
          ))}
        </select>
        <input
          aria-label={t("exclusion.value")}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleAdd();
          }}
          placeholder={t("exclusion.valuePlaceholder")}
          className={`h-8 min-w-0 flex-1 ${fieldClass}`}
        />
        <button
          type="button"
          onClick={handleAdd}
          disabled={!value.trim() || busy}
          className="inline-flex h-8 items-center gap-1 rounded-md bg-(--color-accent) px-2.5 text-xs font-medium text-white transition-colors hover:bg-(--color-accent-hover) disabled:opacity-50"
        >
          <Plus size={13} />
          {t("exclusion.add")}
        </button>
      </div>
    </div>
  );
}
