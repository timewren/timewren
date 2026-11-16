import type { DocsLocale } from "@/lib/brands/timewren-docs";

/*
 * UI-tekster til TimeWren-docs: egne knapper og Fumadocs' egne strenge
 * (nøglerne fra fumadocs-ui/.translations). Engelsk er Fumadocs' standard,
 * så kun da/de/es oversætter Fumadocs-nøglerne.
 */

export interface DocsUiCopy {
  /** Navn i sprogvælgeren. */
  displayName: string;
  home: string;
  docs: string;
  copyMarkdown: string;
  copied: string;
  copyFailed: string;
  openChatGpt: string;
  openClaude: string;
  viewMarkdown: string;
  /** Forudfyldt prompt; {url} er sidens .md-URL. */
  prompt: string;
  /** Mærke for sprog, hvis oversættelse ikke er gennemlæst. */
  beta?: string;
  metaTitleSuffix: string;
}

export const DOCS_UI: Record<DocsLocale, DocsUiCopy> = {
  en: {
    displayName: "English",
    home: "Home",
    docs: "Docs",
    copyMarkdown: "Copy as Markdown",
    copied: "Copied",
    copyFailed: "Copy failed",
    openChatGpt: "Open in ChatGPT",
    openClaude: "Open in Claude",
    viewMarkdown: "View as Markdown",
    prompt:
      "Read {url}, the TimeWren documentation for this topic, and help me with my TimeWren setup. Ask me for anything you need to know.",
    metaTitleSuffix: "TimeWren Docs",
  },
  da: {
    displayName: "Dansk",
    home: "Forside",
    docs: "Dokumentation",
    copyMarkdown: "Kopiér som Markdown",
    copied: "Kopieret",
    copyFailed: "Kunne ikke kopiere",
    openChatGpt: "Åbn i ChatGPT",
    openClaude: "Åbn i Claude",
    viewMarkdown: "Vis som Markdown",
    prompt:
      "Læs {url}, TimeWren-dokumentationen om emnet, og hjælp mig med min TimeWren-opsætning. Spørg mig om det, du har brug for at vide.",
    metaTitleSuffix: "TimeWren-dokumentation",
  },
  de: {
    displayName: "Deutsch",
    home: "Startseite",
    docs: "Dokumentation",
    copyMarkdown: "Als Markdown kopieren",
    copied: "Kopiert",
    copyFailed: "Kopieren fehlgeschlagen",
    openChatGpt: "In ChatGPT öffnen",
    openClaude: "In Claude öffnen",
    viewMarkdown: "Als Markdown anzeigen",
    prompt:
      "Lies {url}, die TimeWren-Dokumentation zu diesem Thema, und hilf mir mit meiner TimeWren-Installation. Frag mich, wenn du etwas wissen musst.",
    metaTitleSuffix: "TimeWren-Dokumentation",
  },
  es: {
    displayName: "Español",
    home: "Inicio",
    docs: "Documentación",
    copyMarkdown: "Copiar como Markdown",
    copied: "Copiado",
    copyFailed: "No se pudo copiar",
    openChatGpt: "Abrir en ChatGPT",
    openClaude: "Abrir en Claude",
    viewMarkdown: "Ver como Markdown",
    prompt:
      "Lee {url}, la documentación de TimeWren sobre este tema, y ayúdame con mi instalación de TimeWren. Pregúntame lo que necesites saber.",
    metaTitleSuffix: "Documentación de TimeWren",
  },
};

type FumadocsStrings = Record<string, string>;

/** Fumadocs' egne strenge (nøgle = engelsk tekst + kontekst). */
export const FUMADOCS_UI: Record<Exclude<DocsLocale, "en">, FumadocsStrings> = {
  da: {
    "Search(search trigger)": "Søg",
    "Search(search dialog)": "Søg",
    "Open Search(search trigger)(aria-label)": "Åbn søgning",
    "Close Search(search dialog)(aria-label)": "Luk søgning",
    "No results found(search dialog)": "Ingen resultater",
    "Search failed(search dialog)": "Søgningen fejlede",
    "On this page(table of contents)": "På denne side",
    "No Headings(table of contents)": "Ingen overskrifter",
    "Table of Contents(inline table of contents)": "Indhold",
    "Next Page(pagination)": "Næste side",
    "Previous Page(pagination)": "Forrige side",
    "Choose a language(language switcher)": "Vælg sprog",
    "Choose a language(language switcher)(aria-label)": "Vælg sprog",
    "Toggle Theme(theme switcher)(aria-label)": "Skift tema",
    "Light(theme switcher)(aria-label)": "Lys",
    "Dark(theme switcher)(aria-label)": "Mørk",
    "System(theme switcher)(aria-label)": "System",
    "Copy Text(code block)(aria-label)": "Kopiér",
    "Copied Text(code block)(aria-label)": "Kopieret",
    "Copy Anchor Link(heading anchor)(aria-label)": "Kopiér link",
    "Copied Anchor Link(heading anchor)(aria-label)": "Link kopieret",
    "Open Sidebar(sidebar)(aria-label)": "Åbn menu",
    "Close Sidebar(sidebar)(aria-label)": "Luk menu",
    "Close Sidebar(aria-label)": "Luk menu",
    "Collapse Sidebar(sidebar)(aria-label)": "Fold menuen sammen",
    "Toggle Menu(mobile menu)(aria-label)": "Menu",
    "Skip to Content(skip link)": "Gå til indhold",
    "Page Not Found(404 page)": "Siden findes ikke",
    "Back to Home(404 page)": "Til forsiden",
  },
  de: {
    "Search(search trigger)": "Suchen",
    "Search(search dialog)": "Suchen",
    "Open Search(search trigger)(aria-label)": "Suche öffnen",
    "Close Search(search dialog)(aria-label)": "Suche schließen",
    "No results found(search dialog)": "Keine Ergebnisse",
    "Search failed(search dialog)": "Suche fehlgeschlagen",
    "On this page(table of contents)": "Auf dieser Seite",
    "No Headings(table of contents)": "Keine Überschriften",
    "Table of Contents(inline table of contents)": "Inhalt",
    "Next Page(pagination)": "Nächste Seite",
    "Previous Page(pagination)": "Vorherige Seite",
    "Choose a language(language switcher)": "Sprache wählen",
    "Choose a language(language switcher)(aria-label)": "Sprache wählen",
    "Toggle Theme(theme switcher)(aria-label)": "Design wechseln",
    "Light(theme switcher)(aria-label)": "Hell",
    "Dark(theme switcher)(aria-label)": "Dunkel",
    "System(theme switcher)(aria-label)": "System",
    "Copy Text(code block)(aria-label)": "Kopieren",
    "Copied Text(code block)(aria-label)": "Kopiert",
    "Copy Anchor Link(heading anchor)(aria-label)": "Link kopieren",
    "Copied Anchor Link(heading anchor)(aria-label)": "Link kopiert",
    "Open Sidebar(sidebar)(aria-label)": "Menü öffnen",
    "Close Sidebar(sidebar)(aria-label)": "Menü schließen",
    "Close Sidebar(aria-label)": "Menü schließen",
    "Collapse Sidebar(sidebar)(aria-label)": "Menü einklappen",
    "Toggle Menu(mobile menu)(aria-label)": "Menü",
    "Skip to Content(skip link)": "Zum Inhalt",
    "Page Not Found(404 page)": "Seite nicht gefunden",
    "Back to Home(404 page)": "Zur Startseite",
  },
  es: {
    "Search(search trigger)": "Buscar",
    "Search(search dialog)": "Buscar",
    "Open Search(search trigger)(aria-label)": "Abrir búsqueda",
    "Close Search(search dialog)(aria-label)": "Cerrar búsqueda",
    "No results found(search dialog)": "Sin resultados",
    "Search failed(search dialog)": "La búsqueda falló",
    "On this page(table of contents)": "En esta página",
    "No Headings(table of contents)": "Sin encabezados",
    "Table of Contents(inline table of contents)": "Contenido",
    "Next Page(pagination)": "Página siguiente",
    "Previous Page(pagination)": "Página anterior",
    "Choose a language(language switcher)": "Elegir idioma",
    "Choose a language(language switcher)(aria-label)": "Elegir idioma",
    "Toggle Theme(theme switcher)(aria-label)": "Cambiar tema",
    "Light(theme switcher)(aria-label)": "Claro",
    "Dark(theme switcher)(aria-label)": "Oscuro",
    "System(theme switcher)(aria-label)": "Sistema",
    "Copy Text(code block)(aria-label)": "Copiar",
    "Copied Text(code block)(aria-label)": "Copiado",
    "Copy Anchor Link(heading anchor)(aria-label)": "Copiar enlace",
    "Copied Anchor Link(heading anchor)(aria-label)": "Enlace copiado",
    "Open Sidebar(sidebar)(aria-label)": "Abrir menú",
    "Close Sidebar(sidebar)(aria-label)": "Cerrar menú",
    "Close Sidebar(aria-label)": "Cerrar menú",
    "Collapse Sidebar(sidebar)(aria-label)": "Contraer menú",
    "Toggle Menu(mobile menu)(aria-label)": "Menú",
    "Skip to Content(skip link)": "Ir al contenido",
    "Page Not Found(404 page)": "Página no encontrada",
    "Back to Home(404 page)": "Volver al inicio",
  },
};

/** Den forudfyldte prompt med sidens Markdown-URL. */
export function docsPrompt(locale: DocsLocale, markdownUrl: string): string {
  return DOCS_UI[locale].prompt.replace("{url}", markdownUrl);
}

export function chatGptUrl(prompt: string): string {
  return `https://chatgpt.com/?${new URLSearchParams({ hints: "search", q: prompt })}`;
}

export function claudeUrl(prompt: string): string {
  return `https://claude.ai/new?${new URLSearchParams({ q: prompt })}`;
}
