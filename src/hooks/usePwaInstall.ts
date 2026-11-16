"use client";

import { useCallback, useEffect, useState } from "react";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

/**
 * Delt tilstand for browserens PWA-install-prompt.
 *
 * `beforeinstallprompt` fyrer ÉN gang, og det medfølgende events `prompt()`
 * må kun kaldes én gang — et andet kald giver InvalidStateError. Lytter to
 * komponenter hver for sig (app-draweren og install-banneret), vinder den
 * ene og den anden kaster en unhandled rejection. Derfor ligger eventet i
 * modul-state med et `consumed`-flag, og begge komponenter deler den.
 */
type PwaState = {
  prompt: BeforeInstallPromptEvent | null;
  /** prompt() er kaldt på dette event — det kan ikke bruges igen. */
  consumed: boolean;
  installed: boolean;
};

let state: PwaState = { prompt: null, consumed: false, installed: false };
const subscribers = new Set<() => void>();
let listening = false;

function emit() {
  for (const notify of subscribers) notify();
}

function setState(patch: Partial<PwaState>) {
  state = { ...state, ...patch };
  emit();
}

function startListening() {
  if (listening || typeof window === "undefined") return;
  listening = true;

  if (window.matchMedia("(display-mode: standalone)").matches) {
    state = { ...state, installed: true };
  }

  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    // Et nyt event er et nyt, ubrugt tilbud.
    setState({ prompt: e as BeforeInstallPromptEvent, consumed: false });
  });
  window.addEventListener("appinstalled", () => {
    setState({ prompt: null, consumed: true, installed: true });
  });
}

export interface PwaInstall {
  /** Der findes et ubrugt prompt-event vi kan vise. */
  canInstall: boolean;
  isInstalled: boolean;
  /** Viser prompten. Returnerer "unavailable" hvis der ikke er nogen. */
  install: () => Promise<"accepted" | "dismissed" | "unavailable">;
}

export function usePwaInstall(): PwaInstall {
  const [snapshot, setSnapshot] = useState<PwaState>(state);

  useEffect(() => {
    startListening();
    const notify = () => setSnapshot(state);
    subscribers.add(notify);
    // Eventet kan være fanget før denne komponent blev monteret.
    notify();
    return () => {
      subscribers.delete(notify);
    };
  }, []);

  const install = useCallback(async () => {
    const current = state.prompt;
    if (!current || state.consumed) return "unavailable" as const;

    // Markér FØR kaldet: to hurtige klik må ikke ramme prompt() to gange.
    setState({ consumed: true });
    try {
      await current.prompt();
      // Vent på brugerens valg før tilstanden ryddes — en afvisning må ikke
      // se ud som en installation.
      const { outcome } = await current.userChoice;
      if (outcome === "accepted") setState({ prompt: null, installed: true });
      return outcome;
    } catch {
      // Prompten kunne ikke vises (fx allerede brugt af browseren selv).
      setState({ prompt: null });
      return "unavailable" as const;
    }
  }, []);

  return {
    canInstall: Boolean(snapshot.prompt) && !snapshot.consumed,
    isInstalled: snapshot.installed,
    install,
  };
}
