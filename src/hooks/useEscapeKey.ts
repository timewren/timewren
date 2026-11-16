"use client";

import { useEffect, useRef } from "react";

/** Kalder `onEscape`, når der trykkes Escape, mens `active` er sand. */
export function useEscapeKey(onEscape: () => void, active = true) {
  // Ref, så en inline-funktion fra kalderen ikke gentilmelder lytteren hvert render.
  const onEscapeRef = useRef(onEscape);
  useEffect(() => {
    onEscapeRef.current = onEscape;
  });

  useEffect(() => {
    if (!active) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onEscapeRef.current();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [active]);
}
