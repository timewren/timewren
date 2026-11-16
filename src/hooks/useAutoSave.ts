"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { sharedT } from "@/i18n/shared-text";
import {
  AutoSaveController,
  type AutoSaveMode,
  type AutoSaveOptions,
} from "@/lib/auto-save";

interface UseAutoSaveOptions<T extends Record<string, unknown>>
  extends Omit<AutoSaveOptions<T>, "initial" | "onError"> {
  /** Værdier før serverdata er hentet. */
  defaults: T;
  /** Gemte værdier fra serveren. Fylder formularen første gang de kommer. */
  server: T | undefined;
  /** Toast-titel ved fejl. */
  errorTitle?: string;
}

/**
 * Indstillinger, der gemmer sig selv. Se `AutoSaveController` for reglerne.
 * Fejl giver en toast med "Prøv igen"; mens et kald kører eller venter,
 * advarer browseren, hvis man forlader siden, og ved unmount (navigation i
 * appen) sendes ventende ændringer med det samme.
 */
export function useAutoSave<T extends Record<string, unknown>>({
  defaults,
  server,
  errorTitle = sharedT("sharedLabels", "hooks.autoSave.errorTitle"),
  ...options
}: UseAutoSaveOptions<T>) {
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const [controller] = useState(
    () =>
      new AutoSaveController<T>({
        initial: server ?? defaults,
        atomic: options.atomic,
        debounceMs: options.debounceMs,
        savedMs: options.savedMs,
        save: (patch, values) => optionsRef.current.save(patch, values),
        validate: (key, value, values) =>
          optionsRef.current.validate?.(key, value, values) ?? null,
        onError: (error, retry) => {
          toast.error(errorTitle, {
            description: error instanceof Error ? error.message : undefined,
            action: {
              label: sharedT("sharedLabels", "hooks.autoSave.retry"),
              onClick: retry,
            },
          });
        },
      }),
  );

  const loadedRef = useRef(server !== undefined);
  useEffect(() => {
    // Kommer serverdata, mens brugeren allerede er i gang, afvises de og
    // prøves igen, når `server` ændrer sig. Formularerne skal derfor låse
    // felterne, til data er hentet.
    if (server !== undefined && !loadedRef.current) {
      loadedRef.current = controller.reset(server);
    }
  }, [server, controller]);

  const snapshot = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );

  useEffect(() => {
    if (!snapshot.busy) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [snapshot.busy]);

  useEffect(() => () => controller.flush(), [controller]);

  return {
    ...snapshot,
    set: <K extends keyof T>(key: K, value: T[K], mode: AutoSaveMode) =>
      controller.set(key, value, mode),
    setMany: (patch: Partial<T>, mode: AutoSaveMode) =>
      controller.setMany(patch, mode),
    flush: () => controller.flush(),
    /** Ny gemt værdi fra serveren efter "Nulstil"; kasserer ventende ændringer. */
    reset: (values: T) => controller.reset(values, { force: true }),
    retry: () => controller.retry(),
  };
}
