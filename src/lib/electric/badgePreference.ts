"use client";

import { useEffect, useState } from "react";

/**
 * Om ElectricSQL-debugbadgen (#260) vises for en platform-admin. Slået fra som
 * standard og gemt pr. browser, så den kun slås til, når der skal fejlsøges.
 */
const STORAGE_KEY = "electric-debug-badge";

export function readElectricBadgeEnabled(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeElectricBadgeEnabled(enabled: boolean): void {
  try {
    if (enabled) localStorage.setItem(STORAGE_KEY, "1");
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Blokeret storage: badgen forbliver slået fra.
  }
}

export function useElectricBadgeEnabled(): boolean {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    setEnabled(readElectricBadgeEnabled());
    const onStorage = (event: StorageEvent) => {
      if (event.key === STORAGE_KEY) setEnabled(readElectricBadgeEnabled());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  return enabled;
}
