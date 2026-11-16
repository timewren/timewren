import {
  isNavItemVisible,
  type SettingsEntry,
  type SettingsNavGroup,
  type SettingsNavItem,
  settingsAnchorAliases,
} from "./navigation-config";

export interface SettingsSearchResult {
  /** Unik nøgle til React-lister. */
  key: string;
  kind: "page" | "setting";
  label: string;
  /** Mål-URL, med `#id` når resultatet er en enkelt indstilling. */
  href: string;
  /** Siden indstillingen bor på (for sider: gruppen). */
  context: string;
}

/** `/dashboard/settings` + `afrunding` → `/dashboard/settings#afrunding`. */
export function settingsEntryHref(
  item: SettingsNavItem,
  entry?: SettingsEntry,
): string {
  return entry ? `${item.href}#${entry.id}` : item.href;
}

/** Ankeret fra en URL-hash, med gamle aliaser oversat (`#rounding`). */
export function resolveSettingsAnchor(hash: string): string | null {
  let id = hash.startsWith("#") ? hash.slice(1) : hash;
  try {
    id = decodeURIComponent(id);
  } catch {
    // Ugyldig %-kodning: brug den rå værdi
  }
  if (!id) return null;
  return settingsAnchorAliases[id] ?? id;
}

function normalize(text: string): string {
  return text.toLocaleLowerCase("da").trim();
}

/**
 * Hvor godt matcher ét søgeord et resultat? Lavere er bedre; null = intet
 * match. Titlen vægter højest, så "timepris" finder "Standard timepris" før
 * den side, der blot har ordet som nøgleord.
 */
function tokenScore(
  token: string,
  label: string,
  keywords: string[],
  rest: string[],
): number | null {
  if (label.startsWith(token)) return 0;
  if (label.split(/[\s&()-]+/).some((word) => word.startsWith(token))) {
    return 1;
  }
  if (label.includes(token)) return 2;
  if (keywords.some((kw) => kw.startsWith(token))) return 3;
  if (keywords.some((kw) => kw.includes(token))) return 4;
  if (rest.some((text) => text.includes(token))) return 5;
  return null;
}

interface Candidate {
  result: SettingsSearchResult;
  label: string;
  keywords: string[];
  rest: string[];
}

function candidates(groups: SettingsNavGroup[]): Candidate[] {
  const list: Candidate[] = [];
  for (const group of groups) {
    for (const item of group.items) {
      list.push({
        result: {
          key: item.href,
          kind: "page",
          label: item.label,
          href: settingsEntryHref(item),
          context: group.label,
        },
        label: normalize(item.label),
        keywords: item.keywords.map(normalize),
        rest: [normalize(item.description), normalize(group.label)],
      });
      for (const entry of item.settings ?? []) {
        list.push({
          result: {
            key: `${item.href}#${entry.id}`,
            kind: "setting",
            label: entry.label,
            href: settingsEntryHref(item, entry),
            context: item.label,
          },
          label: normalize(entry.label),
          keywords: (entry.keywords ?? []).map(normalize),
          // Sidens navn tæller med, så "sikkerhed passkeys" også rammer
          rest: [normalize(item.label)],
        });
      }
    }
  }
  return list;
}

/**
 * Søg i indstillingssider og enkelte indstillinger. Alle ord i søgningen
 * skal matche (titel, nøgleord, beskrivelse eller side). Rækkefølgen er
 * bedste match først, og ellers menuens rækkefølge.
 */
export function searchSettings(
  groups: SettingsNavGroup[],
  query: string,
  limit = 12,
): SettingsSearchResult[] {
  const tokens = normalize(query).split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return [];

  const scored: { result: SettingsSearchResult; score: number }[] = [];
  for (const candidate of candidates(groups)) {
    let score = 0;
    let matched = true;
    for (const token of tokens) {
      const s = tokenScore(
        token,
        candidate.label,
        candidate.keywords,
        candidate.rest,
      );
      if (s === null) {
        matched = false;
        break;
      }
      score += s;
    }
    if (matched) scored.push({ result: candidate.result, score });
  }

  // Ved lige point vinder den enkelte indstilling over siden ("sikkerhed
  // passkey" → Passkeys). Ellers beholder den stabile sortering menuens
  // rækkefølge.
  const kindRank = (r: SettingsSearchResult) => (r.kind === "setting" ? 0 : 1);
  return scored
    .sort(
      (a, b) => a.score - b.score || kindRank(a.result) - kindRank(b.result),
    )
    .slice(0, limit)
    .map((s) => s.result);
}

/**
 * Indstillingsgrupper, som brugeren kan se: samme rolle-, modul- og
 * flag-regler som sidemenuen (isNavItemVisible). Tomme grupper fjernes.
 */
export function visibleSettingsGroups(
  groups: SettingsNavGroup[],
  opts: Parameters<typeof isNavItemVisible>[1],
): SettingsNavGroup[] {
  return groups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => isNavItemVisible(item, opts)),
    }))
    .filter((group) => group.items.length > 0);
}

/**
 * Det menupunkt, der passer bedst til stien: længste href, der er et præfiks.
 * Så er "Adgangsstyring" aktiv på /dashboard/organization/permissions, ikke
 * også "Organisation & team".
 */
export function activeSettingsHref(
  groups: SettingsNavGroup[],
  pathname: string,
): string | null {
  let best: string | null = null;
  for (const group of groups) {
    for (const item of group.items) {
      const path = item.href.split("?")[0];
      const matches =
        pathname === path ||
        // Præfiks uden "/" med vilje: /settings/email-templates/[id] hører
        // under "Email & skabeloner".
        (path !== "/dashboard/settings" && pathname.startsWith(path));
      if (matches && (best === null || path.length > best.length)) {
        best = item.href;
      }
    }
  }
  return best;
}
