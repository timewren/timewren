import { createHash } from "node:crypto";

export const locales = ["en", "da", "de", "es"] as const;
export type DemoLocale = (typeof locales)[number];
export const scenes = {
  dashboard: "/dashboard/overblik",
  timer: "/dashboard/time",
  "prepaid-hours": "/dashboard/klippekort",
  invoices: "/dashboard/invoices",
  clients: "/dashboard/clients",
  projects: "/dashboard/projects",
  tasks: "/dashboard/tasks",
  reports: "/dashboard/reports",
  calendar: "/dashboard/calendar",
  "mobile-dashboard": "/dashboard",
  "dashboard-dark": "/dashboard/overblik",
  "prepaid-hours-dark": "/dashboard/klippekort",
} as const;

export function localDatabase(value = process.env.DATABASE_URL): string {
  if (!value)
    throw new Error("Set DATABASE_URL to a disposable local database");
  const url = new URL(value);
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    url.hostname !== "127.0.0.1" ||
    url.search !== "" ||
    !url.pathname.startsWith("/timewren_screenshots")
  )
    throw new Error(
      "Only 127.0.0.1/timewren_screenshots* databases are allowed",
    );
  return value;
}

export function id(key: string): string {
  const hex = createHash("sha256").update(`timewren-demo:${key}`).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

// Invented names; reserved .invalid mailboxes, no business identifiers or addresses.
export const copy = {
  en: {
    studio: "Fernquill Studio",
    report: "Project overview",
    people: ["Robin Fernquill", "Casey Mossvale", "Alex Wrenwick"],
    clients: [
      "Mossquill Workshop",
      "Fernwhistle Books",
      "Pebblewren Ceramics",
      "Cloudthimble Studio",
      "Willowpocket Gardens",
      "Ambernest Atelier",
      "Pinewhisk Learning",
    ],
    projects: [
      "Website refresh",
      "Visual identity",
      "Online shop",
      "Content planning",
      "Accessibility review",
      "Product catalogue",
      "Learning platform",
    ],
    work: [
      "Design exploration",
      "Interface development",
      "Project meeting",
      "Content review",
      "Testing and refinement",
      "Release preparation",
    ],
    package: "Support hours",
    meeting: "Design review",
    task: "Prepare the next design review",
    lanes: ["To do", "In progress", "Done"],
  },
  da: {
    studio: "Bregnefjer Studio",
    report: "Projektoversigt",
    people: ["Kim Bregnefjer", "Sasja Mosdal", "Alex Vrangfjer"],
    clients: [
      "Mosfjer Værksted",
      "Bregnefløjt Bøger",
      "Stenfjer Keramik",
      "Skyfinger Studio",
      "Pilelomme Haver",
      "Ravrede Atelier",
      "Fyrrekvast Læring",
    ],
    projects: [
      "Ny hjemmeside",
      "Visuel identitet",
      "Webshop",
      "Indholdsplan",
      "Tilgængelighedstjek",
      "Produktkatalog",
      "Læringsplatform",
    ],
    work: [
      "Designforslag",
      "Udvikling af brugerflade",
      "Projektmøde",
      "Gennemgang af indhold",
      "Test og tilpasning",
      "Klargøring til lancering",
    ],
    package: "Supporttimer",
    meeting: "Designgennemgang",
    task: "Forbered næste designgennemgang",
    lanes: ["Planlagt", "I gang", "Afsluttet"],
  },
  de: {
    studio: "Farnfeder Studio",
    report: "Projektübersicht",
    people: ["Kim Farnfeder", "Sascha Moostal", "Alex Zaunfeder"],
    clients: [
      "Moosfeder Werkstatt",
      "Farnpfiff Bücher",
      "Kieselfink Keramik",
      "Wolkenfinger Studio",
      "Weidentasche Gärten",
      "Bernsteinnest Atelier",
      "Kiefernquast Lernen",
    ],
    projects: [
      "Neue Website",
      "Visuelle Identität",
      "Onlineshop",
      "Inhaltsplanung",
      "Barrierefreiheit prüfen",
      "Produktkatalog",
      "Lernplattform",
    ],
    work: [
      "Designentwürfe",
      "Oberflächenentwicklung",
      "Projektbesprechung",
      "Inhalte prüfen",
      "Testen und verfeinern",
      "Veröffentlichung vorbereiten",
    ],
    package: "Supportstunden",
    meeting: "Designbesprechung",
    task: "Nächste Designbesprechung vorbereiten",
    lanes: ["Geplant", "In Bearbeitung", "Erledigt"],
  },
  es: {
    studio: "Estudio Helepluma",
    report: "Resumen de proyectos",
    people: ["Álex Helepluma", "Dani Musgovalle", "Cris Nidohoja"],
    clients: [
      "Taller Musgopluma",
      "Libros Heletrino",
      "Cerámica Piedranido",
      "Estudio Nubededal",
      "Jardines Saucebolsillo",
      "Atelier Ámbarpico",
      "Aprendizaje Pinoborla",
    ],
    projects: [
      "Renovación de la web",
      "Identidad visual",
      "Tienda en línea",
      "Plan de contenidos",
      "Revisión de accesibilidad",
      "Catálogo de productos",
      "Plataforma de aprendizaje",
    ],
    work: [
      "Propuestas de diseño",
      "Desarrollo de la interfaz",
      "Reunión de proyecto",
      "Revisión de contenidos",
      "Pruebas y ajustes",
      "Preparación del lanzamiento",
    ],
    package: "Horas de soporte",
    meeting: "Revisión de diseño",
    task: "Preparar la próxima revisión de diseño",
    lanes: ["Pendiente", "En curso", "Completado"],
  },
} satisfies Record<DemoLocale, unknown>;

export function demoData(locale: DemoLocale, today = new Date()) {
  const text = copy[locale];
  const day = (offset: number, hour = 9) => {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() + offset);
    d.setUTCHours(hour, 0, 0, 0);
    return d;
  };
  const orgId = id(`${locale}:org`);
  const userId = id(`${locale}:user:0`);
  return {
    locale,
    text,
    day,
    orgId,
    userId,
    email: `demo-${locale}@timewren.invalid`,
    clients: text.clients.map((name, index) => ({
      id: id(`${locale}:client:${index}`),
      name,
      cvrNumber: null,
    })),
  };
}
