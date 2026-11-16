/**
 * Datasæt til branchesiderne (/timeregistrering-<branche>). Én kilde,
 * fem sider — programmatic SEO med unikt indhold pr. branche (10x-3).
 * Kvalitetsgate: ingen side uden egne pains, benchmark og FAQ.
 */

export interface Branche {
  slug: string;
  /** Bestemt form til overskrifter, fx "fotografer" */
  flertal: string;
  /** Ental til brødtekst, fx "fotograf" */
  ental: string;
  /** Typisk timepris-interval, DKK ekskl. moms (skøn — formuleres forsigtigt) */
  timeprisInterval: [number, number];
  intro: string;
  pains: { title: string; text: string }[];
  faq: { question: string; answer: string }[];
}

export const BRANCHER: Branche[] = [
  {
    slug: "fotograf",
    flertal: "fotografer",
    ental: "fotograf",
    timeprisInterval: [800, 1500],
    intro:
      "Som freelancefotograf er selve optagelsen kun toppen af isbjerget: research, kørsel, kulling, redigering og levering æder timerne. Det er præcis de timer, der sjældent når fakturaen.",
    pains: [
      {
        title: "Redigeringstimerne forsvinder",
        text: "En times shoot bliver til tre timers redigering. Uden registrering pr. opgave fakturerer du shootet og forærer redigeringen væk.",
      },
      {
        title: "Kørsel og opsætning",
        text: "Transport, opsætning og nedtagning er arbejdstid. Registrér den pr. kunde, så du kan se om dine pakkepriser reelt hænger sammen.",
      },
      {
        title: "Pakkepriser uden bund",
        text: "Bryllupper og events sælges som pakker. Men ved du hvad din reelle timepris ender på? Uden tidsdata er pakkeprisen et gæt.",
      },
    ],
    faq: [
      {
        question: "Hvad tjener en freelancefotograf i timen?",
        answer:
          "Typisk 800–1.500 kr. ekskl. moms afhængigt af speciale og erfaring. Men den EFFEKTIVE timepris er ofte langt lavere, fordi redigering og kørsel ikke faktureres. Registrér al tid pr. opgave for at kende dit reelle tal.",
      },
      {
        question: "Skal jeg fakturere redigeringstid?",
        answer:
          "Ja, enten som en del af pakkeprisen (prissat ud fra reelle tidsdata) eller som separat linje. Registrér redigering pr. kunde, så du har dokumentationen.",
      },
      {
        question: "Kan jeg sælge klippekort som fotograf?",
        answer:
          "Ja. Klippekort passer perfekt til faste kunder med løbende behov (produktfoto til webshops, content til SoMe). Kunden forudbetaler fx 10 timer, og du trækker fra saldoen.",
      },
    ],
  },
  {
    slug: "udvikler",
    flertal: "udviklere",
    ental: "udvikler",
    timeprisInterval: [800, 1400],
    intro:
      "Som freelanceudvikler jonglerer du typisk flere kunder, support-afbrydelser og 'lige en hurtig rettelse'. Det er kontekstskiftene og småopgaverne der siver ud af fakturaen, ikke de store funktioner.",
    pains: [
      {
        title: "Support og småfixes",
        text: "Ti minutters bugfix her, et deploy dér. Enkeltvis er de ligegyldige. Over en måned er de fakturerbare dage. Timer-knappen skal være ét klik væk.",
      },
      {
        title: "Flere kunder, samme dag",
        text: "Kontekstskift mellem projekter gør bagudrettet registrering håbløs. Registrér mens du arbejder, med kunde og projekt valgt på forhånd.",
      },
      {
        title: "Estimater uden feedback",
        text: "Uden faktisk tid pr. opgave lærer dine estimater aldrig. Sammenlign estimat og forbrug, og prissæt næste projekt bedre.",
      },
    ],
    faq: [
      {
        question: "Hvad tjener en freelanceudvikler i timen?",
        answer:
          "Typisk 800–1.400 kr. ekskl. moms i Danmark afhængigt af stack og erfaring. Specialister (fx sikkerhed, ML, ERP) ligger over.",
      },
      {
        question: "Hvordan fakturerer jeg support-aftaler?",
        answer:
          "Klippekort er den oplagte model: kunden forudbetaler fx 10 timers support, du trækker registreret tid fra saldoen, og genkøb sker når saldoen er lav.",
      },
      {
        question: "Kan jeg starte timeren fra browseren?",
        answer:
          "Ja. TimeTrack har en browser-extension, hvor du starter timeren med ét klik direkte fra fanen, du arbejder i.",
      },
    ],
  },
  {
    slug: "konsulent",
    flertal: "konsulenter",
    ental: "konsulent",
    timeprisInterval: [900, 1600],
    intro:
      "Som selvstændig konsulent ER din tid produktet. Møder, forberedelse, transport og opfølgning skal alle kunne dokumenteres, for kunden betaler kun det, du kan gøre rede for.",
    pains: [
      {
        title: "Forberedelse og opfølgning",
        text: "Mødet varede to timer, men du brugte fire. Uden registrering af forberedelse og opfølgning fakturerer du halvdelen af dit arbejde.",
      },
      {
        title: "Dokumentationskrav",
        text: "Større kunder kræver specifikation: hvad blev der lavet, hvornår, og hvor længe? En rapport pr. periode gør fakturaen uangribelig.",
      },
      {
        title: "Retainer-aftaler der skrider",
        text: "Fast månedligt honorar uden tidsdata bliver til scope creep. Registrér timerne mod aftalen, så du kan genforhandle på fakta.",
      },
    ],
    faq: [
      {
        question: "Hvad tager en selvstændig konsulent i timen?",
        answer:
          "Typisk 900–1.600 kr. ekskl. moms afhængigt af felt. Management og IT-konsulenter ligger i den høje ende, mens mindre specialiserede opgaver ligger lavere.",
      },
      {
        question: "Skal jeg fakturere transporttid?",
        answer:
          "Aftal det på forhånd. Mange fakturerer 50-100% af timeprisen for transport. Vigtigst: registrér den, så du kan se hvad kørende kunder reelt koster dig.",
      },
      {
        question: "Hvordan dokumenterer jeg mine timer over for kunden?",
        answer:
          "Med en timerapport pr. periode med opgavebeskrivelser. I TimeTrack kan kunden endda selv følge med via kundeportalen.",
      },
    ],
  },
  {
    slug: "designer",
    flertal: "designere",
    ental: "designer",
    timeprisInterval: [700, 1200],
    intro:
      "Som freelancedesigner lever du af kreativt arbejde der er svært at sætte på formel, og netop derfor er tidsdata dit vigtigste værn mod endeløse rettelsesrunder og priser der udhules.",
    pains: [
      {
        title: "Rettelsesrunde 7",
        text: "'Lige en lille justering' er sjældent lille. Registrér tid pr. rettelsesrunde, så du kan håndhæve de to inkluderede runder og fakturere resten.",
      },
      {
        title: "Kreativ tid tæller også",
        text: "Skitser, moodboards og research ER arbejdet. Uden registrering ender 'idéfasen' som gratis tilgift til kunden.",
      },
      {
        title: "Fastpris uden facit",
        text: "Logo til fast pris? Fint, men kun hvis du bagefter kan se om projektet tog 12 eller 40 timer. Ellers gentager du fejlprisen.",
      },
    ],
    faq: [
      {
        question: "Hvad tjener en freelancedesigner i timen?",
        answer:
          "Typisk 700–1.200 kr. ekskl. moms afhængigt af speciale. UX/UI og brand-design ligger i den høje ende, produktionsopgaver lavere.",
      },
      {
        question: "Hvordan undgår jeg endeløse rettelsesrunder?",
        answer:
          "Skriv antal inkluderede runder i aftalen, og registrér tiden pr. runde. Når runde 3 starter, har du både hjemmel og dokumentation til at fakturere ekstra.",
      },
      {
        question: "Fastpris eller timepris som designer?",
        answer:
          "Fastpris fungerer når du kender dit tidsforbrug, og det kræver tidsdata fra tidligere projekter. Mange kombinerer: fastpris på veldefinerede leverancer, timepris (eller klippekort) på løbende arbejde.",
      },
    ],
  },
  {
    slug: "oversaetter",
    flertal: "oversættere",
    ental: "oversætter",
    timeprisInterval: [500, 900],
    intro:
      "Som freelanceoversætter afregner du ofte pr. ord eller linje, men din indtjening afgøres af timerne bag. Kender du din reelle timepris pr. opgavetype, ved du hvilke opgaver du skal sige ja til.",
    pains: [
      {
        title: "Ordpris skjuler timeprisen",
        text: "To opgaver til samme ordpris kan give vidt forskellig timeløn: fagsprog, research og formatering æder tiden. Registrér tiden pr. opgave og regn baglæns.",
      },
      {
        title: "Korrektur og revision",
        text: "Kundens 'små ændringer' efter levering er arbejdstid. Registrér dem, så gentagne revisioner kan faktureres eller prises ind.",
      },
      {
        title: "Mange små opgaver",
        text: "Ti opgaver á 45 minutter for fem kunder på én uge. Uden systematisk registrering bliver faktureringen et puslespil med manglende brikker.",
      },
    ],
    faq: [
      {
        question: "Hvad tjener en freelanceoversætter i timen?",
        answer:
          "Regnet om fra ord-/linjepriser lander mange på 500–900 kr. ekskl. moms i timen, men spændet er stort. Registrér tiden pr. opgave, så du kender din reelle timepris pr. opgavetype.",
      },
      {
        question: "Ordpris eller timepris?",
        answer:
          "Brancher afregner typisk pr. ord, men DIN beslutning om at tage opgaven bør bygge på timeprisen bag. Tidsdata pr. opgavetype viser hvilke opgaver der betaler sig.",
      },
      {
        question: "Kan jeg bruge klippekort som oversætter?",
        answer:
          "Ja. Faste kunder med løbende behov (webshops, bureauer) kan forudbetale et antal timer, som du trækker fra ved hver opgave. Det fjerner minimums-fakturaer og rykkere.",
      },
    ],
  },
];
