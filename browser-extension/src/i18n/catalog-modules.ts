/**
 * Alle kataloger: messages/<sprog>/<navneområde>.json. Gmail-scriptet bygges
 * for sig og får catalog-modules.gmail.ts i stedet (vite.config.ts).
 */
export const modules = import.meta.glob<Record<string, unknown>>(
  "./messages/*/*.json",
  { eager: true, import: "default" },
);
