"use client";

import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { toLocalDateStr } from "@/lib/format";
import {
  type FreetextCandidate,
  type FreetextSuggestion,
  parseFreetextEntry,
} from "@/lib/time/freetext-parser";
import { trpc } from "@/providers/trpc-provider";

/**
 * Felter der skal udfyldes i formularen. null/undefined = rør ikke feltet.
 * isBillable: null = nulstil til standard, undefined = rør ikke.
 */
export interface FreetextApply {
  description: string | null;
  hours: number | null;
  date: string | null;
  startTime: string | null;
  endTime: string | null;
  clientId: string | null;
  projectId: string | null;
  isBillable: boolean | null | undefined;
}

export interface FreetextClientOption {
  id: string;
  name: string;
  company?: string | null;
}

export interface FreetextProjectOption {
  id: string;
  name: string;
  clientId: string | null;
  status?: string | null;
}

export type FreetextOutcome =
  | { source: "parser"; result: FreetextSuggestion; text: string }
  | { source: "ai"; result: FreetextSuggestion; model: string; text: string };

interface Options {
  clients: FreetextClientOption[] | undefined;
  projects: FreetextProjectOption[] | undefined;
  /** Kaldes med de felter et forslag ændrer (formular-varianten). */
  onApply?: (apply: FreetextApply) => void;
}

/**
 * "Skriv hvad du lavede" (#681/#707): deterministisk parser først, AI med
 * brugerens egen nøgle kun til det parseren ikke fandt. Delt mellem
 * formularen på /dashboard/time/new og prompt-feltet på Hjem, så de to
 * aldrig tolker den samme tekst forskelligt.
 */
export function useFreetextSuggestion({ clients, projects, onApply }: Options) {
  const t = useTranslations("time");
  const [text, setText] = useState("");
  const [outcome, setOutcome] = useState<FreetextOutcome | null>(null);

  const { data: aiStatus } = trpc.ai.timeEntryFallbackStatus.useQuery();
  const aiMutation = trpc.ai.parseTimeEntry.useMutation();

  // Arkiverede/afsluttede projekter skal ikke foreslås
  const activeProjects = useMemo(
    () =>
      (projects ?? []).filter(
        (p) => p.status !== "archived" && p.status !== "completed",
      ),
    [projects],
  );

  const nameOf = (kind: "client" | "project", id: string | null) => {
    if (!id) return null;
    const list = kind === "client" ? clients : projects;
    return list?.find((x) => x.id === id)?.name ?? null;
  };

  const runParser = (input: string = text): FreetextSuggestion | null => {
    const trimmed = input.trim();
    if (!trimmed) return null;
    const result = parseFreetextEntry(trimmed, {
      today: toLocalDateStr(new Date()),
      clients: clients ?? [],
      projects: activeProjects,
    });
    setOutcome({ source: "parser", result, text: trimmed });
    onApply?.({
      description: result.description || null,
      hours: result.hours,
      date: result.date,
      startTime: result.startTime,
      endTime: result.endTime,
      clientId: result.clientId,
      projectId: result.projectId,
      isBillable: result.isBillable,
    });
    return result;
  };

  const runAI = async () => {
    if (outcome?.source !== "parser") return;
    const parser = outcome.result;
    // Send præcis den tekst, parseren så — ikke en evt. redigeret inputværdi
    const parsedText = outcome.text;
    try {
      const { suggestion, model } = await aiMutation.mutateAsync({
        text: parsedText,
        today: toLocalDateStr(new Date()),
      });
      // AI'en udfylder kun det, parseren ikke fandt
      const needHours = parser.hours === null;
      const needClient = parser.missing.includes("client");
      const merged: FreetextSuggestion = {
        ...parser,
        hours: needHours ? suggestion.hours : parser.hours,
        startTime: needHours ? suggestion.startTime : parser.startTime,
        endTime: needHours ? suggestion.endTime : parser.endTime,
        clientId: needClient ? suggestion.clientId : parser.clientId,
        projectId: needClient ? suggestion.projectId : parser.projectId,
        date:
          !parser.dateFromText && suggestion.date
            ? suggestion.date
            : parser.date,
        isBillable: parser.isBillable ?? suggestion.isBillable,
        description: parser.description || suggestion.description,
        clientCandidates: [],
        projectCandidates: [],
        missing: [],
      };
      if (merged.hours === null) merged.missing.push("hours");
      if (!merged.clientId && !merged.projectId) merged.missing.push("client");
      setOutcome({ source: "ai", result: merged, model, text: parsedText });
      onApply?.({
        description: parser.description ? null : suggestion.description || null,
        hours: needHours ? suggestion.hours : null,
        date: !parser.dateFromText ? suggestion.date : null,
        startTime: needHours ? suggestion.startTime : null,
        endTime: needHours ? suggestion.endTime : null,
        clientId: needClient ? suggestion.clientId : null,
        projectId: needClient ? suggestion.projectId : null,
        isBillable:
          parser.isBillable === null && suggestion.isBillable !== null
            ? suggestion.isBillable
            : undefined,
      });
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t("freetext.aiFailed"),
      );
    }
  };

  const pickCandidate = (kind: "client" | "project", c: FreetextCandidate) => {
    if (!outcome) return;
    const result = { ...outcome.result };
    if (kind === "client") {
      result.clientId = c.id;
      result.clientCandidates = [];
    } else {
      result.projectId = c.id;
      result.projectCandidates = [];
      const proj = projects?.find((p) => p.id === c.id);
      if (proj?.clientId) result.clientId = proj.clientId;
    }
    result.missing = result.missing.filter((m) => m !== "client");
    setOutcome({ ...outcome, result });
    onApply?.({
      description: null,
      hours: null,
      date: null,
      startTime: null,
      endTime: null,
      clientId: result.clientId,
      projectId: kind === "project" ? c.id : null,
      isBillable: undefined,
    });
  };

  const reset = () => {
    setText("");
    setOutcome(null);
  };

  const result = outcome?.result;
  const ambiguousClients =
    result && !result.clientId && result.clientCandidates.length > 1
      ? result.clientCandidates
      : [];
  const ambiguousProjects =
    result && !result.projectId && result.projectCandidates.length > 1
      ? result.projectCandidates
      : [];
  const canAskAI =
    outcome?.source === "parser" &&
    outcome.result.missing.length > 0 &&
    aiStatus?.enabled === true;
  const aiDisabled = aiStatus?.enabled === false;

  return {
    text,
    setText,
    outcome,
    setOutcome,
    result,
    runParser,
    runAI,
    aiPending: aiMutation.isPending,
    canAskAI,
    aiDisabled,
    pickCandidate,
    ambiguousClients,
    ambiguousProjects,
    nameOf,
    reset,
  };
}

export type FreetextSuggestionState = ReturnType<typeof useFreetextSuggestion>;
