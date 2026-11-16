import { Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { PickerLoadError } from "@/components/ui/PickerLoadError";
import { useProjectClientPicker } from "@/hooks/useProjectClientPicker";
import { tauriInvoke } from "@/lib/tauri";
import type { ApplyResult, MatcherKind } from "@/lib/types";
import { toast } from "@/stores/toastStore";
import { KIND_LABEL_KEY } from "./kinds";

/** Kinds a user may create by hand. Ordered strongest evidence first. */
const KINDS: MatcherKind[] = ["git_repo", "path", "domain", "keyword", "app"];

interface AddMatcherFormProps {
  onChanged?: () => void;
}

/**
 * Bind a signal to a project or a customer by hand.
 *
 * The wizard covers the signals the tracker can enumerate on its own, but some
 * live only INSIDE a window title — an Obsidian vault, a client name in a
 * document. Those apps hold several projects at once, so binding the whole app
 * would misattribute them; a title keyword ("video-studio") is the correct,
 * precise handle. This form is how the user reaches for it.
 *
 * A customer is a target in its own right: a client with no projects still has a
 * portal and an inbox, and those signals have no project to attach to. Only
 * naming neither marks the signal as not work.
 */
export function AddMatcherForm({ onChanged }: AddMatcherFormProps) {
  const { t } = useTranslation();
  // Én hentning for begge valg, én fejltilstand: et signal skal kunne pege på
  // en kunde uden projekt, så de to lister hører sammen.
  const { projects, clients, loadFailed, retry } = useProjectClientPicker();
  const [kind, setKind] = useState<MatcherKind>("keyword");
  const [value, setValue] = useState("");
  // "" means the signal names neither a project nor a customer, i.e. it is
  // deliberately NOT work (private).
  const [projectId, setProjectId] = useState("");
  const [clientId, setClientId] = useState("");
  const [saving, setSaving] = useState(false);

  // The customer follows the project, in one direction only: a project sets the
  // customer to its own, so a signal can never name two conflicting parties.
  // Choosing "no project" keeps the customer on purpose — that is the whole
  // point of a customer-only binding.
  useEffect(() => {
    if (!projectId) return;
    const project = projects.find((p) => p.id === projectId);
    if (!project) return;
    setClientId(project.client_id ?? "");
  }, [projectId, projects]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = value.trim();
    if (!trimmed || saving) return;

    setSaving(true);
    try {
      const result = await tauriInvoke<ApplyResult>("add_project_matcher", {
        matcher: {
          projectId: projectId || null,
          clientId: clientId || null,
          kind,
          value: trimmed,
        },
      });
      toast.success(
        t("identity.matcherAdded", { minutes: result.classifiedMinutes }),
      );
      setValue("");
      onChanged?.();
    } catch (err) {
      // The backend refuses e.g. an app binding on a browser/editor and explains
      // why — surface that reason rather than a generic failure.
      toast.error(typeof err === "string" ? err : t("identity.bindFailed"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-wrap items-end gap-2">
      <label className="flex flex-col gap-1">
        <span className="text-[11px] text-(--color-text-muted)">
          {t("identity.formKind")}
        </span>
        <select
          value={kind}
          onChange={(e) => setKind(e.target.value as MatcherKind)}
          className="h-8 rounded-md border border-(--color-border) bg-(--color-bg) px-2 text-xs text-(--color-text)"
        >
          {KINDS.map((k) => (
            <option key={k} value={k}>
              {t(KIND_LABEL_KEY[k])}
            </option>
          ))}
        </select>
      </label>

      <label className="flex min-w-[12rem] flex-1 flex-col gap-1">
        <span className="text-[11px] text-(--color-text-muted)">
          {t("identity.formValue")}
        </span>
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={t(`identity.formPlaceholder_${kind}`)}
          className="h-8 rounded-md border border-(--color-border) bg-(--color-bg) px-2 text-xs text-(--color-text) placeholder:text-(--color-text-muted)"
        />
      </label>

      {loadFailed && <PickerLoadError kind={loadFailed} onRetry={retry} />}

      <label className="flex flex-col gap-1">
        <span className="text-[11px] text-(--color-text-muted)">
          {t("identity.formProject")}
        </span>
        <select
          value={projectId}
          onChange={(e) => setProjectId(e.target.value)}
          className="h-8 rounded-md border border-(--color-border) bg-(--color-bg) px-2 text-xs text-(--color-text)"
        >
          <option value="">{t("identity.noProject")}</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-[11px] text-(--color-text-muted)">
          {t("identity.formClient")}
        </span>
        <select
          value={clientId}
          // A project's own customer is not a choice, so the field locks while
          // a project is picked — otherwise two fields would both look like they
          // decide whether the signal is work or not. Locked also means this is
          // exactly where a project without a customer shows up, so its empty
          // option reads "no customer": "Privat (ikke arbejde)" is only true of
          // a signal with neither column set (the row IdentitySettings shows).
          disabled={Boolean(projectId)}
          onChange={(e) => setClientId(e.target.value)}
          className="h-8 rounded-md border border-(--color-border) bg-(--color-bg) px-2 text-xs text-(--color-text) disabled:opacity-60"
        >
          <option value="">{t("form.noClient")}</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>

      <button
        type="submit"
        disabled={!value.trim() || saving}
        className="flex h-8 items-center gap-1.5 rounded-md bg-(--color-accent) px-3 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40"
      >
        <Plus size={13} />
        {t("identity.formAdd")}
      </button>
    </form>
  );
}
