import { translate } from '~/lib/i18n';

type Named = { name: string } | null | undefined;

export type EntryLike = {
  description?: string | null;
  project?: ({ name: string; client?: Named } | null);
  client?: Named;
  task?: { title: string } | null;
  tags?: readonly { name: string }[];
};

/** Kundenavn: direkte på posten eller via projektet. */
export function entryClientName(entry: EntryLike): string | null {
  return entry.client?.name ?? entry.project?.client?.name ?? null;
}

/** "Projekt · Kunde" / "Kunde" / "Intern tid" — med tag-navne bagved. */
export function entryContextLabel(entry: EntryLike): string {
  const parts = [entry.project?.name, entryClientName(entry)].filter(Boolean) as string[];
  const tags = (entry.tags ?? []).map(t => t.name).filter(Boolean);
  if (parts.length === 0)
    return tags.length ? `${translate('entries.internal')} · ${tags.join(', ')}` : translate('entries.internal');
  // Undgå "Kunde · Kunde" når projektet hedder det samme som kunden
  const context = Array.from(new Set(parts)).join(' · ');
  return tags.length ? `${context} · ${tags.join(', ')}` : context;
}

/** Beskrivelsen, ellers konteksten — så en række aldrig er tom. */
export function entryTitle(entry: EntryLike): string {
  const text = entry.description?.trim();
  return text && text.length > 0 ? text : entryContextLabel(entry);
}
