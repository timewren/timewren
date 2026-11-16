/**
 * Spørgsmålet efter inaktivitet, gemt så popup'en kan stille det. Firefox
 * kan ikke vise knapper på notifikationer, så dér åbner et klik på
 * notifikationen popup'en, der viser spørgsmålet med knapperne. Chrome viser
 * knapperne på notifikationen og samme spørgsmål i popup'en.
 */
export const IDLE_PROMPT_KEY = "idlePrompt";
export const IDLE_PROMPT_ANSWER = "IDLE_PROMPT_ANSWER";

/** Spørgsmål ældre end dette vises ikke længere. */
const MAX_AGE_MS = 12 * 60 * 60 * 1000;

export interface IdlePrompt {
  /** "away": timeren kører, skal fraværet tælle med? "paused": auto-pause */
  kind: "away" | "paused";
  /** Fraværet formateret, fx "45 min" */
  away: string;
  /** Hvornår inaktiviteten begyndte, fx "14:05" */
  clock: string;
  at: number;
  /** Timerens session, da spørgsmålet blev stillet (2.6.0+) */
  sessionId?: string | null;
}

export type IdlePromptAnswer = "keep" | "discard" | "resume" | "dismiss";

export function readIdlePrompt(
  value: unknown,
  now = Date.now(),
): IdlePrompt | null {
  const prompt = value as IdlePrompt | null | undefined;
  if (
    !prompt ||
    (prompt.kind !== "away" && prompt.kind !== "paused") ||
    typeof prompt.at !== "number" ||
    now - prompt.at > MAX_AGE_MS
  ) {
    return null;
  }
  return prompt;
}

/** Notifikationens knap → svar (samme betydning som i popup'en). */
export function answerForButton(
  kind: IdlePrompt["kind"] | null,
  buttonIndex: number,
): IdlePromptAnswer {
  if (kind === "paused") return buttonIndex === 0 ? "resume" : "dismiss";
  if (buttonIndex === 1) return "discard";
  // Ukendt spørgsmål (fx en gammel notifikation): som før, hvor knap 0
  // genoptog en pauset timer og ellers intet gjorde
  return kind === "away" ? "keep" : "resume";
}

/**
 * Hører svaret stadig til samme timer? Kendes begge sessioner og er de
 * forskellige, er timeren stoppet og en ny startet siden, og svaret må ikke
 * røre den nye.
 */
export function sameIdleSession(
  expected: string | null | undefined,
  actual: string | null | undefined,
): boolean {
  return !expected || !actual || expected === actual;
}
