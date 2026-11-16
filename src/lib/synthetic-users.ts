/**
 * Syntetiske overvågningskonti (fx den time-for-time timer-check fra GitHub
 * Actions, tests/synthetic/). De er rigtige brugere i prod, men må aldrig få
 * mails, tælle med i admin-tal eller udløse stabilitetsvagtens alarmer.
 *
 * Styres med env (kommasepareret), så kontoen kan skiftes uden kodeændring:
 *   SYNTHETIC_USER_IDS     — bruger-id'er
 *   SYNTHETIC_USER_EMAILS  — e-mailadresser (fanger mails sendt uden userId)
 *
 * Kontoen er desuden markeret isDemo og har alle mail-præferencer slået fra;
 * se docs/runbooks/timer-fejlsoegning.md, "Syntetisk timer-check".
 */

function parseList(value: string | undefined): Set<string> {
  return new Set(
    (value ?? "")
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean),
  );
}

export function syntheticUserIds(): string[] {
  return [...parseList(process.env.SYNTHETIC_USER_IDS)];
}

export function isSyntheticUserId(userId: string | null | undefined): boolean {
  if (!userId) return false;
  return parseList(process.env.SYNTHETIC_USER_IDS).has(userId);
}

export function isSyntheticEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const wanted = email.trim().toLowerCase();
  for (const e of parseList(process.env.SYNTHETIC_USER_EMAILS)) {
    if (e.toLowerCase() === wanted) return true;
  }
  return false;
}
