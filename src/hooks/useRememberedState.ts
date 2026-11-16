"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Gemt værdi fra localStorage, hvis den stadig er en af de tilladte. En
 * omdøbt fane eller sortering fra en ældre version falder tilbage til
 * standarden i stedet for at give en tom liste.
 */
export function readRememberedValue<T extends string>(
  raw: string | null,
  allowed: readonly T[],
  fallback: T,
): T {
  return raw !== null && (allowed as readonly string[]).includes(raw)
    ? (raw as T)
    : fallback;
}

/**
 * useState, der husker valget (filter, sortering, periode) i localStorage
 * mellem besøg. Værdien læses først efter mount, så server- og klient-
 * render er ens (ingen hydration-fejl).
 */
export function useRememberedState<T extends string>(
  key: string,
  allowed: readonly T[],
  fallback: T,
): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(fallback);

  // biome-ignore lint/correctness/useExhaustiveDependencies: læses kun ved mount; allowed er typisk et nyt array-literal pr. render
  useEffect(() => {
    try {
      setValue(
        readRememberedValue(localStorage.getItem(key), allowed, fallback),
      );
    } catch {
      // localStorage kan være spærret (privat tilstand); brug standarden
    }
  }, [key]);

  const setRemembered = useCallback(
    (next: T) => {
      setValue(next);
      try {
        localStorage.setItem(key, next);
      } catch {
        // ignorér: valget gælder stadig i denne visning
      }
    },
    [key],
  );

  return [value, setRemembered];
}
