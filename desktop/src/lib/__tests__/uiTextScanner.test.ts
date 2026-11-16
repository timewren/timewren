import { describe, expect, it } from "vitest";
import { type Fund, scanFil } from "@/lib/__tests__/uiTextScanner";

/**
 * Scannerens egen port. `i18n.test.ts` dømmer *mængden* af fund i `src/`, men
 * den kan ikke sige hvilken regel der fangede hvad — og den lå grøn, mens fire
 * danske strenge stod i to filer den burde have set (fund 30/9). Derfor dømmer
 * den her hver regel på en streng, der ligner den fra den virkelige kode.
 */
function scan(krop: string): Fund[] {
  return scanFil(
    "Snippet.tsx",
    `export function Snippet() {\n  ${krop}\n}\n`,
  ).map((fund) => ({ ...fund, tekst: fund.tekst }));
}

describe("uiTextScanner: sættere", () => {
  it("ser en besked der løber gennem en sætter", () => {
    // Præcis fundet fra 30/9: `ExportSettings` og `CalendarIntegration` havde
    // begge `setSaveStatus("Fejl ved gemning")`, og porten så ingen af dem.
    expect(scan(`setSaveStatus("Fejl ved gemning");`)).toEqual([
      expect.objectContaining({
        tekst: "Fejl ved gemning",
        regel: "sætter",
        linje: 2,
      }),
    ]);
  });

  it("lader en nøgleform stå i fred", () => {
    // En nøgle har et punktum, så den ligner hverken en tilstand eller en
    // sætning. `i18n.test.ts` dømmer nøgler i hele appen — tager denne port dem
    // også, dømmer den samme streng to steder og undtagelseslisten bliver rodet.
    expect(scan(`setActiveView("timeline.bulkDelete");`)).toEqual([]);
  });

  it("ser en sætter bag en parentes", () => {
    // Samme skjulested som en terning: en indpakning må ikke gøre strengen
    // usynlig, fordi kaldet stadig er det første argument.
    expect(scan(`setGemt(("Gemt"));`)).toEqual([
      expect.objectContaining({ tekst: "Gemt", regel: "sætter" }),
    ]);
  });

  it("ser begge grene af en terning i en sætter", () => {
    const fund = scan(`setStatus(fejl ? "Gemt" : "Fejl ved gemning");`);
    expect(fund.map((f) => f.tekst)).toEqual(["Gemt", "Fejl ved gemning"]);
  });

  it("ser en hel streng i en sætter med vilkår", () => {
    // `??`-grenen her var en synlig dansk standardværdi i TrackingSettings.
    const fund = scan(`setMeetingApps(gemt ?? "teams, zoom, meet, webex");`);
    expect(fund.map((f) => f.tekst)).toEqual(["teams, zoom, meet, webex"]);
  });

  it("ser en sætter der ligger inde i et andet kald", () => {
    // Kaldet ved siden af er ligegyldigt: strengen er stadig første argument i
    // en sætter, så den er stadig en besked til brugeren.
    expect(scan(`setTimeout(() => setGemt("Gemt"), 0);`)).toEqual([
      expect.objectContaining({ tekst: "Gemt", regel: "sætter" }),
    ]);
  });

  it("dømmer kun første argument i en sætter", () => {
    // Resten af en sætters argumenter er nøgler og data, ikke beskeder.
    expect(scan(`setGemt(id, "Gemt");`)).toEqual([]);
  });

  it("lader en tilstand være i fred", () => {
    // Målt 30/9: en regel der dømmer hvert `set*`-kald, gav 28 fund hvor de 25
    // var tilstande som `"success"` og `"valid"` — aldrig malet, kun
    // sammenlignet. Den slags fund bliver slettet som støj, så porten skal
    // skelne på formen: en besked har mellemrum eller stort begyndelsesbogstav,
    // en tilstand er ét lille ord.
    expect(scan(`setStatus("success"); setLicenseState("valid");`)).toEqual([]);
  });

  it("lader en kalder uden stort bogstav være i fred", () => {
    expect(scan(`settings.save(); gettext("Fejl");`)).toEqual([]);
  });

  it("ser en toast med en terning, som var det andet glemte fund", () => {
    const fund = scan(
      `toast.error(typeof err === "string" ? err : "Faktura kunne ikke færdiggøres");`,
    );
    expect(fund).toEqual([
      expect.objectContaining({
        tekst: "Faktura kunne ikke færdiggøres",
        regel: "toast",
      }),
    ]);
  });

  it("dømmer ikke en streng der bare står i en kaldes senere argument", () => {
    // `toast.error(t("key"), { description: "…" })`-formen: den anden streng er
    // en indstilling, ikke beskeden til brugeren.
    expect(scan(`toast.error(t("nøgle"), "ikke en besked");`)).toEqual([]);
  });

  it("dømmer en streng der er en property stadig som property", () => {
    // Reglen for sættere må ikke ændre de andre reglers betydning.
    expect(scan(`const x = { label: "Kundenavn" };`)).toEqual([
      expect.objectContaining({ tekst: "Kundenavn", regel: "property" }),
    ]);
  });
});

describe("uiTextScanner: strenge i JSX-udtryk", () => {
  // To blinde pletter fundet 1/10 ved at køre scannerens AST-regler for hånd
  // over hele `src/`. Begge viste dansk, ingen undtagelse, ingen port:
  //
  //   1. `entry.project_name ?? "Ingen projekt"` — en streng i en `??` inde i
  //      en JSX-{}-container. `JsxText`-reglen læser kun *mellem* tags, så den
  //      så den ikke; kalde-kravet så den heller ikke, fordi `??` ikke er et
  //      kald. Nøglen `calendar.noProject` lå i alle fem sprog, alligevel stod
  //      «Ingen projekt» i dansk i koden.
  //   2. ``setSyncMessage(`${newCount} nye begivenheder importeret`)`` — en
  //      template med en indsat værdi. `StringLiteral` og
  //      `NoSubstitutionTemplateLiteral` dækker kun de to former uden
  //      `${…}`, så den tredje form var usynlig for hele porten.
  //
  // Formen er ikke sjælden: en synlig standardværdi (`?? "…"`) og en besked med
  // et tal i (`${n} …`) er de to almindeligste måder en sætning havner i
  // `CalendarIntegration` og `ContextDiagnostics` på.

  it("ser en synlig standardværdi i en JSX-terning", () => {
    // Præcis fundet fra CalendarEntry:79.
    expect(scan(`<div>{entry.project_name ?? "Ingen projekt"}</div>`)).toEqual([
      expect.objectContaining({ tekst: "Ingen projekt", regel: "jsx-udtryk" }),
    ]);
  });

  it("ser en streng i en JSX-terning", () => {
    expect(
      scan(`<button>{klar ? "Importér kalender" : "Indlæser"}</button>`),
    ).toEqual([
      expect.objectContaining({
        tekst: "Importér kalender",
        regel: "jsx-udtryk",
      }),
      expect.objectContaining({ tekst: "Indlæser", regel: "jsx-udtryk" }),
    ]);
  });

  it("ser en template med indsat værdi i en sætter", () => {
    // Præcis fundet fra CalendarIntegration:71 — «nye begivenheder
    // importeret» stod i dansk og blev aldrig oversat.
    const fund = scan(
      // Biome læser `${newCount}` som en JS-placeholder, men det er netop den
      // kode der skal dømmes — så reglen slås fra for denne linje.
      // biome-ignore lint/suspicious/noTemplateCurlyInString: koden under prøve
      "setSyncMessage(`${newCount} nye begivenheder importeret`);",
    );
    expect(fund).toEqual([
      expect.objectContaining({
        tekst: "4 nye begivenheder importeret",
        regel: "sætter",
      }),
    ]);
  });

  it("ser begge grene af en terning i en JSX-terning", () => {
    expect(
      scan(
        `<span>{n > 0 ? \`\${n} nye begivenheder\` : "Kalenderen er opdateret"}</span>`,
      ),
    ).toEqual([
      expect.objectContaining({
        tekst: "4 nye begivenheder",
        regel: "jsx-udtryk",
      }),
      expect.objectContaining({
        tekst: "Kalenderen er opdateret",
        regel: "jsx-udtryk",
      }),
    ]);
  });

  it("lader en template med bare CSS i className være i fred", () => {
    // Ellers bliver reglen 60 fund, hvor de 58 er Tailwind-klasser — og en
    // port der producerer den slags støj bliver slettet som støj.
    //
    // Der er IKKE brug for en `className`-skeln i scanneren: kravet om at
    // heles forælder er en `JsxElement` udelukker attributten i sig selv, for
    // `<div className={…} />` er `className={…}` en `JsxAttribute` og ikke et
    // barn. Det blev dømt ved mutation — en `isClassName`-funktion skrev først
    // som løsning var død kode, kun min egen test holdt den i live.
    expect(
      scan(`<div className={\`flex gap-2 \${stor ? "p-4" : ""}\`} />`),
    ).toEqual([]);
  });

  it("lader en template med bare CSS i en className-variabel være i fred", () => {
    // Samme Tailwind-streng, men leveret via en variabel. `AiSettings`,
    // `FeedbackButton` og `LoadError` skriver det sådan, og det er den form
    // der gav 60 fund da reglen første gang blev skrevet.
    expect(
      scan(`const c = \`flex items-center gap-2 \${fed ? "p-4" : ""}\`;`),
    ).toEqual([]);
  });

  it("lader en nøgleform stå i fred i en JSX-terning", () => {
    // `i18n.test.ts` dømmer nøgler i hele appen, så denne port skal ikke tage
    // dem — heller ikke når de står i en streng med ${} omkring.
    expect(
      scan(`<div>{a ? t("calendar.noProject") : b ? t("x.y") : c}</div>`),
    ).toEqual([]);
  });

  it("lader en tilstand være i fred i en JSX-terning", () => {
    // Samme skeln som sætterreglen har. `{"success"}` er en nøgle, der bliver
    // sammenlignet, ikke noget en bruger læser — målt 1/10 som de fund der fik
    // reglen skrevet uden denne skeln.
    expect(scan(`<div>{fejl ? "Gemt" : a ?? "success"}</div>`)).toEqual([
      expect.objectContaining({ tekst: "Gemt", regel: "jsx-udtryk" }),
    ]);
  });

  it("lader en template med kun indhold være i fred", () => {
    // `` `0 0 ${SIZE} ${SIZE}` `` er en SVG-størrelse, ikke tekst.
    expect(
      scan(`<svg><circle cx={\`0 0 \${størrelse} \${størrelse}\`} /></svg>`),
    ).toEqual([]);
  });
});
