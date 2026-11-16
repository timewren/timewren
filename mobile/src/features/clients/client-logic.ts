import type { TxKeyPath } from '~/lib/i18n';
import { intlLocale } from '~/lib/locale';

export type ClientSort = 'name' | 'hours' | 'activity';

export type ClientListItem = {
  id: string;
  name: string;
  company?: string | null;
  email?: string | null;
  isArchived?: boolean | null;
  stats: {
    totalHours: number;
    projectCount: number;
    unbilledHours: number;
    lastActivityDate: string | null;
  };
};

export type ClientFilter = {
  query: string;
  archived: boolean;
  sort: ClientSort;
};

function matches(client: ClientListItem, q: string): boolean {
  if (!q)
    return true;
  const hay = [client.name, client.company ?? '', client.email ?? ''].join(' ').toLowerCase();
  return hay.includes(q);
}

/** Filtrér (aktive/arkiverede + søgning) og sortér kundelisten. */
export function filterClients<T extends ClientListItem>(list: readonly T[], filter: ClientFilter): T[] {
  const q = filter.query.trim().toLowerCase();
  const out = list.filter(c => !!c.isArchived === filter.archived && matches(c, q));
  return out.sort((a, b) => compareClients(a, b, filter.sort));
}

export function compareClients(a: ClientListItem, b: ClientListItem, sort: ClientSort): number {
  if (sort === 'hours') {
    const diff = b.stats.totalHours - a.stats.totalHours;
    if (diff !== 0)
      return diff;
  }
  if (sort === 'activity') {
    const ta = a.stats.lastActivityDate ? new Date(a.stats.lastActivityDate).getTime() : 0;
    const tb = b.stats.lastActivityDate ? new Date(b.stats.lastActivityDate).getTime() : 0;
    if (ta !== tb)
      return tb - ta;
  }
  return a.name.localeCompare(b.name, intlLocale());
}

/**
 * Præ-definerede kundefarver (samme palet som web's farvevælger) med dansk navn
 * til skærmlæseren: en hex-kode læses som "number sign e one one d", så den er
 * ubrugelig for en stemme. Én liste, så en ny farve ikke kan komme uden navn.
 */
export type ClientColor = { hex: string; tx: TxKeyPath };

export const CLIENT_COLOR_CHOICES: readonly ClientColor[] = [
  { hex: '#2563EB', tx: 'clients.color_blue' },
  { hex: '#7C3AED', tx: 'clients.color_violet' },
  { hex: '#DB2777', tx: 'clients.color_pink' },
  { hex: '#DC2626', tx: 'clients.color_red' },
  { hex: '#EA580C', tx: 'clients.color_orange' },
  { hex: '#D97706', tx: 'clients.color_amber' },
  { hex: '#16A34A', tx: 'clients.color_green' },
  { hex: '#0D9488', tx: 'clients.color_teal' },
  { hex: '#0891B2', tx: 'clients.color_cyan' },
  { hex: '#64748B', tx: 'clients.color_slate' },
];

/** Kun hex-koderne, til farveprikker og testID'er. */
export const CLIENT_COLORS: readonly string[] = CLIENT_COLOR_CHOICES.map(c => c.hex);

const HEX_RE = /^#[0-9a-f]{6}$/i;

export function isHexColor(value: string | null | undefined): value is string {
  return !!value && HEX_RE.test(value);
}

/** Tomme strenge → undefined så backendens `.optional()` accepterer dem. */
export function blankToUndefined(value: string): string | undefined {
  const t = value.trim();
  return t === '' ? undefined : t;
}
