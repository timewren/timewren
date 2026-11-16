import { isMailTransportConfigured } from "@/lib/email/transport";

let warned = false;

/**
 * Skal brugere bekræfte deres mailadresse før login? Ja som standard og altid
 * når en mail-transport er sat (produktion). Kun med
 * `REQUIRE_EMAIL_VERIFICATION=false` OG ingen transport (hverken Resend eller
 * SMTP) springes verifikationen over, så en selvhoster kan komme i gang med
 * Postgres alene. Flaget ignoreres med en advarsel, hvis en transport er sat.
 */
export function isEmailVerificationRequired(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const raw = env.REQUIRE_EMAIL_VERIFICATION?.trim().toLowerCase();
  if (raw !== "false" && raw !== "0") return true;

  if (isMailTransportConfigured(env)) {
    warnOnce(
      "[Auth] REQUIRE_EMAIL_VERIFICATION=false ignoreres, fordi en mail-transport er sat. Fjern flaget, eller fjern RESEND_API_KEY/SMTP_HOST.",
    );
    return true;
  }

  warnOnce(
    "[Auth] ADVARSEL: E-mailverifikation er slået fra (REQUIRE_EMAIL_VERIFICATION=false, ingen mail-transport). Alle kan oprette en konto med en vilkårlig mailadresse, også ADMIN_EMAIL før operatøren (admin-overtagelse). Sæt RESEND_API_KEY eller SMTP_HOST, og fjern flaget, før instansen bliver tilgængelig udefra.",
  );
  return false;
}

function warnOnce(message: string): void {
  if (warned) return;
  warned = true;
  console.warn(message);
}

/** Til tests. */
export function resetEmailVerificationWarningForTests(): void {
  warned = false;
}
