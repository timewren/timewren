/**
 * Gmail-scriptets udsnit af katalogerne: kun de navneområder, gmail.ts slår
 * op i (catalog-modules.test.ts holder listen ajour). Content scripts kan ikke
 * dele chunks med popup'en, så uden udsnittet fik gmail.js alle sprog af hele
 * kataloget med en gang til.
 */
export const modules = import.meta.glob<Record<string, unknown>>(
  "./messages/*/{gmail,errors}.json",
  { eager: true, import: "default" },
);
