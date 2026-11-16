"use client";

import { Loader2, Mic, Sparkles, Wand2 } from "lucide-react";
import Link from "next/link";
import { createTranslator, useLocale, useTranslations } from "next-intl";
import { useId } from "react";
import { useBrand } from "@/components/BrandContext";
import { toIntlLocale } from "@/i18n/format-locale";
import daTime from "@/i18n/messages/da/time.json";
import type {
  FreetextCandidate,
  FreetextSuggestion,
} from "@/lib/time/freetext-parser";
import {
  type FreetextApply,
  type FreetextClientOption,
  type FreetextProjectOption,
  type FreetextSuggestionState,
  useFreetextSuggestion,
} from "./useFreetextSuggestion";

export type { FreetextApply } from "./useFreetextSuggestion";

interface Props {
  clients: FreetextClientOption[] | undefined;
  projects: FreetextProjectOption[] | undefined;
  onApply: (apply: FreetextApply) => void;
}

type Translate = (
  key: string,
  values?: Record<string, string | number>,
) => string;

/** Dansk standard til kaldere udenfor React (eller uden valgt sprog). */
const daTranslate = createTranslator({
  locale: "da",
  messages: { time: daTime },
  namespace: "time",
}) as unknown as Translate;

export function formatFreetextHours(
  h: number,
  t: Translate = daTranslate,
): string {
  const totalMin = Math.round(h * 60);
  const hh = Math.floor(totalMin / 60);
  const mm = totalMin % 60;
  if (hh === 0) return t("freetext.min", { m: mm });
  if (mm === 0) return t("freetext.hours", { h: hh });
  return t("freetext.hoursMin", { h: hh, m: mm });
}

function formatDate(iso: string, locale: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString(toIntlLocale(locale), {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

/** Det parseren fandt, som korte tekststykker ("2 t · tor. 2. okt. · Acme"). */
export function recognizedParts(
  result: FreetextSuggestion,
  nameOf: FreetextSuggestionState["nameOf"],
  i18n: { t: Translate; locale: string } = { t: daTranslate, locale: "da" },
): string[] {
  const { t, locale } = i18n;
  const parts: string[] = [];
  if (result.hours !== null) {
    parts.push(
      result.startTime && result.endTime
        ? `${result.startTime}–${result.endTime} (${formatFreetextHours(result.hours, t)})`
        : formatFreetextHours(result.hours, t),
    );
  }
  parts.push(formatDate(result.date, locale));
  const clientName = nameOf("client", result.clientId);
  const projectName = nameOf("project", result.projectId);
  if (clientName) parts.push(clientName);
  if (projectName) parts.push(projectName);
  if (result.isBillable === false) parts.push(t("freetext.nonBillable"));
  if (result.isBillable === true) parts.push(t("freetext.billable"));
  return parts;
}

export function FreetextEntryBox({ clients, projects, onApply }: Props) {
  const t = useTranslations("time");
  const inputId = useId();
  const hintId = useId();
  const state = useFreetextSuggestion({ clients, projects, onApply });
  const { text, setText, runParser, result } = state;

  return (
    <div
      id="fritekst"
      className="rounded-lg border border-gray-200 bg-gray-50/60 p-4 dark:border-gray-700 dark:bg-gray-800/40"
    >
      <label
        htmlFor={inputId}
        className="mb-1.5 block text-xs font-medium text-gray-700 dark:text-gray-300"
      >
        {t("freetext.label")}{" "}
        <span className="font-normal text-gray-400">
          {t("freetext.optional")}
        </span>
      </label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          id={inputId}
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              runParser();
            }
          }}
          maxLength={500}
          aria-describedby={hintId}
          placeholder={t("freetext.placeholder")}
          className="min-h-[44px] w-full flex-1 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
        />
        <button
          type="button"
          onClick={() => runParser()}
          disabled={!text.trim()}
          className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800"
        >
          <Wand2 className="h-4 w-4" aria-hidden="true" />
          {t("freetext.fill")}
        </button>
      </div>
      <p
        id={hintId}
        className="mt-1.5 flex items-start gap-1.5 text-xs text-gray-500 dark:text-gray-400"
      >
        <Mic className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        {t("freetext.hint")}
      </p>

      {result && (
        <FreetextFindings
          state={state}
          missingHint={(n) =>
            n > 1 ? t("freetext.fillBelowMany") : t("freetext.fillBelowOne")
          }
        />
      )}
    </div>
  );
}

/**
 * Resultatet af en tolkning: hvad der blev fundet, hvad der mangler,
 * flertydige kandidater og AI-fallback (kun med brugerens egen nøgle).
 */
export function FreetextFindings({
  state,
  missingHint,
}: {
  state: FreetextSuggestionState;
  /** Afslutning på "Kunne ikke finde X — …" (n = antal manglende felter) */
  missingHint: (n: number) => string;
}) {
  // Hostens brand (TimeWren på timewren.com), ikke build-brandet.
  const brand = useBrand();
  const {
    outcome,
    result,
    nameOf,
    ambiguousClients,
    ambiguousProjects,
    pickCandidate,
    canAskAI,
    runAI,
    aiPending,
    aiDisabled,
  } = state;
  const t = useTranslations("time");
  const locale = useLocale();
  if (!result) return null;
  return (
    <div className="mt-3 space-y-2 text-xs" aria-live="polite">
      {outcome?.source === "ai" && (
        <p className="flex items-start gap-1.5 rounded-md border border-brand-200 bg-brand-50 px-2.5 py-1.5 text-brand-800 dark:border-brand-600 dark:bg-tt-gran-lys dark:text-brand-200">
          <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{t("freetext.aiSuggestion", { model: outcome.model })}</span>
        </p>
      )}
      <p className="text-gray-700 dark:text-gray-300">
        <span className="font-medium">{t("freetext.found")}</span>{" "}
        {recognizedParts(result, nameOf, {
          t: t as unknown as Translate,
          locale,
        }).join(" · ")}
      </p>
      {result.missing.length > 0 && (
        <p className="text-amber-700 dark:text-amber-400">
          {t("freetext.missing", {
            items: new Intl.ListFormat(toIntlLocale(locale), {
              style: "long",
              type: "conjunction",
            }).format(
              result.missing.map((m) =>
                m === "hours"
                  ? t("freetext.missingHours")
                  : t("freetext.missingClient"),
              ),
            ),
          })}{" "}
          {missingHint(result.missing.length)}
        </p>
      )}
      {ambiguousClients.length > 0 && (
        <CandidateRow
          label={t("freetext.didYouMeanClient")}
          candidates={ambiguousClients}
          onPick={(c) => pickCandidate("client", c)}
        />
      )}
      {ambiguousProjects.length > 0 && (
        <CandidateRow
          label={t("freetext.didYouMeanProject")}
          candidates={ambiguousProjects}
          onPick={(c) => pickCandidate("project", c)}
        />
      )}
      {canAskAI && (
        <button
          type="button"
          onClick={runAI}
          disabled={aiPending}
          className="inline-flex min-h-[36px] items-center gap-1.5 rounded-md border border-brand-200 bg-white px-3 py-1.5 font-medium text-brand-700 transition-colors hover:bg-brand-50 disabled:opacity-60 dark:border-brand-600 dark:bg-gray-900 dark:text-brand-300 dark:hover:bg-tt-gran-lys"
        >
          {aiPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Sparkles className="h-3.5 w-3.5" />
          )}
          {t("freetext.askAi")}
        </button>
      )}
      {outcome?.source === "parser" &&
        result.missing.length > 0 &&
        aiDisabled && (
          <p className="text-gray-500 dark:text-gray-400">
            {t.rich("freetext.aiKeyHint", {
              brand: brand.name,
              link: (chunks) => (
                <Link
                  href="/dashboard/settings/ai"
                  className="underline hover:text-gray-700 dark:hover:text-gray-200"
                >
                  {chunks}
                </Link>
              ),
            })}
          </p>
        )}
    </div>
  );
}

function CandidateRow({
  label,
  candidates,
  onPick,
}: {
  label: string;
  candidates: FreetextCandidate[];
  onPick: (c: FreetextCandidate) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-gray-600 dark:text-gray-400">{label}:</span>
      {candidates.map((c) => (
        <button
          key={c.id}
          type="button"
          onClick={() => onPick(c)}
          className="min-h-[32px] rounded-md border border-gray-200 bg-white px-2.5 py-1 text-gray-800 transition-colors hover:border-brand-300 hover:bg-brand-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-tt-gran-lys"
        >
          {c.name}
        </button>
      ))}
    </div>
  );
}
