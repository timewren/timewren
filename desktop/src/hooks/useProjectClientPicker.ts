import { useCallback, useEffect, useRef, useState } from "react";
import { tauriInvoke } from "@/lib/tauri";
import type { Client, Project } from "@/lib/types";

/**
 * Hvilken liste en fejlet indlæsning ramte — så beskeden kan være konkret.
 *
 * `null` betyder «intet gik galt». De tre former er ikke tilfældige: de er de
 * kombinationer de komponenter, der bruger hooken, faktisk beder om.
 */
export type PickerLoadKind = "projekter" | "kunder" | "begge" | null;

export interface PickerOptions {
  /** Hentes kun når sand — dialoger henter ved åbning, ikke ved mount. */
  active?: boolean;
  projects?: boolean;
  clients?: boolean;
}

export interface ProjectClientPicker {
  projects: Project[];
  clients: Client[];
  /**
   * En fejl, brugeren skal se — aldrig «der er ingen projekter».
   *
   * Før denne hook var hver komponent sin egen: `GhostBlock` lod løftet stå
   * ubeskyttet, fire andre skrev `.catch(() => setProjects([]))`, og to slog
   * det hele i `console.error`. Alle viste det samme billede — en rulleliste
   * uden valg — altså at brugeren *ikke har* projekter, når det var databasen
   * der ikke svarede. Det er en løgn om brugerens eget arbejde, og den lå i
   * koden flere gange fordi ingen havde en fælles del at låne fra.
   */
  loadFailed: PickerLoadKind;
  /** Genindlæser de lister der fejlede. Én knap, ét kald, for alle. */
  retry: () => void;
}

/** De to lister hver sin fejl — `loadFailed` udledes herfra, så den kan ikke blive modsigende. */
interface Fejl {
  projekter: boolean;
  kunder: boolean;
}

/**
 * Projekter og kunder til en vælger — med én fejltilstand for dem begge.
 *
 * De to lister hænger sammen i alle de komponenter der bruger dem: en kunde
 * uden projekt er et gyldigt valg (D1), så en vælger der kan vise den ene, men
 * ikke den anden, skjuler halvdelen af den tilstand brugeren står overfor.
 * Derfor er fejlen én tilstand og ikke to, og derfor henter den begge i samme
 * kørsel — en knap der prøver igen, prøver igen for det hele.
 *
 * `active` gør hentningen doven, fordi de dialoger der bruger denne hook kun
 * skal have listerne mens de står åbne; de hentede ellers ved mount, altså en
 * fælles forespørgsel for hver tidslinje-blok der blev monteret.
 *
 * `nr`-tælleren er ikke pynt: en bruger kan lukke en dialog mens et kald er i
 * luften, og uden tælleren kunne det ældre svar fylde en komponent der ikke
 * længere viser lister — eller hænge en fejltekst op den nye dialog (samme
 * fund som i kalendervisningerne, se K48b-1).
 */
export function useProjectClientPicker({
  active = true,
  projects: vilProjekter = true,
  clients: vilKunder = true,
}: PickerOptions = {}): ProjectClientPicker {
  const [projects, setProjects] = useState<Project[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [fejl, setFejl] = useState<Fejl>({ projekter: false, kunder: false });
  const nr = useRef(0);

  const hent = useCallback(async () => {
    const minNr = ++nr.current;
    const kald: Promise<void>[] = [];

    /** Marker én liste, men kun hvis kaldet stadig er det seneste. */
    function markér(liste: keyof Fejl, fejlede: boolean) {
      if (minNr !== nr.current) return;
      setFejl((f) => (f[liste] === fejlede ? f : { ...f, [liste]: fejlede }));
    }

    if (vilProjekter) {
      kald.push(
        tauriInvoke<Project[]>("list_projects", {
          includeArchived: false,
        }).then(
          (række) => {
            if (minNr !== nr.current) return;
            // **Et svar der ikke er en liste er en fejl, ikke en tom liste.**
            // `setProjects(null)` efterlod hooken med `projects === null`, og
            // alle otte vælgere læser `length` og `.map` på den — så en
            // mærkelig-et-kommando-svar fik dem til at kaste ved rendering.
            // Tomt svaret er også *forkert* at vise som succes: brugeren har
            // måske 40 projekter, og «Ingen projekter fundet» er en løgn om
            // deres eget arbejde. Derfor fejltilstanden, ikke en tom rulle.
            if (!Array.isArray(række)) {
              setProjects([]);
              markér("projekter", true);
              return;
            }
            setProjects(række);
            markér("projekter", false);
          },
          (err) => {
            console.error("Failed to load projects:", err);
            if (minNr !== nr.current) return;
            setProjects([]);
            markér("projekter", true);
          },
        ),
      );
    }

    if (vilKunder) {
      kald.push(
        tauriInvoke<Client[]>("list_clients", {
          includeArchived: false,
        }).then(
          (række) => {
            if (minNr !== nr.current) return;
            if (!Array.isArray(række)) {
              setClients([]);
              markér("kunder", true);
              return;
            }
            setClients(række);
            markér("kunder", false);
          },
          (err) => {
            console.error("Failed to load clients:", err);
            if (minNr !== nr.current) return;
            setClients([]);
            markér("kunder", true);
          },
        ),
      );
    }

    await Promise.all(kald);
  }, [vilKunder, vilProjekter]);

  useEffect(() => {
    if (!active) {
      // Lukker en dialog mens et kald er i luften: svaret skal ikke fylde en
      // komponent der ikke længere viser lister.
      nr.current++;
      return;
    }
    hent();
  }, [active, hent]);

  // Kalder `hent` direkte frem for at bumpe et tal i en tilstand: samme
  // genindlæsning, men uden et kunstigt afhængigheds-led i effekten ovenfor,
  // som så skulle være med i listen over dens afhængigheder.
  const retry = useCallback(() => {
    hent();
  }, [hent]);

  return {
    projects,
    clients,
    loadFailed: fejl.projekter
      ? fejl.kunder
        ? "begge"
        : "projekter"
      : fejl.kunder
        ? "kunder"
        : null,
    retry,
  };
}
