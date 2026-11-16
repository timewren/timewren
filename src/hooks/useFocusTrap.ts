"use client";

import { type RefObject, useEffect } from "react";

const FOCUSABLE_SELECTOR =
  'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

/**
 * Fanger Tab-fokus inde i en modal/dialog-container.
 *
 * - Fokuserer det første fokuserbare element ved åbning (medmindre noget i
 *   containeren allerede har fokus, fx et autoFocus-søgefelt)
 * - Tab/Shift+Tab cykler inden for containeren
 * - Giver fokus tilbage til det tidligere aktive element ved lukning
 *
 * @param ref - ref til modal-indholdet (den synlige boks, ikke overlayet)
 * @param active - om fælden er aktiv (typisk `isOpen`; `true` for modaler
 *   der kun er mounted mens de er åbne)
 * @param refreshKey - valgfri værdi der gen-aktiverer fælden når modalens
 *   indhold udskiftes (fx et trin-/visningsskifte med nyt DOM-træ)
 */
export function useFocusTrap(
  ref: RefObject<HTMLElement | null>,
  active: boolean,
  refreshKey?: unknown,
) {
  // Gem og gendan fokus — kun bundet til åben/lukket, ikke refreshKey
  useEffect(() => {
    if (!active) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    return () => {
      previouslyFocused?.focus();
    };
  }, [active]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: refreshKey er en udløser: fælden gen-aktiveres, når modalens indhold udskiftes
  useEffect(() => {
    if (!active) return;
    const el = ref.current;
    if (!el) return;

    if (!el.contains(document.activeElement)) {
      el.querySelector<HTMLElement>(FOCUSABLE_SELECTOR)?.focus();
    }

    const handleTab = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const focusable = el.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    el.addEventListener("keydown", handleTab);
    return () => {
      el.removeEventListener("keydown", handleTab);
    };
  }, [ref, active, refreshKey]);
}
