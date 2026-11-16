import type { LoadReporter, LoadSource } from './notify';
import * as React from 'react';
import { LoadContext, screenLoad, useLoadAnnounce } from './notify';

/**
 * Ét stop pr. skærm for de *komponenter*, der selv henter.
 *
 * 6.12 satte `useAnnounceLoaded` på hver skærm, men otte komponenter under
 * skærmene hentede selv og viste en skeleton: `week-card`, `prepaid-card`,
 * `enterprise-card`, `absence-form`, `absence-overview`, `from-time-sheet`,
 * `project-rates` og `project-picker-modal`. For en skærmlæser var de otte
 * stille — brugeren hørte skærmens titel og så to, tre kort materialisere sig
 * uden et ord. Kunne man bare have lagt kaldene op på skærmen, var hvert kort
 * blevet sit eget "Indhold indlæst", fire gange på hemskærmen.
 *
 * Løsningen er at lade komponenterne *melde* deres kald til skærmen i stedet
 * for at løfte dem op: `ScreenLoad` samler meldingerne til det ene stop
 * `screenLoad` allerede beskriver, og `useReportLoad` er det komponenten
 * kalder. Uden en `ScreenLoad` ovenover taler komponenten selv, så den er
 * sikker at genbruge hvor som helst.
 *
 * `project-picker-modal` bruger IKKE længere `ScreenLoad` (6.24): den bytter
 * indhold under brugeren, så hvert trin er sin egen overflade med sin egen
 * besked — ét stop ville give samme ord to gange. Den bruger
 * `useAnnounceVisible` i `notify`.
 */
export function ScreenLoad({ message, children }: { message: string; children: React.ReactNode }) {
  const [sources, setSources] = React.useState<LoadSource[]>([]);
  const regionsRef = React.useRef(new Map<number, LoadSource>());

  const reporter = React.useMemo<LoadReporter>(() => ({
    report(id, load) {
      const previous = regionsRef.current.get(id);
      if (previous && previous.isLoading === load.isLoading && previous.isError === load.isError)
        return;
      regionsRef.current.set(id, load);
      setSources([...regionsRef.current.values()]);
    },
    release(id) {
      if (!regionsRef.current.delete(id))
        return;
      setSources([...regionsRef.current.values()]);
    },
  }), []);

  // Før det første kald har meldt sig er skærmen ikke færdig, men den har
  // heller ikke ventet — `useLoadAnnounce` taler kun om en overgang, så en tom
  // liste siger intet. Det betyder også at en skærm uden lastede kort tier.
  const load = sources.length > 0 ? screenLoad(...sources) : { isLoading: false, isError: false };
  useLoadAnnounce(load, message);

  return <LoadContext value={reporter}>{children}</LoadContext>;
}
