import { describe, expect, it } from "vitest";
import type { ActivityBlock } from "../activityBlocks";
import {
  configChanged,
  currentRunde,
  DEFAULT_POMODORO_CONFIG,
  fasePeriode,
  fletPomodoroInd,
  formatPhaseTime,
  modeSeconds,
  nextPhase,
  normalizeConfig,
  nyFaseId,
  type PomodoroConfig,
  type PomodoroFase,
  progress,
  remainingSeconds,
  søjlePct,
  type UgeDag,
  ugeStribe,
} from "../pomodoro";

const config: PomodoroConfig = DEFAULT_POMODORO_CONFIG;

describe("modeSeconds", () => {
  it("gør hver fase til sekunder ud fra dens egne minutter", () => {
    expect(modeSeconds("work", config)).toBe(25 * 60);
    expect(modeSeconds("shortBreak", config)).toBe(5 * 60);
    expect(modeSeconds("longBreak", config)).toBe(15 * 60);
  });

  it("giver ingen fase at tælle ned, før timeren er startet", () => {
    expect(modeSeconds("idle", config)).toBe(0);
  });

  it("følger en ændret konfiguration i stedet for standarden", () => {
    expect(modeSeconds("work", { ...config, work_minutes: 50 })).toBe(50 * 60);
  });
});

describe("nextPhase", () => {
  it("går fra arbejde til en kort pause efter den første session", () => {
    expect(nextPhase("work", 0, config)).toEqual({
      mode: "shortBreak",
      sessionsCompleted: 1,
    });
  });

  it("giver den lange pause efter hver fjerde session", () => {
    expect(nextPhase("work", 2, config).mode).toBe("shortBreak");
    expect(nextPhase("work", 3, config)).toEqual({
      mode: "longBreak",
      sessionsCompleted: 4,
    });
    expect(nextPhase("work", 7, config).mode).toBe("longBreak");
    // Cyklussen fortsætter med korte pauser bagefter.
    expect(nextPhase("work", 4, config).mode).toBe("shortBreak");
  });

  it("tæller en session der springes over, så den lange pause ikke kan snydes", () => {
    // Uden optællingen ville tre spring-over kunne give den lange pause uden
    // at brugeren havde arbejdet en eneste færdig session.
    const spring = nextPhase("work", 0, config);
    const spring2 = nextPhase("work", spring.sessionsCompleted, config);
    const spring3 = nextPhase("work", spring2.sessionsCompleted, config);
    const spring4 = nextPhase("work", spring3.sessionsCompleted, config);
    expect(spring4).toEqual({ mode: "longBreak", sessionsCompleted: 4 });
  });

  it("går fra enhver pause tilbage til arbejde uden at tælle en session", () => {
    expect(nextPhase("shortBreak", 3, config)).toEqual({
      mode: "work",
      sessionsCompleted: 3,
    });
    expect(nextPhase("longBreak", 4, config)).toEqual({
      mode: "work",
      sessionsCompleted: 4,
    });
  });

  it("behandler en frisk timer som første arbejdsfase", () => {
    expect(nextPhase("idle", 0, config)).toEqual({
      mode: "shortBreak",
      sessionsCompleted: 1,
    });
  });

  it("giver aldrig en pause på nul minutter, selv ved ugyldig konfiguration", () => {
    const ugyldig = { ...config, sessions_before_long: 0 };
    expect(nextPhase("work", 0, ugyldig).mode).toBe("shortBreak");
    expect(nextPhase("work", 3, ugyldig).mode).toBe("shortBreak");
  });
});

describe("remainingSeconds", () => {
  const start = 1_700_000_000_000;

  it("tælder ned i hele sekunder", () => {
    expect(remainingSeconds(start + 25_000, start)).toBe(25);
    expect(remainingSeconds(start + 1, start)).toBe(1);
  });

  it("springer præcist det forsinkede interval frem i stedet for at tælle tik", () => {
    // setInterval tikker ikke 1×/s i en skjult fane. Den gamle logik trak én fra
    // pr. tik, så tre forsinkede tik gjorde timeren 3 sekunder for lang.
    const slut = start + 60_000;
    expect(remainingSeconds(slut, start + 5_000)).toBe(55);
    expect(remainingSeconds(slut, start + 59_400)).toBe(1);
  });

  it("stopper ved nul i stedet for at tælle negativt", () => {
    expect(remainingSeconds(start, start)).toBe(0);
    expect(remainingSeconds(start - 30_000, start)).toBe(0);
  });
});

describe("progress", () => {
  it("går fra 1 ved fuld tid til 0 ved udløbning", () => {
    expect(progress(25 * 60, "work", config)).toBe(1);
    expect(progress(0, "work", config)).toBe(0);
    expect(progress(12.5 * 60, "work", config)).toBeCloseTo(0.5);
  });

  it("deler på den fase der kører, ikke på arbejdstiden", () => {
    // En pause på 5 min må fylde hele ringen, ellers så den ud som om den
    // var startet halvt.
    expect(progress(5 * 60, "shortBreak", config)).toBe(1);
    expect(progress(2.5 * 60, "shortBreak", config)).toBeCloseTo(0.5);
  });

  it("går ikke i division ved nul, som et tomt felt i indstillingerne giver", () => {
    expect(progress(0, "work", { ...config, work_minutes: 0 })).toBe(0);
    expect(progress(60, "idle", config)).toBe(0);
  });
});

describe("currentRunde", () => {
  it("tæller den igangværende runde, så etiketten ikke hopper baglæns", () => {
    expect(currentRunde("idle", 0, config)).toBe(0);
    expect(currentRunde("work", 0, config)).toBe(1);
    expect(currentRunde("work", 1, config)).toBe(2);
    expect(currentRunde("shortBreak", 1, config)).toBe(1);
  });

  it("tæller ikke 5 af 4 efter den lange pause", () => {
    expect(currentRunde("work", 4, config)).toBe(1);
    expect(currentRunde("work", 5, config)).toBe(2);
  });
});

describe("normalizeConfig", () => {
  it("beholder gyldige tal", () => {
    const rå = {
      work_minutes: 30,
      short_break_minutes: 10,
      long_break_minutes: 20,
      sessions_before_long: 3,
    };
    expect(normalizeConfig(rå)).toEqual(rå);
  });

  it("sender et tomt felt fra indstillingsvinduet tilbage til standarden", () => {
    // Number("") er 0, og 0 minutter giver en fase på nul sekunder.
    const rå = { ...config, work_minutes: "" };
    expect(normalizeConfig(rå).work_minutes).toBe(25);
    expect(normalizeConfig(rå).short_break_minutes).toBe(5);
  });

  it("afviser NaN, negativt og null uden at sprænge resten", () => {
    const rå = {
      work_minutes: Number.NaN,
      short_break_minutes: -5,
      long_break_minutes: 0,
      sessions_before_long: "fire",
    };
    expect(normalizeConfig(rå)).toEqual(DEFAULT_POMODORO_CONFIG);
  });

  it("klemmer tal uden for vinduet ind til grænsen", () => {
    expect(normalizeConfig({ ...config, work_minutes: 999 }).work_minutes).toBe(
      120,
    );
    expect(
      normalizeConfig({ ...config, sessions_before_long: 99 })
        .sessions_before_long,
    ).toBe(10);
  });

  it("overlever en gemt konfiguration, der mangler nye felter", () => {
    // En bruger med en konfiguration fra før et nyt felt kom, må ikke miste
    // de øvrige valg.
    const rå = { work_minutes: 40 };
    expect(normalizeConfig(rå)).toEqual({
      work_minutes: 40,
      short_break_minutes: 5,
      long_break_minutes: 15,
      sessions_before_long: 4,
    });
  });

  it("giver standarden for en kasseret værdi, så en fejl ikke hænger appen", () => {
    expect(normalizeConfig(undefined)).toEqual(DEFAULT_POMODORO_CONFIG);
    expect(normalizeConfig("ikke et objekt")).toEqual(DEFAULT_POMODORO_CONFIG);
  });
});

describe("formatPhaseTime", () => {
  it("viser minutter og sekunder, ikke timeentry-formatet", () => {
    // "00:25:00" er otte tegn og fyldte ringen på 176 px; to tal er nok,
    // fordi en fase aldrig overstiger 120 minutter.
    expect(formatPhaseTime(25 * 60)).toBe("25:00");
    expect(formatPhaseTime(5 * 60 + 5)).toBe("05:05");
    expect(formatPhaseTime(0)).toBe("00:00");
  });

  it("tæller sekunder med to cifre, så tallet ikke hopper i bredde", () => {
    expect(formatPhaseTime(59)).toBe("00:59");
    expect(formatPhaseTime(61)).toBe("01:01");
  });

  it("tager den højeste tilladte fase uden at miste minutter", () => {
    expect(formatPhaseTime(120 * 60)).toBe("120:00");
  });
});

describe("configChanged", () => {
  it("ser en ændret værdi", () => {
    expect(configChanged(config, { ...config, work_minutes: 30 })).toBe(true);
  });

  it("ser ingen ændring, når tallene er ens", () => {
    expect(configChanged(config, { ...config })).toBe(false);
    expect(configChanged(config, normalizeConfig(config))).toBe(false);
  });
});

describe("nyFaseId", () => {
  it("giver hvert id sit eget, så ingen to faser kan skrive samme række", () => {
    // Ens id'er er hele idempotens-mekanismen: to pomodoros med samme id ville
    // få den anden slettet af `INSERT OR IGNORE`, og brugeren ville miste en
    // ægte session i dagens tal.
    const unikke = new Set(Array.from({ length: 500 }, () => nyFaseId()));
    expect(unikke.size).toBe(500);
  });

  it("giver et ikke-tomt id", () => {
    expect(nyFaseId().length).toBeGreaterThan(0);
  });

  it("virker også når webview'en ikke kender randomUUID", () => {
    // `crypto.randomUUID` kræver en webview fra ca. 2022. Uden fallback
    // kaster kaldet *efter* at timeren er sat i gang, så `setInterval` aldrig
    // sættes op: uret står på sit fulde tal og ingen tikker, mens brugeren
    // arbejder. Det er tab af registreret tid i en viste der ser ud til at
    // virke — den værste slags fejl appen kan lave.
    // `delete` virker ikke på `crypto` i jsdom — egenskaben er ikke
    // konfigurerbar, så sletningen er en stum no-op og testen bliver *grøn*
    // uden at have testet noget. Det viste sig ved en mutation: med
    // fallback'en fjernet var denne test stadig grøn. Derfor proxies `globalThis`
    // i stedet, og det er den `crypto`-binding koden slår op.
    const virkelig = globalThis.crypto;
    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      value: { getRandomValues: virkelig.getRandomValues.bind(virkelig) },
    });
    try {
      expect(
        typeof (globalThis.crypto as { randomUUID?: unknown }).randomUUID,
      ).toBe("undefined");

      const id = nyFaseId();
      expect(id).toEqual(expect.any(String));
      expect(id.length).toBeGreaterThan(0);
      // To kald i træk skal stadig give to forskellige id'er, så fallback'en
      // ikke selv gør to faser ens.
      expect(nyFaseId()).not.toBe(id);
    } finally {
      Object.defineProperty(globalThis, "crypto", {
        configurable: true,
        value: virkelig,
      });
    }
  });
});

describe("ugeStribe", () => {
  /** Uden denne ville `navnFor` være en tommel-finger-funktion, og porten
   *  ville dømme dagens navn uden at nogen kode havde fundet det. */
  const navn = (day: string) => `dag:${day}`;

  const iDag = { day: "2026-09-30", sessions: 2 };

  /** Dagen porten dømmer. Samme som `iDag.day` i de fleste tests — de skal
   *  følges ad, ellers ville de teste en stribe der regner fra en dag svaret
   *  ikke handler om. Den afvigende test har sin egen. */
  const IDAG = "2026-09-30";

  it("fremhæver dagen og lægger den sidst", () => {
    const stribe = ugeStribe([], iDag, 7, navn, IDAG);

    expect(stribe).toHaveLength(7);
    expect(stribe.filter((d) => d.erIDag)).toHaveLength(1);
    expect(stribe[6].erIDag).toBe(true);
    expect(stribe[6].day).toBe("2026-09-30");
  });

  it("viser alle syv kalenderdage, også dem uden data", () => {
    // `get_pomodoro_stats` grupperer på `day`, så en dag uden pomodoros har
    // ingen række og kommer ikke med i svaret. Uden nul-striben ville striben
    // springe fra tirsdag til torsdag, og brugeren kunne ikke se om han holdt
    // en pause eller ikke arbejdede den dag.
    const stribe = ugeStribe(
      [{ day: "2026-09-29", sessions: 3 }],
      iDag,
      7,
      navn,
      IDAG,
    );

    expect(stribe.map((d) => d.day)).toEqual([
      "2026-09-24",
      "2026-09-25",
      "2026-09-26",
      "2026-09-27",
      "2026-09-28",
      "2026-09-29",
      "2026-09-30",
    ]);
    expect(stribe.map((d) => d.sessions)).toEqual([0, 0, 0, 0, 0, 3, 2]);
    // En dag uden pomodoros er 0 høj, ikke en undtagelse der mangler.
    expect(stribe[0].højde).toBe(0);
  });

  it("tæller dagens sessioner én gang, selv om de også står i `dage`", () => {
    // `GROUP BY day` og `i_dag` er det samme tal to steder i svaret. Læses
    // begge, får dagen dobbelt så mange pomodoros som den har.
    const stribe = ugeStribe(
      [
        { day: "2026-09-30", sessions: 2 },
        { day: "2026-09-28", sessions: 1 },
      ],
      iDag,
      7,
      navn,
      IDAG,
    );

    // Kolonnerne er 24.–30/9, så 28/9 er den femte — ikke den tredje.
    expect(stribe[6].sessions).toBe(2);
    expect(stribe[4].sessions).toBe(1);
  });

  it("summerer to rækker på samme dato", () => {
    // En backup kan have skrevet den samme pomodoro to gange med forskelligt
    // id. Tæller striben kun den ene, afviger den fra dagens linje oven over.
    const stribe = ugeStribe(
      [
        { day: "2026-09-29", sessions: 2 },
        { day: "2026-09-29", sessions: 3 },
      ],
      iDag,
      7,
      navn,
      IDAG,
    );

    expect(stribe[5].sessions).toBe(5);
  });

  it("regner højden relativt til ugeens bedste dag", () => {
    // Ellers fylder den største søjle hele boksen, og en uge med 2 og 20
    // pomodoros er ulæselig.
    const stribe = ugeStribe(
      [
        { day: "2026-09-30", sessions: 4 },
        { day: "2026-09-29", sessions: 20 },
      ],
      iDag,
      7,
      navn,
      IDAG,
    );

    expect(stribe[5].højde).toBe(1);
    expect(stribe[6].højde).toBeCloseTo(0.2);
  });

  it("giver højde 0, ikke NaN, på en uge uden en eneste pomodoro", () => {
    // En ny bruger har nul. `Math.max(1, ...[0,0])` er 1, så 0/1 er 0 — men
    // hvis nogen senere ændrer grundlinjen til `Math.max(...højder)` bliver
    // 0/0 = NaN, og en NaN-højde i en inline-style ligner slet ikke en søjle.
    const stribe = ugeStribe(
      [],
      { day: "2026-09-30", sessions: 0 },
      7,
      navn,
      IDAG,
    );

    expect(stribe.every((d) => d.højde === 0)).toBe(true);
  });

  it("tager dage før en måneds- og årsskifte med de rigtige datoer", () => {
    // «2 minus 6» er ikke en dato, så en naiv baglæns tælling på dagen i
    // stedet for på måneden springer tilbage til sidste år.
    const stribe = ugeStribe(
      [],
      { day: "2027-01-02", sessions: 0 },
      7,
      navn,
      "2027-01-02",
    );

    expect(stribe.map((d) => d.day)).toEqual([
      "2026-12-27",
      "2026-12-28",
      "2026-12-29",
      "2026-12-30",
      "2026-12-31",
      "2027-01-01",
      "2027-01-02",
    ]);
  });

  it("læser datoen som lokal, ikke som UTC", () => {
    // `new Date("2026-09-30")` er UTC-midnat og derfor *dagen før* i Danmark.
    // Striben skal alligevel starte 6 dage før 30/9 og slutte på 30/9. Dømt
    // under både TZ=UTC og TZ=Europe/Copenhagen, fordi kun det ene af dem
    // fanger en UTC-læsning — CI kører i UTC, så en dansk udviklers maskine
    // ellers ville være den eneste der så fejlen.
    const stribe = ugeStribe(
      [],
      { day: "2026-09-30", sessions: 0 },
      7,
      navn,
      IDAG,
    );

    expect(stribe[6].erIDag).toBe(true);
    expect(stribe[0].day).toBe("2026-09-24");
  });

  it("lader dage fra en backup med gamle tidsstempler ude", () => {
    // Rækker foretruderen for i dag (et ur der står forkert, en backup fra en
    // anden tidszone) hører ikke til en uge-stribe bagud. Uden filtret får
    // de en kolonne, der forskyder alle syv dage.
    const stribe = ugeStribe(
      [
        { day: "2026-10-05", sessions: 9 },
        { day: "2026-09-28", sessions: 1 },
      ],
      iDag,
      7,
      navn,
      IDAG,
    );

    expect(stribe[6].erIDag).toBe(true);
    expect(stribe.some((d) => d.sessions === 9)).toBe(false);
    expect(stribe[4].sessions).toBe(1);
  });

  it("overlever at backend ikke har svaret endnu", () => {
    // `i_dag` er `null` under indlæsning. Striben skal så vise de syv dage fra
    // klokken her, ikke kaste, fordi den regner bagud fra ingenting — og
    // sidste kolonne ER dagen, for det er den den er regnet fra.
    const stribe = ugeStribe([], null, 7, navn, IDAG);

    expect(stribe).toHaveLength(7);
    expect(stribe.filter((d) => d.erIDag)).toHaveLength(1);
    expect(stribe[6].erIDag).toBe(true);
    expect(stribe.every((d) => d.sessions === 0)).toBe(true);
  });

  it("afviser et datoformat, der bare ligner det rigtige", () => {
    // `30-09-2026` er tre positive heltal, så et tjek på *formen* ville ladt
    // den passere — og `new Date(2026, 8, 30)` er den 30. august 2026, en
    // fuldt gyldig dato. Runde-turen tilbage til `2026-08-30` afviser den.
    // Ugyldigheden skal overleves begge steder den kan opstå: som dagens dato
    // kalleren giver, og som den dag backend svarede med. Første kald dømmer
    // ankeringen (døgnskiftet er præcis dér en læsning fra svaret ville have
    // slå fejl), andet at svaret ikke kan flytte markeringen.
    for (const ugyldig of [
      "30-09-2026",
      "2026/09/30",
      "2026-02-30",
      "2026-13-01",
    ]) {
      const stribe = ugeStribe(
        [],
        { day: ugyldig, sessions: 0 },
        7,
        navn,
        IDAG,
      );
      const forUseligIdag = ugeStribe([], iDag, 7, navn, ugyldig);

      for (const række of [stribe, forUseligIdag]) {
        expect(
          række.every((d) => /^\d{4}-\d{2}-\d{2}$/.test(d.day)),
          `${ugyldig} gav ${række[0].day}`,
        ).toBe(true);
        expect(række.filter((d) => d.erIDag)).toHaveLength(1);
      }
    }
  });

  it("lader en række med et ubrugeligt datoformat tælle som en dag uden pomodoros", () => {
    // Den defekte dag skal forsvinde fra striben, ikke flytte alle syv
    // kolonner. Dens sessioner må heller ikke havne på en tilfældig dag.
    const stribe = ugeStribe(
      [{ day: "30-09-2026", sessions: 5 }],
      null,
      7,
      navn,
      IDAG,
    );

    expect(stribe.every((d) => d.sessions === 0)).toBe(true);
  });

  it("giver mindst én kolonne, selv om tallet er nul", () => {
    expect(ugeStribe([], iDag, 0, navn, IDAG)).toHaveLength(1);
    expect(ugeStribe([], iDag, -3, navn, IDAG)).toHaveLength(1);
  });

  it("regner fra klokken, ikke fra den dag svaret handler om", () => {
    // **Nøgleporten for hele fundet.** `get_pomodoro_stats` læser
    // `day <= idag` og svarer med den dag *kommandoen* læste. Brugeren
    // gennemfører en pomodoro kl. 23.59, og genindlæsningen bagefter svarer
    // med både gårsdags række og dagens — fordi `day <= idag` nu passerer
    // begge. Låner striben dagens dato derfra, markerer den **gårsdags**
    // kolonne som i dag: to kolonner med samme dato, og et antal der ikke
    // passer med tælleren lige over striben. Det er dagens *dato* der skal
    // markeres, og den skal komme fra klokken i browseren.
    const stribe = ugeStribe(
      [
        { day: "2026-10-01", sessions: 4 },
        { day: "2026-10-02", sessions: 3 },
      ],
      { day: "2026-10-02", sessions: 3 },
      7,
      navn,
      "2026-10-03",
    );

    // Ugen er 27/9–3/10, og 3/10 er dagens kolonne.
    expect(stribe.map((d) => d.day)).toEqual([
      "2026-09-27",
      "2026-09-28",
      "2026-09-29",
      "2026-09-30",
      "2026-10-01",
      "2026-10-02",
      "2026-10-03",
    ]);
    expect(stribe.filter((d) => d.erIDag)).toHaveLength(1);
    expect(stribe[6].erIDag).toBe(true);
    // Hver dag har sit eget antal, og ingen dato står to gange.
    expect(stribe[4].sessions).toBe(4);
    expect(stribe[5].sessions).toBe(3);
    // Dagen i dag har ingen endnu — den er 3/10, ikke 2/10.
    expect(stribe[6].sessions).toBe(0);
  });

  it("tæller dagens sessioner fra svaret, selv når dagen er fra klokken", () => {
    // Modsat fald af forrige test: når svaret *er* fra i dag, skal `i_dag`
    // stadig tælle. Ellers ville en pomodoro, der netop er skrevet, forsvinde
    // fra dagens kolonne fordi `dage` ikke rummer den endnu.
    const stribe = ugeStribe([], { day: IDAG, sessions: 2 }, 7, navn, IDAG);

    expect(stribe[6].sessions).toBe(2);
  });
});

describe("søjlePct", () => {
  const dag = (sessions: number, højde: number) =>
    ({
      day: "2026-09-30",
      sessions,
      erIDag: false,
      navn: "Ons",
      højde,
    }) as UgeDag;

  it("tegner ingen søjle på en dag uden pomodoros", () => {
    // Nul skal kunne ligne nul. Med en bund fik en tom dag en lille stribe,
    // og dagen uden pomodoros var så ikke til at skelne fra dagen med én.
    expect(søjlePct(dag(0, 0))).toBe(0);
  });

  it("lader en lille dag stadig være synlig", () => {
    // 1 af 20 er 5 %. Uden en bund forsvinder den i en brøkdel af en pixel,
    // og striben viser seks tomme dage og ét glimt — modsat af meningen.
    expect(søjlePct(dag(1, 1 / 20))).toBe(8);
  });

  it("skalerer den bedste dag til hele boksen", () => {
    expect(søjlePct(dag(20, 1))).toBe(100);
    expect(søjlePct(dag(3, 0.5))).toBe(50);
  });

  it("kan aldrig komme uden for boksen", () => {
    // En NaN-højde kommer ud som NaN, som i en inline-style ligner slet ikke
    // en søjle — og en værdi over 100 ville tegne ud over kanten.
    expect(søjlePct(dag(2, Number.NaN))).toBe(8);
    expect(søjlePct(dag(2, 4))).toBe(100);
  });
});

describe("fasePeriode", () => {
  const slut = new Date(2026, 9, 1, 9, 25, 0);

  it("lægger en pomodoro som de 25 minutter den varede", () => {
    // Bygget baglæns fra sluttidspunktet: 09:00 → 09:25.
    expect(fasePeriode(slut, 25)).toEqual({
      start: "2026-10-01T09:00:00",
      slut: "2026-10-01T09:25:00",
      varighed: 1500,
    });
  });

  it("skriver starttidspunktet på den foregående dag ved et nattskifte", () => {
    // En pomodoro der slutter 00.15 hører til dagen før. `new Date("…")` ville
    // læse UTC-midnat og flytte dagen en dags tid tilbage ved UTC+2.
    expect(fasePeriode(new Date(2026, 9, 2, 0, 15, 0), 25)).toEqual({
      start: "2026-10-01T23:50:00",
      slut: "2026-10-02T00:15:00",
      varighed: 1500,
    });
  });

  it("lader varigheden følge den konfigurerede længde, ikke urets tik", () => {
    // Uret tikker sjældnere i en skjult fane, så en målt længde ville være
    // længere end den pomodoro, brugeren faktisk arbejdede.
    const lang = fasePeriode(slut, 25);
    expect(lang?.varighed).toBe(25 * 60);
  });

  it("giver ingen periode for en fase uden længde", () => {
    // En fase på 0 minutter må ikke blive en registrering på 0 sekunder —
    // den ville stå i tidslinjen uden længde.
    expect(fasePeriode(slut, 0)).toBeNull();
    expect(fasePeriode(slut, -5)).toBeNull();
  });
});

describe("fletPomodoroInd", () => {
  function blok(startedAt: string, key = startedAt): ActivityBlock {
    return {
      key,
      projectId: null,
      appName: "Code",
      category: null,
      isConfirmed: false,
      startedAt,
      endedAt: startedAt,
      totalDuration: 600,
      activityIds: [],
      activities: [],
      dominantTitle: null,
    };
  }

  /**
   * En fase med **forskellige** start- og sluttidspunkt.
   *
   * Sluttidspunktet er ikke starten: en mutation der sorterer på
   * `ended_at` i stedet for `started_at` var grøn, fordi denne fixture
   * oprindeligt sat begge dele til det samme klokkeslæt — så porten dømte en
   * egenskab den aldrig havde bedt om. Det er præcis den falske grøn, der lader
   * en fase fra kl. 09.00 stå *efter* et blok der begyndte 09.10.
   */
  function fase(
    id: string,
    startedAt: string,
    minutes = 25,
    registreret = false,
  ): PomodoroFase {
    const sluttidspunkt = new Date(
      new Date(startedAt).getTime() + minutes * 60 * 1000,
    );
    const pad = (n: number) => String(n).padStart(2, "0");
    return {
      id,
      day: startedAt.slice(0, 10),
      minutes,
      started_at: startedAt,
      registreret,
      ended_at: `${sluttidspunkt.getFullYear()}-${pad(
        sluttidspunkt.getMonth() + 1,
      )}-${pad(sluttidspunkt.getDate())}T${pad(sluttidspunkt.getHours())}:${pad(
        sluttidspunkt.getMinutes(),
      )}:00`,
    };
  }

  const rækker = (r: ReturnType<typeof fletPomodoroInd>): string[] =>
    r.map((x) => (x.slags === "fase" ? x.fase.id : x.blok.key));

  it("sætter en fase ind mellem de blokke den startede imellem", () => {
    const ud = fletPomodoroInd(
      [
        blok("2026-10-01T08:00:00", "morgen"),
        blok("2026-10-01T11:00:00", "eftermiddag"),
      ],
      [fase("pomo", "2026-10-01T09:00:00")],
    );
    // Rækkefølgen regnes på **start**, ikke på slut: en fase 09.00–09.25 skal stå
    // før et blok der begyndte 11.00, ellers læser dagen som om pomodoroen
    // kom efter middagspausen.
    expect(rækker(ud)).toEqual(["morgen", "pomo", "eftermiddag"]);
  });

  it("sorterer på starttidspunktet, ikke sluttidspunktet", () => {
    // Fasen startede 09.00 og sluttede 09.25; blokket begyndte 09.10. Rækkefølgen
    // efter start siger «jeg startede med pomodoroen»; efter slut ville den sige
    // «jeg startede i blokket» — og den er det, `K61`'s registrering skriver.
    const ud = fletPomodoroInd(
      [blok("2026-10-01T09:10:00", "skrivning")],
      [fase("pomo", "2026-10-01T09:00:00")],
    );
    expect(rækker(ud)).toEqual(["pomo", "skrivning"]);
  });

  it("lader faser og blokke beholde hver sin rækkefølge", () => {
    const ud = fletPomodoroInd(
      [blok("2026-10-01T08:00:00", "a"), blok("2026-10-01T10:00:00", "b")],
      [fase("p1", "2026-10-01T09:00:00"), fase("p2", "2026-10-01T11:00:00")],
    );
    expect(rækker(ud)).toEqual(["a", "p1", "b", "p2"]);
  });

  it("beholder blokrækkefølgen ved samme starttidspunkt", () => {
    // `sort` er stabil, så to blokke der begynder samme minut beholder den
    // rækkefølge `mergeActivitiesIntoBlocks` gav dem — ellers ville
    // sammenlægningen af et par minutters arbejde hoppe rundt mellem renders,
    // alt efter hvad fase-listen lige nu har af samme start. Fasen har samme
    // start som begge blokke og kommer derfor **efter** dem: rækkerne skubbes
    // ind i den rækkefølge, blokkene først, og stabil sortering bevarer den.
    // Det er vilkårligt, men det er *fast* vilkårligt — en ustabil sortering
    // ville give en fase en ny plads hver gang.
    const ud = fletPomodoroInd(
      [
        blok("2026-10-01T09:00:00", "først"),
        blok("2026-10-01T09:00:00", "senest"),
      ],
      [fase("pomo", "2026-10-01T09:00:00")],
    );
    expect(rækker(ud)).toEqual(["først", "senest", "pomo"]);
  });

  it("taber ingen fase, selv når starttidspunktet ikke kan læses", () => {
    // En backup med et ubrugeligt format. Rust springer den over, men hvis den
    // slap igennem, må dagens overskrift ikke tie om den — og `Invalid Date`
    // ville sende den i en fejlslag, der rammer hele dagens linje.
    const ud = fletPomodoroInd(
      [blok("2026-10-01T09:00:00", "skrivning")],
      [fase("mørk", "ikke et tidspunkt")],
    );
    expect(rækker(ud)).toEqual(["skrivning", "mørk"]);
  });

  it("giver dagen blokkene uændret, når der ikke var nogen pomodoro", () => {
    const blokke = [
      blok("2026-10-01T08:00:00", "a"),
      blok("2026-10-01T10:00:00", "b"),
    ];
    const ud = fletPomodoroInd(blokke, []);
    expect(rækker(ud)).toEqual(["a", "b"]);
    // **Samme objekter**, ikke kopier: `AnimatePresence` og de eksisterende
    // rækketaster i `TimelineView` skal stadig finde deres egne blokke, og en
    // ny reference hvert render ville få framer-motion til at se hver række
    // som en ny og animere hele dagen ind igen ved hvert tastetryk.
    const blokRækker = ud.filter(
      (r): r is Extract<typeof r, { slags: "blok" }> => r.slags === "blok",
    );
    expect(blokRækker[0]?.blok).toBe(blokke[0]);
    expect(blokRækker[1]?.blok).toBe(blokke[1]);
  });

  it("giver en tom linje for en dag uden blokke og uden faser", () => {
    expect(fletPomodoroInd([], [])).toEqual([]);
  });

  it("viser faserne selv på en dag uden registreret tid", () => {
    // Trackeren kan være slået fra, mens brugeren kører pomodoros. Dagen har så
    // ingen blokke, og uden faserne ville den stå tom — brugeren ville tro han
    // ikke havde arbejdet.
    const ud = fletPomodoroInd(
      [],
      [fase("p1", "2026-10-01T09:00:00"), fase("p2", "2026-10-01T09:30:00")],
    );
    expect(rækker(ud)).toEqual(["p1", "p2"]);
  });
});
