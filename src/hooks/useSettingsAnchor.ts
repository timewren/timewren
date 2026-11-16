"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { resolveSettingsAnchor } from "@/components/dashboard-nav/settings-search";

/** Sendes, når man hopper til et anker på den side, man allerede står på. */
export const SETTINGS_ANCHOR_EVENT = "settings-anchor";

// Indstillingssiderne henter data først, så elementet findes ofte ikke, når
// URL'en skifter. Vi venter op til WAIT_MS på det.
const WAIT_MS = 8000;
const QUIET_MS = 300;
const MAX_SETTLE_MS = 2000;
const HIGHLIGHT_MS = 2500;
const HIGHLIGHT_CLASSES = [
  "ring-2",
  "ring-brand-500",
  "ring-offset-2",
  "ring-offset-white",
  "dark:ring-offset-gray-950",
  "rounded-lg",
];

function isFormControl(el: Element): el is HTMLElement {
  return (
    el instanceof HTMLInputElement ||
    el instanceof HTMLSelectElement ||
    el instanceof HTMLTextAreaElement
  );
}

/**
 * Rul til og fremhæv elementet med `id`. Et formularfelt får fokus, og
 * fremhævningen lægges på feltets wrapper (label + felt).
 */
function revealAnchor(el: Element) {
  const target = isFormControl(el) && el.parentElement ? el.parentElement : el;
  const reduceMotion = window.matchMedia?.(
    "(prefers-reduced-motion: reduce)",
  ).matches;
  if (target instanceof HTMLElement && !target.style.scrollMarginTop) {
    // Plads til den faste topbjælke
    target.style.scrollMarginTop = "5rem";
  }
  const tall = target.getBoundingClientRect().height > window.innerHeight * 0.6;
  target.scrollIntoView({
    behavior: reduceMotion ? "auto" : "smooth",
    block: tall ? "start" : "center",
  });
  if (isFormControl(el)) el.focus({ preventScroll: true });

  const added = HIGHLIGHT_CLASSES.filter((c) => !target.classList.contains(c));
  target.classList.add(...added);
  window.setTimeout(() => target.classList.remove(...added), HIGHLIGHT_MS);
}

/**
 * Dybe links i indstillingerne: `/dashboard/settings#afrunding` ruller til
 * indstillingen og fremhæver den, også når siden først skal hente data.
 * Virker ved første indlæsning, ved navigation mellem sider og ved hop på
 * samme side (SETTINGS_ANCHOR_EVENT).
 */
export function useSettingsAnchor() {
  const pathname = usePathname();

  // biome-ignore lint/correctness/useExhaustiveDependencies: pathname er bevidst med som re-run-trigger ved client-side navigation — effekten læser window.location direkte.
  useEffect(() => {
    let cancelled = false;
    let deadline: number | undefined;
    let quiet: number | undefined;
    let cap: number | undefined;
    let observer: MutationObserver | undefined;

    const stop = () => {
      observer?.disconnect();
      observer = undefined;
      window.clearTimeout(deadline);
      window.clearTimeout(quiet);
      window.clearTimeout(cap);
      deadline = undefined;
      quiet = undefined;
      cap = undefined;
    };

    // Sektionerne over ankeret henter ofte data og vokser, efter ankeret
    // er dukket op. Vi venter derfor, til siden har været rolig i QUIET_MS,
    // før vi ruller, så hoppet lander rigtigt.
    const seek = (hash: string) => {
      stop();
      const id = resolveSettingsAnchor(hash);
      if (!id || cancelled) return;
      const reveal = () => {
        stop();
        const el = document.getElementById(id);
        if (el) revealAnchor(el);
      };
      const settle = () => {
        if (!document.getElementById(id)) return;
        // Bliver siden ved med at ændre sig (fx et tikkende ur), ruller vi
        // senest MAX_SETTLE_MS efter, at ankeret dukkede op.
        cap ??= window.setTimeout(reveal, MAX_SETTLE_MS);
        window.clearTimeout(quiet);
        quiet = window.setTimeout(reveal, QUIET_MS);
      };
      observer = new MutationObserver(settle);
      observer.observe(document.body, { childList: true, subtree: true });
      deadline = window.setTimeout(reveal, WAIT_MS);
      settle();
    };

    const onHashChange = () => seek(window.location.hash);
    const onAnchorEvent = (e: Event) => {
      const detail = (e as CustomEvent<string>).detail;
      seek(typeof detail === "string" ? detail : window.location.hash);
    };

    seek(window.location.hash);
    window.addEventListener("hashchange", onHashChange);
    window.addEventListener(SETTINGS_ANCHOR_EVENT, onAnchorEvent);
    return () => {
      cancelled = true;
      stop();
      window.removeEventListener("hashchange", onHashChange);
      window.removeEventListener(SETTINGS_ANCHOR_EVENT, onAnchorEvent);
    };
  }, [pathname]);
}

/**
 * Naviger til en indstilling. Next.js' router.push udløser ikke
 * `hashchange`, så vi sender selv ankeret med, når man allerede står på
 * siden (eller den er på vej).
 */
export function openSettingsHref(push: (href: string) => void, href: string) {
  push(href);
  const hashIndex = href.indexOf("#");
  if (hashIndex >= 0) {
    window.dispatchEvent(
      new CustomEvent(SETTINGS_ANCHOR_EVENT, {
        detail: href.slice(hashIndex),
      }),
    );
  }
}
