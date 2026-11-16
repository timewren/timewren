import { Info } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import {
  FREE_MAX_ACTIVE_CLIENTS,
  PRIVAT_MAX_ACTIVE_CLIENTS,
} from "@/lib/billing/plan-gate";

/**
 * Standardtekster til plan-noten (kapacitet, ikke funktioner). Konstanterne er
 * nøgler, som PlanNote oversætter; andre børn vises uændret.
 */
export const PLAN_NOTE_CLIENT_LIMIT = "plan-note:clientLimit";
/** Samme for Privat: Selvstændig har ubegrænset antal aktive kunder. */
export const PLAN_NOTE_CLIENT_LIMIT_PRIVAT = "plan-note:clientLimitPrivat";
const PLAN_NOTE_KEYS: Record<string, "clientLimit" | "clientLimitPrivat"> = {
  [PLAN_NOTE_CLIENT_LIMIT]: "clientLimit",
  [PLAN_NOTE_CLIENT_LIMIT_PRIVAT]: "clientLimitPrivat",
};

/** Plan-note til kundeloftet for den aktuelle tier. */
export function planNoteClientLimit(tier: string | null): string {
  return tier === "privat"
    ? PLAN_NOTE_CLIENT_LIMIT_PRIVAT
    : PLAN_NOTE_CLIENT_LIMIT;
}

/**
 * Rolig inline-note om hvad der er med i en anden plan. Ingen modal, ingen
 * nedtælling, ingen blokering — bare én linje og ét link til planerne.
 */
export function PlanNote({ children }: { children: React.ReactNode }) {
  const t = useTranslations("billing.planNote");
  const noteKey =
    typeof children === "string" ? PLAN_NOTE_KEYS[children] : null;
  const content = noteKey
    ? t(noteKey, {
        free: FREE_MAX_ACTIVE_CLIENTS,
        privat: PRIVAT_MAX_ACTIVE_CLIENTS,
      })
    : children;
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-gray-200/80 bg-white px-4 py-3 text-sm dark:border-gray-800 dark:bg-gray-900 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-2 text-gray-600 dark:text-gray-400">
        <Info
          className="mt-0.5 h-4 w-4 shrink-0 text-gray-400 dark:text-gray-500"
          aria-hidden="true"
        />
        <span>{content}</span>
      </div>
      <Link
        href="/dashboard/settings/subscription"
        className="shrink-0 text-sm font-medium text-brand-600 hover:text-brand-700 dark:text-brand-400 dark:hover:text-brand-300"
      >
        {t("seePlans")}
      </Link>
    </div>
  );
}
