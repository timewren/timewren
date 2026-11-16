import type { RouterOutputs } from '~/api/app-router';
import { useRouter } from 'expo-router';
import * as React from 'react';
import { Card, EmptyState, ErrorState, ListRow, Skeleton } from '~/components/ui';
import { formatDateRelative, formatHours } from '~/lib/format';
import { entryHref } from '../hrefs';

type Entry = RouterOutputs['time']['list']['entries'][number];

type Props = {
  entries: Entry[] | undefined;
  isLoading: boolean;
  /**
   * Fejlen skal have sin egen tilstand. Uden den rammer et kald, der svarer
   * 500, `entries`-tjekket og skærmen siger "Ingen registrerede tider" — en
   * påstand om kunden som er lige så forkert som nullerne i `StatsRow`.
   */
  isError?: boolean;
  /** Allerede omsat af `errorMessage(error)` — denne komponent kender ikke API'et. */
  errorMessage?: string;
  onRetry?: () => void;
  emptyTitle: string;
  /** Vis projektnavn som sekundær linje (kunde-detalje) */
  showProject?: boolean;
};

function entryTitle(entry: Entry, showProject: boolean): string {
  const description = entry.description?.trim();
  if (description)
    return description;
  if (showProject && entry.project?.name)
    return entry.project.name;
  return formatDateRelative(entry.date);
}

function entrySubtitle(entry: Entry, showProject: boolean): string {
  const parts = [formatDateRelative(entry.date)];
  if (showProject && entry.project?.name && entry.description?.trim())
    parts.push(entry.project.name);
  return parts.join(' · ');
}

/** Seneste tidsposter — genbruges på kunde- og projekt-detalje. */
export function RecentEntries({ entries, isLoading, isError, errorMessage, onRetry, emptyTitle, showProject = true }: Props) {
  const router = useRouter();
  if (isLoading) {
    return (
      <Card className="gap-3">
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-4 w-3/5" />
      </Card>
    );
  }
  // Før tom-tilstanden: et kald der fejlede ved ikke at kunden har ingen tider.
  if (isError)
    return <Card><ErrorState message={errorMessage} onRetry={onRetry} /></Card>;
  if (!entries || entries.length === 0)
    return <Card><EmptyState title={emptyTitle} compact /></Card>;
  return (
    <Card className="p-0">
      {entries.map((entry, index) => (
        <ListRow
          key={entry.id}
          title={entryTitle(entry, showProject)}
          subtitle={entrySubtitle(entry, showProject)}
          right={formatHours(entry.hours)}
          onPress={() => router.push(entryHref(entry.id))}
          last={index === entries.length - 1}
          testID={`entry-row-${entry.id}`}
        />
      ))}
    </Card>
  );
}
