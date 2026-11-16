"use client";

import { CornerDownLeft, Loader2, Mic, MicOff, Save, X } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import {
  FreetextFindings,
  formatFreetextHours,
} from "@/components/time/FreetextEntryBox";
import { useFreetextSuggestion } from "@/components/time/useFreetextSuggestion";
import { useLocalDictation } from "@/hooks/useLocalDictation";
import { isNetworkError } from "@/lib/offline/queue";
import { pickAutoDeductPackage } from "@/lib/prepaid/auto-select";
import { appendDictation } from "@/lib/speech/local-speech";
import { rangeToISO } from "@/lib/time/entry-range";
import { trpc } from "@/providers/trpc-provider";
import { createOrQueue } from "@/stores/offlineQueueStore";
import { canSaveHomeDraft, isTypingTarget } from "./home-logic";

interface Props {
  showClients: boolean;
  showProjects: boolean;
  /** Klippekort-modul slået til OG planen har klippekort */
  showKlippekort: boolean;
}

/**
 * Hjem: "Skriv hvad du lavede" → forslag inline → bekræft → gemt.
 * Samme parser (og AI-fallback med egen nøgle) som formularen på
 * /dashboard/time/new — intet gemmes uden at brugeren bekræfter.
 */
export function HomePrompt({
  showClients,
  showProjects,
  showKlippekort,
}: Props) {
  const t = useTranslations("home.prompt");
  const inputId = useId();
  const hintId = useId();
  const descId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const utils = trpc.useUtils();

  const { data: clients, isLoading: clientsLoading } =
    trpc.clients.list.useQuery(undefined, { enabled: showClients });
  const { data: projects, isLoading: projectsLoading } =
    trpc.projects.list.useQuery(undefined, { enabled: showProjects });
  // Tolk ikke mod tomme lister — så ligner et hurtigt Enter en fejl
  const listsLoading =
    (showClients && clientsLoading) || (showProjects && projectsLoading);

  const state = useFreetextSuggestion({
    clients: showClients ? clients : [],
    projects: showProjects ? projects : [],
  });
  const { text, setText, outcome, result, runParser, reset, nameOf } = state;

  const [description, setDescription] = useState("");
  const [usePrepaid, setUsePrepaid] = useState(false);

  // Fokus i feltet ved åbning — kun med mus/trackpad, så telefonens
  // tastatur ikke springer op og dækker siden.
  useEffect(() => {
    if (window.matchMedia?.("(pointer: fine)").matches) {
      inputRef.current?.focus();
    }
  }, []);

  // "/" fokuserer feltet fra hvor som helst på Hjem (Ctrl+K er kommando-
  // paletten og røres ikke).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.defaultPrevented || isTypingTarget(e.target)) return;
      // Et åbent dialogvindue beholder fokus
      if (document.querySelector('[role="dialog"], [aria-modal="true"]')) {
        return;
      }
      e.preventDefault();
      inputRef.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const dictation = useLocalDictation({
    onFinal: (spoken) => setText((cur) => appendDictation(cur, spoken)),
  });

  // Ny tolkning → beskrivelsen følger forslaget (kan rettes inden gem)
  const parsedText = outcome?.text;
  const parsedDescription = result?.description ?? "";
  // biome-ignore lint/correctness/useExhaustiveDependencies: nulstil kun ved ny tolkning
  useEffect(() => {
    setDescription(parsedDescription);
  }, [parsedText, parsedDescription]);

  // Klippekort: samme auto-træk-regel som formularen og extensionen (#422)
  const clientId = result?.clientId ?? null;
  const { data: prepaidPackages } = trpc.prepaid.listForTime.useQuery(
    { clientId: clientId ?? "" },
    { enabled: showKlippekort && !!clientId },
  );
  const prepaidCandidate = useMemo(() => {
    if (!showKlippekort || !clientId || !prepaidPackages) return null;
    const open = prepaidPackages.filter(
      (p) => Number.parseFloat(p.remainingHours || "0") > 0,
    );
    const auto = pickAutoDeductPackage(open);
    if (auto) return { pkg: auto, auto: true };
    return open.length === 1 ? { pkg: open[0], auto: false } : null;
  }, [showKlippekort, clientId, prepaidPackages]);
  const prepaidKey = prepaidCandidate
    ? `${parsedText}|${prepaidCandidate.pkg.id}`
    : null;
  // biome-ignore lint/correctness/useExhaustiveDependencies: forvælg én gang pr. tolkning/kort
  useEffect(() => {
    setUsePrepaid(prepaidCandidate?.auto ?? false);
  }, [prepaidKey]);

  const createMutation = trpc.time.create.useMutation();
  const [saving, setSaving] = useState(false);
  // Synkron vagt: state når ikke at opdatere mellem to hurtige Enter
  const savingRef = useRef(false);

  const needsClient = showClients || showProjects;
  const canSave =
    !!result &&
    canSaveHomeDraft({
      hours: result.hours,
      description,
      clientId: result.clientId,
      projectId: result.projectId,
      requireClientOrProject: needsClient,
    });

  const finish = useCallback(() => {
    reset();
    setDescription("");
    setUsePrepaid(false);
    inputRef.current?.focus();
  }, [reset]);

  const save = async () => {
    if (!result || !canSave || savingRef.current || result.hours === null) {
      return;
    }
    savingRef.current = true;
    setSaving(true);
    const range = rangeToISO(result.date, result.startTime, result.endTime);
    try {
      const outcomeOfSave = await createOrQueue(
        {
          projectId: result.projectId || undefined,
          clientId: result.clientId || undefined,
          description: description.trim(),
          hours: result.hours,
          date: result.date,
          startTime: range?.startTime,
          endTime: range?.endTime,
          isBillable: result.isBillable ?? undefined,
          prepaidPackageId:
            usePrepaid && prepaidCandidate
              ? prepaidCandidate.pkg.id
              : undefined,
        },
        (entry) => createMutation.mutateAsync(entry),
      );
      if (outcomeOfSave.kind === "queued") {
        toast.success(t("savedOffline"));
      } else {
        toast.success(
          t("registered", { hours: formatFreetextHours(result.hours) }),
        );
        for (const w of outcomeOfSave.result.complianceWarnings ?? []) {
          toast.warning(w);
        }
      }
      // Tidsposter vises mange steder (staleTime 5 min) — invalidér bredt
      utils.time.invalidate();
      utils.dashboard.homeToday.invalidate();
      utils.dashboard.homeQuickStart.invalidate();
      utils.coverage.invalidate();
      if (usePrepaid) utils.prepaid.invalidate();
      finish();
    } catch (error) {
      if (!isNetworkError(error)) {
        toast.error(error instanceof Error ? error.message : t("saveFailed"));
      }
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const onEnter = () => {
    // Uændret tekst og et gyldigt forslag: Enter igen = gem
    if (outcome && outcome.text === text.trim() && canSave) {
      void save();
      return;
    }
    if (listsLoading) return;
    runParser();
  };

  const formHref = useMemo(() => {
    const params = new URLSearchParams();
    if (result?.clientId) params.set("clientId", result.clientId);
    if (result?.projectId) params.set("projectId", result.projectId);
    if (description.trim()) params.set("description", description.trim());
    const qs = params.toString();
    return `/dashboard/time/new${qs ? `?${qs}` : ""}`;
  }, [result?.clientId, result?.projectId, description]);

  const micButton =
    dictation.status === "available" ? (
      <button
        type="button"
        onClick={dictation.listening ? dictation.stop : dictation.start}
        aria-pressed={dictation.listening}
        aria-label={dictation.listening ? t("stopDictation") : t("dictate")}
        title={dictation.listening ? t("stopDictation") : t("dictateTitle")}
        className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${
          dictation.listening
            ? "border-red-300 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-900/30 dark:text-red-300"
            : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800"
        }`}
      >
        {dictation.listening ? (
          <MicOff className="h-5 w-5" aria-hidden="true" />
        ) : (
          <Mic className="h-5 w-5" aria-hidden="true" />
        )}
      </button>
    ) : null;

  return (
    <section
      aria-labelledby={`${inputId}-label`}
      className="rounded-xl border border-gray-200/80 bg-white p-4 sm:p-5 dark:border-gray-800 dark:bg-gray-900"
      data-tour="hjem-prompt"
    >
      <label
        id={`${inputId}-label`}
        htmlFor={inputId}
        className="mb-2 block text-base font-semibold text-gray-900 dark:text-white"
      >
        {t("label")}
      </label>
      <div className="flex items-center gap-2">
        <input
          ref={inputRef}
          id={inputId}
          type="text"
          name="freetext"
          autoComplete="off"
          enterKeyHint="go"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              onEnter();
            } else if (e.key === "Escape" && outcome) {
              e.preventDefault();
              finish();
            }
          }}
          maxLength={500}
          aria-describedby={hintId}
          placeholder={t("placeholder")}
          className="min-h-[44px] w-full flex-1 rounded-lg border border-gray-300 bg-white px-3 py-2 text-base text-gray-900 placeholder:text-gray-500 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30 dark:border-gray-700 dark:bg-gray-950 dark:text-white dark:placeholder:text-gray-400"
        />
        {micButton}
        <button
          type="button"
          onClick={onEnter}
          disabled={!text.trim() || saving || listsLoading}
          className="inline-flex min-h-[44px] shrink-0 items-center justify-center gap-2 rounded-lg bg-tt-gran px-4 text-sm font-medium text-tt-paa-gran transition-colors hover:bg-tt-gran-moerk focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:focus-visible:ring-offset-gray-900"
        >
          <CornerDownLeft className="h-4 w-4" aria-hidden="true" />
          <span className="hidden sm:inline">{t("interpret")}</span>
        </button>
      </div>

      <p id={hintId} className="mt-2 text-xs text-gray-600 dark:text-gray-400">
        {dictation.listening ? (
          <span className="text-red-700 dark:text-red-300">
            {t("listening")}{" "}
            {dictation.interim && <em>“{dictation.interim}”</em>}
          </span>
        ) : dictation.status === "available" ? (
          t("hintAvailable")
        ) : dictation.status === "downloadable" ||
          dictation.status === "downloading" ? (
          <>
            {t("hintDownloadable")}{" "}
            <button
              type="button"
              onClick={dictation.install}
              disabled={dictation.status === "downloading"}
              className="font-medium text-brand-700 underline-offset-2 hover:underline disabled:opacity-60 dark:text-brand-400"
            >
              {dictation.status === "downloading"
                ? t("downloading")
                : t("install")}
            </button>
          </>
        ) : (
          t.rich("hintDefault", {
            kbd: (chunks) => (
              <kbd className="rounded border border-gray-300 px-1 font-mono text-[11px] dark:border-gray-600">
                {chunks}
              </kbd>
            ),
          })
        )}
      </p>

      {/* Kun start/stop annonceres — ikke hver foreløbig tale-stump */}
      <span className="sr-only" aria-live="polite">
        {dictation.listening ? t("listeningSr") : ""}
      </span>

      {result && (
        <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-3 sm:p-4 dark:border-gray-700 dark:bg-gray-800/50">
          <FreetextFindings
            state={state}
            missingHint={() => t("missingHint")}
          />
          <div className="mt-3">
            <label
              htmlFor={descId}
              className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300"
            >
              {t("descriptionLabel")}
            </label>
            <input
              id={descId}
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void save();
                }
              }}
              maxLength={500}
              placeholder={t("descriptionPlaceholder")}
              className="min-h-[40px] w-full rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-base text-gray-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30 sm:text-sm dark:border-gray-700 dark:bg-gray-950 dark:text-white"
            />
          </div>

          {prepaidCandidate && (
            <label className="mt-3 flex min-h-[32px] items-center gap-2 text-sm text-gray-800 dark:text-gray-200">
              <input
                type="checkbox"
                checked={usePrepaid}
                onChange={(e) => setUsePrepaid(e.target.checked)}
                className="h-4 w-4 rounded border-gray-300 text-brand-600 dark:text-brand-400 focus:ring-brand-500"
              />
              {t("usePrepaid", {
                name: prepaidCandidate.pkg.name,
                time: formatFreetextHours(
                  Number.parseFloat(prepaidCandidate.pkg.remainingHours || "0"),
                ),
              })}
            </label>
          )}

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void save()}
              disabled={!canSave || saving}
              className="inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-tt-gran px-4 text-sm font-medium text-tt-paa-gran transition-colors hover:bg-tt-gran-moerk focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:focus-visible:ring-offset-gray-900"
            >
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <Save className="h-4 w-4" aria-hidden="true" />
              )}
              {result.hours !== null
                ? t("saveWithHours", {
                    hours: formatFreetextHours(result.hours),
                  })
                : t("save")}
            </button>
            <Link
              href={formHref}
              className="inline-flex min-h-[44px] items-center rounded-lg px-3 text-sm font-medium text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
            >
              {t("editInForm")}
            </Link>
            <button
              type="button"
              onClick={finish}
              className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg px-3 text-sm font-medium text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
            >
              <X className="h-4 w-4" aria-hidden="true" />
              {t("cancel")}
            </button>
            {canSave && (
              <span className="hidden text-xs text-gray-500 sm:inline dark:text-gray-400">
                {t("keysHint")}
              </span>
            )}
          </div>
          {!canSave && result.hours !== null && !description.trim() && (
            <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">
              {t("needDescription")}
            </p>
          )}
          {nameOf("client", result.clientId) === null &&
            nameOf("project", result.projectId) === null &&
            !needsClient && (
              <p className="mt-2 text-xs text-gray-600 dark:text-gray-400">
                {t("internal")}
              </p>
            )}
        </div>
      )}
    </section>
  );
}
