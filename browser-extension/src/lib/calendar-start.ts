import { useEffect, useRef } from "react";
import { useSettingsStore } from "../stores/settingsStore";

/**
 * Indstillingen "Åbn kalender på": I dag (standard) eller sidst viste dag.
 * Den sidst viste dag deles af popup'ens og ny fanes kalender.
 */
const LAST_VIEWED_KEY = "calendarLastViewedDate";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** YYYY-MM-DD → lokal dato, eller null hvis værdien ikke er en dato. */
export function parseStoredCalendarDate(value: unknown): Date | null {
  if (typeof value !== "string" || !DATE_RE.test(value)) return null;
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Gendanner den sidst viste dag én gang, når indstillingerne er indlæst og
 * står på "last-viewed", og husker derefter hver ny dag, kalenderen viser.
 */
export function useCalendarStartDate(
  viewedDateStr: string,
  restore: (date: Date) => void,
): void {
  const mode = useSettingsStore((s) => s.settings.calendarDefaultDay);
  const settingsLoading = useSettingsStore((s) => s.isLoading);
  const restored = useRef(false);
  const restoreRef = useRef(restore);
  restoreRef.current = restore;

  useEffect(() => {
    if (settingsLoading || restored.current) return;
    restored.current = true;
    if (mode !== "last-viewed") return;
    chrome.storage.local
      .get([LAST_VIEWED_KEY])
      .then((result) => {
        const date = parseStoredCalendarDate(result[LAST_VIEWED_KEY]);
        if (date) restoreRef.current(date);
      })
      .catch(() => {});
  }, [mode, settingsLoading]);

  useEffect(() => {
    // Gem først efter gendannelsen, så "i dag" ikke overskriver den gemte dag
    if (!restored.current) return;
    void chrome.storage.local
      .set({ [LAST_VIEWED_KEY]: viewedDateStr })
      .catch(() => {});
  }, [viewedDateStr]);
}
