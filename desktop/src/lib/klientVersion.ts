/**
 * Serveren (web #781) kan afvise skrivninger fra en for gammel desktop-version
 * med HTTP 426 `CLIENT_TOO_OLD`. Rust-siden sætter markøren `CLIENT_TOO_OLD:`
 * foran fejlteksten (se `sync::api::klient_for_gammel_fejl`), så frontenden kan
 * vise opdateringsprompten uden at matche på en oversat sætning.
 */
export const KLIENT_FOR_GAMMEL = "CLIENT_TOO_OLD";

/** Sand når en fejl fra Rust stammer fra et 426 `CLIENT_TOO_OLD`-svar. */
export function erKlientForGammel(err: unknown): boolean {
  return typeof err === "string" && err.startsWith(KLIENT_FOR_GAMMEL);
}

/** Fejlteksten uden markøren — klar til at vise. */
export function udenKlientMarkoer(tekst: string): string {
  return tekst.startsWith(KLIENT_FOR_GAMMEL)
    ? tekst.slice(KLIENT_FOR_GAMMEL.length).replace(/^:\s*/, "")
    : tekst;
}
