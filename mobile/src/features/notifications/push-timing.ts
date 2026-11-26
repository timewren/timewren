export type PushPromptState = {
  signedIn: boolean;
  /** Velkomstskærmen er ikke vist endnu. */
  isFirstTime: boolean;
  /** `undefined` = profilen er ikke hentet endnu; `null` tæller som gennemført, som i layoutet. */
  onboardingCompleted: boolean | null | undefined;
  isAdmin: boolean;
};

/**
 * Må appen spørge om notifikationer nu?
 *
 * Før kom systemets dialog straks efter login, oven på velkomsten og
 * opsætningen og uden sammenhæng. På iOS får appen kun ét forsøg, og et nej
 * gemmes som afslag, så det spørgsmål skal stilles, når brugeren er inde i
 * appen. Samme betingelser som (app)-layoutets omdirigeringer.
 */
export function readyForPushPrompt(state: PushPromptState): boolean {
  if (!state.signedIn || state.isFirstTime || state.onboardingCompleted === undefined)
    return false;
  return !(state.onboardingCompleted === false && state.isAdmin);
}
