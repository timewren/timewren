import type { StatTone } from '~/components/ui/stat-tile';
import { useRouter } from 'expo-router';
import { FolderKanban } from 'lucide-react-native';
import * as React from 'react';
import { Badge, Card, EmptyState, ErrorState, ListRow, Skeleton } from '~/components/ui';
import { projectHref } from '~/features/clients/hrefs';
import { formatHours } from '~/lib/format';
import { translate } from '~/lib/i18n';
import { useReportLoad } from '~/lib/notify';
import { statusLabel, statusTone } from '../project-logic';

/** Minimum et projekt skal opfylde for at kunne vises — matcher `projects.list`/`getByClient`. */
export type ProjectListItem = {
  id: string;
  name: string;
  status: string | null;
  hourlyRate?: string | null;
  client?: { name: string } | null;
  stats?: { totalHours: number } | null;
};

type Props = {
  projects: ProjectListItem[] | undefined;
  isLoading: boolean;
  /** Fedtes med `isError`, så et kald der fejler ikke bliver til "Ingen projekter". */
  isError?: boolean;
  /** Allerede omsat af `errorMessage(error)` — denne komponent kender ikke API'et. */
  errorMessage?: string;
  onRetry?: () => void;
  /** Vis kundenavn som sekundær linje (når listen går på tværs af kunder) */
  showClient?: boolean;
  emptyAction?: { label: string; onPress: () => void };
  emptyTitle?: string;
};

function subtitle(project: ProjectListItem, showClient: boolean): string | undefined {
  const parts: string[] = [];
  if (showClient)
    parts.push(project.client?.name ?? translate('projects.internal'));
  if (project.stats)
    parts.push(formatHours(project.stats.totalHours));
  return parts.length ? parts.join(' · ') : undefined;
}

/** Genbrugelig projektliste (kunde-detalje, overblik m.m.). Aktive først. */
export function ProjectList({ projects, isLoading, isError, errorMessage, onRetry, showClient = false, emptyAction, emptyTitle }: Props) {
  const router = useRouter();
  // Den *melder* sit kald, den taler ikke selv: begge kaldssteder sidder under en
  // skærm med sit eget stop, så en egen besked ville høres to gange — og på
  // kundedetaljerne den første mens fire andre regioner stadig summerede.
  // Den ærlige `isError` med: den var hardkodet til false, så listen sagde
  // "indlæst" også når kallet bag den svarer 500 — og viste så den tomme tilstand.
  useReportLoad({ isLoading, isError: isError ?? false }, translate('common.loaded'));
  // Arkiverede sidst; memoiseret så sortering ikke sker ved hver render.
  const sorted = React.useMemo(
    () => [...(projects ?? [])].sort((a, b) => Number(a.status === 'archived') - Number(b.status === 'archived')),
    [projects],
  );
  if (isLoading) {
    return (
      <Card className="gap-3">
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-4 w-1/2" />
      </Card>
    );
  }
  if (isError) {
    return <Card><ErrorState message={errorMessage} onRetry={onRetry} /></Card>;
  }
  if (!projects || projects.length === 0) {
    return (
      <Card>
        <EmptyState
          icon={FolderKanban}
          title={emptyTitle ?? translate('projects.empty_title')}
          action={emptyAction ? { ...emptyAction, testID: 'projects-empty-new' } : undefined}
          compact
        />
      </Card>
    );
  }
  return (
    <Card className="p-0">
      {sorted.map((project, index) => (
        <ListRow
          key={project.id}
          title={project.name}
          subtitle={subtitle(project, showClient)}
          right={project.status && project.status !== 'active'
            ? <Badge label={statusLabel(project.status)} tone={statusTone(project.status) as StatTone} />
            : undefined}
          onPress={() => router.push(projectHref(project.id))}
          last={index === sorted.length - 1}
          testID={`project-row-${project.id}`}
        />
      ))}
    </Card>
  );
}
