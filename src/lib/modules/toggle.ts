/**
 * Ingen funktioner er låst bag billing, plan eller "kontakt salg": en admin
 * kan altid tænde et modul. Er rækken seedet som utilgængelig (fx enterprise
 * i Cloud-orgs oprettet før #1035), skal den gøres tilgængelig i samme
 * handling, fordi alle modul-tjek kræver både isAvailable og isEnabled.
 */
export function shouldMakeModuleAvailable(input: {
  enabled: boolean;
  isAvailable: boolean;
}): boolean {
  return input.enabled && !input.isAvailable;
}
