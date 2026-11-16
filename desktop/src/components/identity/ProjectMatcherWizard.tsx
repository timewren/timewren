import { CheckCircle2, Loader2, RefreshCw, Sparkles } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/Button";
import { LoadError } from "@/components/ui/LoadError";
import { PickerLoadError } from "@/components/ui/PickerLoadError";
import { useProjectClientPicker } from "@/hooks/useProjectClientPicker";
import { formatDuration } from "@/lib/format";
import { tauriInvoke } from "@/lib/tauri";
import type { ApplyResult, UnmappedSignal } from "@/lib/types";
import { toast } from "@/stores/toastStore";
import { KIND_ICON, KIND_LABEL_KEY, truncateMiddle } from "./kinds";

/** How far back discovery looks. Two weeks covers a normal work rhythm. */
const DISCOVERY_DAYS = 14;

function signalKey(signal: UnmappedSignal): string {
  return `${signal.kind}:${signal.value}`;
}

interface ProjectMatcherWizardProps {
  /** Called after a matcher was added, so the surrounding page can refresh. */
  onChanged?: () => void;
}

/**
 * The cold-start breaker: shows the signals the tracker already captured that
 * point at no project, ranked by how much time they cost, and binds each one to
 * a project or a customer (or to "private") in a single click.
 *
 * Rows are removed locally after a binding instead of reloading the list — a
 * reload would re-sort the remaining rows under the user's cursor.
 */
export function ProjectMatcherWizard({ onChanged }: ProjectMatcherWizardProps) {
  const { t } = useTranslation();
  const [signals, setSignals] = useState<UnmappedSignal[]>([]);
  // Signalerne er deres egen liste — de kommer fra trackeren, ikke fra en vælger,
  // så de har deres egen fejltilstand. Listerne er hookens, fordi et signal kan
  // pege på både et projekt og en kunde, og de hører derfor sammen.
  const [signalsLoadFailed, setSignalsLoadFailed] = useState(false);
  const { projects, clients, loadFailed, retry } = useProjectClientPicker();
  /**
   * Chosen target per signal, as `project:<id>` / `client:<id>` / "" for none.
   * Prefilled from the backend's project suggestion. A customer is a target in
   * its own right — a client with no projects still has a portal and an inbox.
   */
  const [choices, setChoices] = useState<Record<string, string>>({});
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [totalMinutes, setTotalMinutes] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const found = await tauriInvoke<UnmappedSignal[]>(
        "discover_unmapped_signals",
        { days: DISCOVERY_DAYS },
      );
      setSignals(found);
      setSignalsLoadFailed(false);
      setChoices(
        Object.fromEntries(
          found
            .filter((s) => s.suggestedProjectId)
            .map((s) => [signalKey(s), `project:${s.suggestedProjectId}`]),
        ),
      );
    } catch (err) {
      // Før slog dette en toast og efterlod listen tom, og så kom
      // «identity.empty» — altså at der ikke er noget at binde. Det er den
      // modsatte påstand af den sande: der er signaler, de kunne bare ikke
      // hentes, og brugeren så en tom side og gik.
      console.error("Failed to load unmapped signals:", err);
      setSignals([]);
      setSignalsLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  /** Splits a `project:`/`client:` choice into the two fields the command takes. */
  function parseChoice(choice: string): {
    projectId: string | null;
    clientId: string | null;
  } {
    if (choice.startsWith("project:")) {
      return { projectId: choice.slice("project:".length), clientId: null };
    }
    if (choice.startsWith("client:")) {
      return { projectId: null, clientId: choice.slice("client:".length) };
    }
    return { projectId: null, clientId: null };
  }

  async function bind(signal: UnmappedSignal, choice: string) {
    const key = signalKey(signal);
    setBusyKey(key);
    try {
      const { projectId, clientId } = parseChoice(choice);
      const result = await tauriInvoke<ApplyResult>("add_project_matcher", {
        matcher: {
          projectId,
          clientId,
          kind: signal.kind,
          value: signal.value,
        },
      });
      setSignals((prev) => prev.filter((s) => signalKey(s) !== key));
      setTotalMinutes(result.classifiedMinutes);
      if (projectId) {
        const name =
          projects.find((p) => p.id === projectId)?.name ??
          t("identity.unknownProject");
        toast.success(
          t("identity.bound", { minutes: signal.minutes, project: name }),
        );
      } else if (clientId) {
        const name =
          clients.find((c) => c.id === clientId)?.name ??
          t("identity.unknownClient");
        toast.success(
          t("identity.boundToClient", {
            minutes: signal.minutes,
            client: name,
          }),
        );
      } else {
        toast.success(
          t("identity.markedPrivate", { signal: truncateMiddle(signal.value) }),
        );
      }
      onChanged?.();
    } catch {
      toast.error(t("identity.bindFailed"));
    } finally {
      setBusyKey(null);
    }
  }

  /** Hides a row for this session only — nothing is stored, so it comes back. */
  function skip(signal: UnmappedSignal) {
    const key = signalKey(signal);
    setSignals((prev) => prev.filter((s) => signalKey(s) !== key));
  }

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-(--color-text)">
            {t("identity.discoverTitle")}
          </h3>
          <p className="mt-0.5 text-xs text-(--color-text-muted)">
            {t("identity.discoverDescription", { days: DISCOVERY_DAYS })}
          </p>
        </div>
        <Button
          variant="secondary"
          size="sm"
          onClick={load}
          disabled={loading}
          className="shrink-0"
        >
          {loading ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <RefreshCw size={14} />
          )}
          {t("identity.refresh")}
        </Button>
      </div>

      {totalMinutes > 0 && (
        <p className="flex items-center gap-1.5 text-xs font-medium text-emerald-400">
          <CheckCircle2 size={14} className="shrink-0" />
          {t("identity.totalClassified", { minutes: totalMinutes })}
        </p>
      )}

      {loading && (
        <p className="flex items-center gap-2 py-6 text-xs text-(--color-text-muted)">
          <Loader2 size={14} className="animate-spin shrink-0" />
          {t("identity.loading")}
        </p>
      )}

      {/* De to lister hører sammen med signalerne — uden dem kan ingen af rækkerne
          bindes — så deres fejl står over listen, ikke nede under den. */}
      {!loading && loadFailed && (
        <PickerLoadError kind={loadFailed} onRetry={retry} />
      )}

      {!loading && signalsLoadFailed && (
        <LoadError message={t("identity.loadFailed")} onRetry={load} />
      )}

      {!loading && !signalsLoadFailed && signals.length === 0 && (
        <div className="rounded-lg border border-(--color-border) bg-(--color-bg) px-4 py-8 text-center">
          <p className="text-sm font-medium text-(--color-text)">
            {t("identity.empty")}
          </p>
          <p className="mt-1 text-xs text-(--color-text-muted)">
            {t("identity.emptyHint")}
          </p>
        </div>
      )}

      {!loading && !signalsLoadFailed && signals.length > 0 && (
        <ul className="space-y-2">
          {signals.map((signal) => {
            const key = signalKey(signal);
            const Icon = KIND_ICON[signal.kind];
            const chosen = choices[key] ?? "";
            const busy = busyKey === key;
            return (
              <li
                key={key}
                className="rounded-lg border border-(--color-border) bg-(--color-bg) p-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="inline-flex shrink-0 items-center gap-1 rounded bg-(--color-border)/50 px-1.5 py-0.5 text-[11px] font-medium text-(--color-text-muted)">
                        <Icon size={11} className="shrink-0" />
                        {t(KIND_LABEL_KEY[signal.kind])}
                      </span>
                      <span
                        title={signal.value}
                        className="min-w-0 truncate text-sm font-medium text-(--color-text)"
                      >
                        {truncateMiddle(signal.value)}
                      </span>
                    </div>
                    <p className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-(--color-text-muted)">
                      <span className="font-medium text-(--color-text)">
                        {formatDuration(signal.minutes * 60)}
                      </span>
                      <span>
                        {t("identity.activities", { n: signal.activityCount })}
                      </span>
                      {signal.sampleApps.length > 0 && (
                        <span>
                          {t("identity.apps", {
                            apps: signal.sampleApps.join(", "),
                          })}
                        </span>
                      )}
                      {signal.suggestedPrivate && (
                        <span className="text-amber-400">
                          {t("identity.privateHint")}
                        </span>
                      )}
                    </p>
                    {signal.sampleTitles.length > 0 && (
                      // Without this an app signal is unreadable: the process is
                      // called "javaw" — only the title reveals it was Minecraft.
                      <p
                        title={signal.sampleTitles.join("\n")}
                        className="mt-1 truncate text-xs text-(--color-text-muted)/80 italic"
                      >
                        {signal.sampleTitles.join(" · ")}
                      </p>
                    )}
                  </div>

                  <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                    <select
                      aria-label={t("identity.selectTarget")}
                      value={chosen}
                      disabled={busy}
                      onChange={(e) =>
                        setChoices((prev) => ({
                          ...prev,
                          [key]: e.target.value,
                        }))
                      }
                      className="h-8 max-w-44 rounded-md border border-(--color-border) bg-(--color-bg) px-2 text-xs text-(--color-text) focus:border-(--color-accent) focus:outline-none focus:ring-2 focus:ring-(--color-accent)/20"
                    >
                      <option value="">{t("identity.selectTarget")}</option>
                      {projects.length > 0 && (
                        <optgroup label={t("identity.targetProject")}>
                          {projects.map((p) => (
                            <option key={p.id} value={`project:${p.id}`}>
                              {p.name}
                            </option>
                          ))}
                        </optgroup>
                      )}
                      {clients.length > 0 && (
                        <optgroup label={t("identity.targetClient")}>
                          {clients.map((c) => (
                            <option key={c.id} value={`client:${c.id}`}>
                              {c.name}
                            </option>
                          ))}
                        </optgroup>
                      )}
                    </select>
                    <Button
                      size="sm"
                      onClick={() => bind(signal, chosen)}
                      disabled={!chosen || busy}
                    >
                      {busy ? (
                        <Loader2 size={13} className="animate-spin" />
                      ) : (
                        chosen === `project:${signal.suggestedProjectId}` &&
                        chosen !== "" && <Sparkles size={13} />
                      )}
                      {t("identity.link")}
                    </Button>
                    <Button
                      variant={
                        signal.suggestedPrivate ? "primary" : "secondary"
                      }
                      size="sm"
                      onClick={() => bind(signal, "")}
                      disabled={busy}
                    >
                      {t("identity.private")}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => skip(signal)}
                      disabled={busy}
                    >
                      {t("identity.skip")}
                    </Button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
