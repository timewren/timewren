import type { MessageOptions } from 'react-native-flash-message';
import * as React from 'react';
import { AccessibilityInfo } from 'react-native';
import { showMessage as showToast } from 'react-native-flash-message';

/**
 * Skærmlæseren skal høre det, der sker uden for synsfeltet.
 *
 * Der er bevidst kun ÉN mekanisme: `AccessibilityInfo.announceForAccessibility`.
 * React Native har også `accessibilityLiveRegion`, men den virker kun på
 * Android, og bruger man den sammen med en annonce, læser TalkBack beskeden to
 * gange. En live region er desuden bundet til én bestemt `Text`, så hver toast,
 * hvert skilt og hver tæller skulle have sin egen usynlige container — og ingen
 * af dem kan få `announceForAccessibility` til at sige noget, fordi den skal
 * kaldes fra kode. `notify.test.ts` holder invarianten: ingen live region i `src/`.
 */

/** Sigter af: mellemrum er ikke en besked, og en tom toast skal ikke læses. */
function spokenText(message: string): string {
  return message.trim();
}

/**
 * Læs en besked højt. Gør ingenting uden en skærmlæser — på en iPhone uden
 * VoiceOver eller en Android uden TalkBack er det bare en død kald.
 *
 * Den skal kaldes NÅR hændelsen sker, ikke når en besked bliver vist: en toast
 * forsvinder igen, og en skærmlæser-bruger skal have hørt den, inden den er væk.
 */
export function announce(message: string): void {
  const text = spokenText(message);
  if (!text)
    return;
  AccessibilityInfo.announceForAccessibility(text);
}

/**
 * Samme `announce` som en stabil callback, til komponenter der skal læse noget
 * op i en effekt eller et render (`useAnnounce()('Gemt')`).
 */
export function useAnnounce(): (message: string) => void {
  return React.useCallback((message: string) => {
    announce(message);
  }, []);
}

/** Det eneste en skærm skal have at vide om sit kald. */
export type LoadSource = {
  isLoading: boolean;
  isError: boolean;
};

/**
 * Læs højt, når en skeleton bliver til indhold.
 *
 * 18 skærme venter på et kald og viser en pulserende pladsholder. For en
 * skærmlæser er den pladsholder lydløs: brugeren hørte skærmens titel, så var
 * der stilhed indtil indholdet kom — uden at kunne skelne "indlæser" fra "hang".
 *
 * Kun overgangen *sådan → færdig* læses, og kun når der faktisk kom data:
 *  - første rendering med data i cache siger intet (der blev ikke ventet)
 *  - `isLoading` er false under pull-to-refresh, så en genindlæsning tier
 *  - en fejl læses IKKE som "indlæst" — `ErrorState` har sin egen tekst
 *  - to regioner på én skærm skal have hver sin `message`, ellers hører
 *    brugeren "Indhold indlæst" to gange og ved ikke hvad der kom
 */
export function useAnnounceLoaded(load: LoadSource, message: string): void {
  useLoadAnnounce(load, message);
}

/**
 * Selve overgangen, med en slå-fra-kontakt.
 *
 * `active` er for en komponent der står under en `ScreenLoad`: så taler
 * skærmen, og komponentens egen besked ville være det samme ord to gange.
 * Uden en skærmovenover er den tilbage slået til og komponenten taler selv.
 */
export function useLoadAnnounce(load: LoadSource, message: string, active = true): void {
  const { isError, isLoading } = load;
  const wasLoadingRef = React.useRef(false);
  React.useEffect(() => {
    const started = wasLoadingRef.current;
    wasLoadingRef.current = isLoading;
    if (active && started && !isLoading && !isError)
      announce(message);
  }, [active, isError, isLoading, message]);
}

/**
 * Læs højt, når en region bliver *synlig* — også når svaret lå i cache.
 *
 * `useAnnounceLoaded` taler kun om overgangen *sådan → færdig*, fordi en
 * skærm der åbnes med data i cache ikke skal sige "Indhold indlæst" til en
 * bruger, der ikke har ventet. Det er rigtigt for en skærm og forkert for en
 * overflade der **bytter indhold under brugeren**: `project-picker-modal` går
 * fra kunder til kundens projekter, og med `projects.list` i cache (staleTime
 * 5 min) monterede det nye trin med `isLoading: false`. Samme tryk læste så
 * "Indhold indlæst" det ene øjeblik og intet det næste, udelukkende efter
 * cache — brugeren vidste aldrig hvad der kom.
 *
 * Her tales derfor pr. *monteret region*, præcis én gang, og så snart den er
 * færdig: kaldet kom fra et kald, der ventede, eller fra cache — begge er
 * "der er indhold nu". En fejl tier stadig: "indlæst" er en påstand om data
 * der ikke kom, og fejlen har sin egen tekst.
 *
 * Den melder IKKE til et `ScreenLoad` og skal derfor kun bruges, hvor hver
 * region er sin egen overflade — ellers taler den for hele skærmen *og* for
 * regionen, altså to gange.
 */
export function useAnnounceVisible(load: LoadSource, message: string): void {
  const { isError, isLoading } = load;
  const announcedRef = React.useRef(false);
  React.useEffect(() => {
    if (announcedRef.current || isLoading || isError)
      return;
    announcedRef.current = true;
    announce(message);
  }, [isError, isLoading, message]);
}

/**
 * Saml flere regioner på ÉN skærm til én kilde, så skærmen taler én gang.
 *
 * Indstillinger, hold og kundedetaljer har tre-fire uafhængige kald, hver med
 * sin egen skeleton. Uden den her ville skærmlæseren høre "Indhold indlæst"
 * tre gange og ikke vide hvilken del der kom; hvis man i stedet bare valgte ét
 * kald, sagde skærmen "indlæst" mens en skeleton stadig summede.
 *
 * To regler, begge holdt af `notify.test.ts`:
 *  - skærmen er færdig, når den SIDSTE region er færdig
 *  - en fejl tæller kun, når INGEN af dem leverede. Et enkelt fejlet hjørne
 *    skal ikke gøre hele skærmen lydløs — den region har sin egen `ErrorState`
 *    med tekst, brugeren skal stadig høre at resten kom.
 *
 * Kald med `enabled: false` tæller ikke: React Query sætter `isLoading` til
 * `isPending && isFetching`, så en slået fra region er færdig fra starten.
 */
export function screenLoad(...sources: LoadSource[]): LoadSource {
  return {
    isLoading: sources.some(source => source.isLoading),
    isError: sources.length > 0 && sources.every(source => source.isError),
  };
}

/** `message` + `description` som én besked — beskrivelsen er en del af betydningen. */
function toastText(toast: MessageOptions): string {
  return [toast.message, toast.description].filter(Boolean).join('. ');
}

/**
 * Vores `showMessage`: toast OG stemmelæsning i én kald.
 *
 * Appen viste tidligere resultatet af en mutation, en advarsel og en fejl i en
 * toast, som en skærmlæser ikke siger noget om. En blind bruger fik derfor ingen
 * bekræftelse på at tiden var gemt og ingen hørt fejl, når et gemte mislykkedes
 * — de to ting, appen eller opgaven tager mest alvorligt.
 *
 * Navnet er bevidst uændret, så alle 49 kaldsites skifter import og ikke
 * navngivning.
 */
export function showMessage(toast: MessageOptions): void {
  showToast(toast);
  announce(toastText(toast));
}

/** Melder fra en komponent til skærmens stop. Se `ScreenLoad` i `notify-load`. */
export type LoadReporter = {
  report: (id: number, load: LoadSource) => void;
  release: (id: number) => void;
};

export const LoadContext = React.createContext<LoadReporter | null>(null);

let nextRegionId = 0;

/**
 * Meld et kald til skærmens stop — eller tal selv, når der ikke er nogen.
 *
 * `message` er påkrævet, også under en `ScreenLoad`: komponenten kan flyttes,
 * og en komponent der en dag står uden skærm skal stadig sige noget. Et meldt
 * kald skal kunne vise sin egen `isError` — ellers er skærmens "Indhold
 * indlæst" en løgn om et hjørne, der aldrig kom.
 */
export function useReportLoad(load: LoadSource, message: string): void {
  const reporter = React.use(LoadContext);
  const { isError, isLoading } = load;
  const idRef = React.useRef(nextRegionId++);

  useLoadAnnounce(load, message, reporter === null);

  React.useEffect(() => {
    if (!reporter)
      return;
    const id = idRef.current;
    reporter.report(id, { isError, isLoading });
    return () => reporter.release(id);
  }, [reporter, isError, isLoading]);
}
