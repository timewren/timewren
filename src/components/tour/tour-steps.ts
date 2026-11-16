import { brand } from "@/lib/brand";
import type { ModuleKey } from "@/lib/modules/constants";

export interface TourStep {
  target: string;
  title: string;
  description: string;
  placement: "top" | "bottom" | "left" | "right" | "center";
  page?: string;
  waitFor?: number;
  highlight?: boolean;
  section?: string;
  /** Hvis sat, vises dette step kun når modulet er tændt for org'en. */
  requiresModule?: ModuleKey;
}

export const tourSections = [
  "Velkommen",
  "Tidsregistrering",
  "Opgaver",
  "Kunder & Projekter",
  "Klippekort & Fakturering",
  "Indstillinger",
  "Afslutning",
] as const;

export type TourSection = (typeof tourSections)[number];

export const tourSteps: TourStep[] = [
  // === Sektion 1: Velkommen & Overblik ===
  {
    target: "_welcome",
    title: `Velkommen til ${brand.name}!`,
    description:
      "Lad os vise dig rundt i de vigtigste funktioner, så du hurtigt kommer i gang. Det tager kun et par minutter.",
    placement: "center",
    highlight: false,
    section: "Velkommen",
    page: "/dashboard",
  },
  {
    target: "_modules_setup",
    title: `Sæt dit ${brand.name} op`,
    description:
      "Her vælger du hvilke moduler du vil bruge. Kernefunktionerne er tændt. Slå ekstra til som klippekort, opgaver eller integrationer. Du kan altid ændre det senere under Indstillinger → Moduler.",
    placement: "center",
    highlight: false,
    section: "Velkommen",
    page: "/dashboard/settings/modules",
  },
  {
    target: "hjem-prompt",
    title: "Skriv hvad du lavede",
    description: `Hjem er din startside. Skriv fx "2 timer på hjemmeside til Jensen" og tryk Enter. ${brand.name} foreslår kunde, projekt og tid, og du bekræfter før noget gemmes. Tryk / for at komme hertil.`,
    placement: "bottom",
    section: "Velkommen",
    page: "/dashboard",
  },
  {
    target: "hjem-hurtigstart",
    title: "Start en timer med ét klik",
    description:
      "Dine mest brugte projekter ligger klar her. Et klik starter timeren, eller fortsæt din seneste registrering.",
    placement: "left",
    section: "Velkommen",
  },
  {
    target: "nav-overblik",
    title: "Overblik",
    description:
      "Tal, omsætning, opgaver og klippekort samlet i widgets. Du finder det i menuen eller med G → O.",
    placement: "right",
    section: "Velkommen",
  },
  {
    target: "dashboard-widgets",
    title: "Widgets",
    description:
      "Overblikket er bygget op af widgets. Du kan se ugeoversigt, indtjening, aktive projekter og meget mere.",
    placement: "top",
    section: "Velkommen",
    page: "/dashboard/overblik",
  },
  {
    target: "dashboard-edit-btn",
    title: "Tilpas dit Overblik",
    description:
      "Klik her for at tilføje, fjerne og flytte widgets, så overblikket passer til din arbejdsgang.",
    placement: "bottom",
    section: "Velkommen",
  },

  // === Sektion 2: Tidsregistrering ===
  {
    target: "time-tracking-bar",
    title: "Timeren følger dig",
    description:
      "Tidsregistrering-baren er altid synlig øverst. Start med at vælge et projekt, og track din tid uanset hvilken side du er på.",
    placement: "bottom",
    section: "Tidsregistrering",
  },
  {
    target: "timer-start-btn",
    title: "Start & Stop",
    description:
      "Tryk her for at starte timeren, eller brug tastaturgenvejen T for hurtig start/stop.",
    placement: "bottom",
    section: "Tidsregistrering",
  },
  {
    target: "timer-project-select",
    title: "Vælg Projekt",
    description:
      "Vælg hvilket projekt du registrerer tid på. Timepris hentes automatisk fra projektet eller kunden.",
    placement: "bottom",
    section: "Tidsregistrering",
  },
  {
    target: "time-entries-list",
    title: "Dine Tidsregistreringer",
    description:
      "Her finder du alle dine tidsregistreringer. Rediger, filtrer efter dato, og eksportér til CSV.",
    placement: "top",
    page: "/dashboard/time",
    waitFor: 600,
    section: "Tidsregistrering",
  },
  {
    target: "time-view-toggle",
    title: "Skift Visning",
    description:
      "Skift mellem listevisning og ugeoversigt (timesheet). Ugeoversigten giver hurtigt overblik over din uge.",
    placement: "bottom",
    section: "Tidsregistrering",
  },

  // === Sektion 3: Opgaver ===
  {
    target: "tasks-board",
    title: "Opgavestyring",
    description:
      "Organiser dit arbejde med kanban-board. Træk opgaver mellem kolonner for at opdatere status.",
    placement: "top",
    page: "/dashboard/tasks",
    waitFor: 600,
    section: "Opgaver",
    requiresModule: "tasks",
  },
  {
    target: "tasks-add-btn",
    title: "Opret Opgaver",
    description:
      "Tilføj nye opgaver med ét klik. Sæt deadline, prioritet og knyt dem til et projekt.",
    placement: "bottom",
    section: "Opgaver",
    requiresModule: "tasks",
  },
  {
    target: "tasks-view-toggle",
    title: "Kanban eller Liste",
    description:
      "Skift mellem kanban-board og listevisning. Vælg det, der passer bedst til dig.",
    placement: "bottom",
    section: "Opgaver",
    requiresModule: "tasks",
  },

  // === Sektion 4: Kunder & Projekter ===
  {
    target: "clients-list",
    title: "Dine Kunder",
    description:
      "Administrer kunder med kontaktinfo, CVR-opslag og individuelle timepriser.",
    placement: "top",
    page: "/dashboard/clients",
    waitFor: 600,
    section: "Kunder & Projekter",
    requiresModule: "clients",
  },
  {
    target: "clients-add-btn",
    title: "Tilføj Kunder",
    description:
      "Opret nye kunder her. Brug CVR-opslag til automatisk at hente firmaoplysninger fra det danske CVR-register.",
    placement: "bottom",
    section: "Kunder & Projekter",
    requiresModule: "clients",
  },
  {
    target: "projects-list",
    title: "Projekter",
    description:
      "Hvert projekt hører til en kunde. Sæt timepriser, budgetter og deadlines per projekt.",
    placement: "top",
    page: "/dashboard/projects",
    waitFor: 600,
    section: "Kunder & Projekter",
    requiresModule: "projects",
  },

  // === Sektion 5: Klippekort & Fakturering ===
  {
    target: "klippekort-list",
    title: "Klippekort",
    description:
      "Klippekort er forudbetalte timepakker. Når du registrerer tid på et projekt med klippekort, trækkes det automatisk fra saldoen.",
    placement: "top",
    page: "/dashboard/klippekort",
    waitFor: 600,
    section: "Klippekort & Fakturering",
    requiresModule: "klippekort",
  },
  {
    target: "klippekort-add-btn",
    title: "Opret klippekort",
    description:
      "Opret et nyt klippekort her. Angiv antal timer, timepris og tilknyt det til en kunde.",
    placement: "bottom",
    section: "Klippekort & Fakturering",
    requiresModule: "klippekort",
  },
  {
    target: "invoices-list",
    title: "Fakturaer",
    description:
      "Opret og administrer fakturaer. Du kan generere fakturaer direkte fra dine tidsregistreringer.",
    placement: "top",
    page: "/dashboard/invoices",
    waitFor: 600,
    section: "Klippekort & Fakturering",
    requiresModule: "invoicing",
  },
  {
    target: "invoices-actions",
    title: "Opret fakturaer",
    description:
      "Opret en ny faktura manuelt, eller generer én automatisk fra ikke-fakturerede tidsregistreringer.",
    placement: "bottom",
    section: "Klippekort & Fakturering",
    requiresModule: "invoicing",
  },
  {
    target: "invoices-stats",
    title: "Fakturaoverblik",
    description:
      "Her ser du samlet status: total faktureret, betalt, udestående og forfaldne beløb.",
    placement: "top",
    section: "Klippekort & Fakturering",
    requiresModule: "invoicing",
  },

  // === Sektion 6: Rapporter & Indstillinger ===
  {
    target: "reports-page",
    title: "Rapporter og analyse",
    description:
      "Analyser tid og indtjening med detaljerede rapporter, grafer og eksportmuligheder.",
    placement: "top",
    page: "/dashboard/reports",
    waitFor: 600,
    section: "Indstillinger",
    requiresModule: "reports",
  },
  {
    target: "settings-page",
    title: "Indstillinger",
    description:
      "Her kan du opdatere din profil, standard timepris, ugentligt timemål og vælge mellem lyst og mørkt tema.",
    placement: "top",
    page: "/dashboard/settings",
    waitFor: 600,
    section: "Indstillinger",
  },
  {
    target: "settings-sidebar",
    title: "Flere Indstillinger",
    description:
      "Udforsk de øvrige indstillinger: virksomhedsprofil, sikkerhed, e-mail-integration, notifikationer, GDPR og meget mere.",
    placement: "right",
    section: "Indstillinger",
  },

  // === Sektion 7: Afslutning ===
  {
    target: "_finish",
    title: "Du er klar!",
    description:
      "Du kender nu de vigtigste funktioner. Brug Ctrl+K til at søge og navigere hurtigt. Du kan altid genstarte rundvisningen fra brugermenuen.",
    placement: "center",
    highlight: false,
    section: "Afslutning",
    page: "/dashboard",
  },
];

export function filterTourSteps(
  steps: TourStep[],
  isModuleEnabled: (module: ModuleKey) => boolean,
): TourStep[] {
  return steps.filter(
    (s) => !s.requiresModule || isModuleEnabled(s.requiresModule),
  );
}
