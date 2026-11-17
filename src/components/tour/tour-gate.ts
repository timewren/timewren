import type { OrgRole } from "@/lib/permissions/org-role";

/**
 * Rolle-betingelse for den automatiske rundvisning.
 *
 * Turen gennemgår ejer-funktioner (modul-valg, klienter, fakturering,
 * klippekort), som inviterede org-brugere hverken kan se eller ændre. Derfor
 * auto-startes turen kun for ejere/admins — solo-brugere er ejer af deres egen
 * organisation. Manuel genstart fra brugermenuen virker stadig for alle (#426).
 */
export interface TourAutoStartInput {
  onboardingCompleted: boolean;
  hasCompletedTour: boolean;
  /** Server-side flag: brugeren har tidligere fuldført/skippet turen. */
  tourServerSeen: boolean;
  tourActive: boolean;
  showOnboardingModal: boolean;
  /**
   * Brugerens rolle i aktiv organisation. `undefined` = rollen er ikke hentet
   * endnu — turen starter aldrig på et gæt.
   */
  orgRole: OrgRole | undefined;
  /**
   * Offentlig demo (DEMO_MODE=1): turen starter aldrig af sig selv, for den
   * åbner over dashboardet og sender et dybt link tilbage til /dashboard
   * (første trin har `page: "/dashboard"`). Demobjælken tilbyder den (#1213).
   */
  demo: boolean;
}

export function shouldAutoStartTour(input: TourAutoStartInput): boolean {
  if (input.orgRole === undefined || input.demo) return false;
  if (!input.onboardingCompleted) return false;
  if (input.hasCompletedTour || input.tourServerSeen) return false;
  if (input.tourActive || input.showOnboardingModal) return false;
  return input.orgRole === "owner" || input.orgRole === "admin";
}
