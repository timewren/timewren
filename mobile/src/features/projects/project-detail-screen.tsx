import type { ProjectStatus } from './project-logic';
import type { RouterOutputs } from '~/api/app-router';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Archive, ArchiveRestore, Pencil } from 'lucide-react-native';
import * as React from 'react';
import { Alert, View } from 'react-native';
import {
  Badge,
  Button,
  Card,
  colors,
  ErrorState,
  IconButton,
  ListSkeleton,
  Screen,
  SectionHeader,
  Select,
  Text,
} from '~/components/ui';
import { RecentEntries } from '~/features/clients/components/recent-entries';
import { clientHref, entriesNewHref, projectEditHref } from '~/features/clients/hrefs';
import { ProjectRates } from '~/features/project-health/project-rates';
import { errorMessage, trpc, useInvalidateDirectory } from '~/lib/api';
import { translate } from '~/lib/i18n';
import { showMessage, useReportLoad } from '~/lib/notify';
import { ScreenLoad } from '~/lib/notify-load';
import { ProjectStats } from './components/project-stats';
import { PROJECT_STATUSES, statusLabel, statusTone } from './project-logic';

type Project = RouterOutputs['projects']['getById'];

/**
 * Skærmen er skaldet, fordi *alle* dens kald skal kunne melde ind i samme
 * stop — også de to i `ProjectRates`. De ligger i en komponent under skærmen,
 * så `ScreenLoad` må stå uden for den; ellers ville prishistorien sige
 * "Indhold indlæst" for sig selv, lige efter skærmen havde sagt det samme.
 */
export function ProjectDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return (
    <ScreenLoad message={translate('common.loaded')}>
      <ProjectDetail id={id} />
    </ScreenLoad>
  );
}

function ProjectDetail({ id }: { id: string }) {
  const router = useRouter();
  const project = trpc.projects.getById.useQuery({ id }, { enabled: !!id });
  const stats = trpc.projects.getStats.useQuery({ projectId: id }, { enabled: !!id });
  const hasMonthly = !!project.data?.monthlyBudgetHours;
  const monthly = trpc.projects.monthlyBudget.useQuery({ projectId: id, months: 1 }, { enabled: !!id && hasMonthly });
  const recent = trpc.time.list.useQuery({ projectId: id, limit: 5 }, { enabled: !!id });
  // Månedsbudgettet er bevidst UDEN i stopket: det slås fra når projektet er
  // kommet, så en genindlæsning der afdækker et nyt budgetbudget ville starte
  // det op igen — og skærmen ville sige "indlæst" to gange for ét besøg.
  useReportLoad(project, translate('common.loaded'));
  useReportLoad(stats, translate('common.loaded'));
  useReportLoad(recent, translate('common.loaded'));

  const refreshing = project.isRefetching || stats.isRefetching || recent.isRefetching;
  const refresh = React.useCallback(() => {
    void project.refetch();
    void stats.refetch();
    void monthly.refetch();
    void recent.refetch();
  }, [project, stats, monthly, recent]);

  if (project.isLoading)
    return <Screen back title=""><ListSkeleton rows={4} /></Screen>;
  if (project.isError || !project.data)
    return <Screen back title=""><ErrorState message={errorMessage(project.error)} onRetry={refresh} /></Screen>;

  const data = project.data;
  const clientName = data.client?.name ?? translate('projects.internal');
  return (
    <Screen
      back
      title={data.name}
      subtitle={clientName}
      refreshing={refreshing}
      onRefresh={refresh}
      right={<IconButton icon={Pencil} label={translate('projects.edit')} onPress={() => router.push(projectEditHref(id))} testID="project-edit" />}
    >
      <StatusCard project={data} />
      {stats.isError
        ? (
            <View className="mt-3">
              <ErrorState message={errorMessage(stats.error)} onRetry={() => void stats.refetch()} />
            </View>
          )
        : <ProjectStats project={data} stats={stats.data} monthly={hasMonthly ? monthly.data : undefined} isLoading={stats.isLoading} />}

      <Button
        label={translate('projects.log_time')}
        onPress={() => router.push(entriesNewHref({ projectId: id, clientId: data.clientId }))}
        className="mt-4 rounded-xl bg-primary-600"
        textClassName="text-white"
        testID="project-log-time"
      />

      {data.description ? <Card className="mt-3"><Text className="text-foreground">{data.description}</Text></Card> : null}

      <ProjectRates projectId={id} />

      <SectionHeader title={translate('projects.recent_time')} />
      <RecentEntries
        entries={recent.data?.entries}
        isLoading={recent.isLoading}
        isError={recent.isError}
        errorMessage={errorMessage(recent.error)}
        onRetry={() => void recent.refetch()}
        emptyTitle={translate('projects.no_time')}
        showProject={false}
      />

      <SectionHeader title={translate('projects.actions_title')} />
      {data.client
        ? <Button variant="outline" label={data.client.name} onPress={() => router.push(clientHref(data.client!.id))} className="rounded-xl" testID="project-open-client" />
        : null}
      <ArchiveAction project={data} />
    </Screen>
  );
}

function StatusCard({ project }: { project: Project }) {
  const invalidateDirectory = useInvalidateDirectory();
  const updateStatus = trpc.projects.updateStatus.useMutation({
    onSuccess: () => {
      invalidateDirectory();
      showMessage({ message: translate('projects.status_updated'), type: 'success' });
    },
    onError: error => showMessage({ message: errorMessage(error), type: 'danger' }),
  });
  const options = React.useMemo(() => PROJECT_STATUSES.map(s => ({ value: s, label: statusLabel(s) })), []);
  return (
    <Card>
      <View className="flex-row items-center justify-between">
        <Text className="text-sm font-medium text-muted-foreground">{translate('projects.status')}</Text>
        <Badge label={statusLabel(project.status)} tone={statusTone(project.status)} />
      </View>
      <View className="mt-2">
        <Select
          value={project.status ?? 'active'}
          options={options}
          disabled={updateStatus.isPending}
          onSelect={value => updateStatus.mutate({ id: project.id, status: value as ProjectStatus })}
          testID="project-status"
        />
      </View>
    </Card>
  );
}

function ArchiveAction({ project }: { project: Project }) {
  const router = useRouter();
  const invalidateDirectory = useInvalidateDirectory();
  const onError = (error: unknown) => showMessage({ message: errorMessage(error), type: 'danger' });
  const updateStatus = trpc.projects.updateStatus.useMutation({
    onSuccess: (_, vars) => {
      invalidateDirectory();
      if (vars.status === 'archived') {
        showMessage({ message: translate('projects.archived_toast'), type: 'success' });
        router.back();
      }
      else {
        showMessage({ message: translate('projects.restored'), type: 'success' });
      }
    },
    onError,
  });
  const confirmArchive = () => {
    Alert.alert(
      translate('projects.archive_confirm_title', { name: project.name }),
      translate('projects.archive_confirm_body'),
      [
        { text: translate('projects.cancel'), style: 'cancel' },
        { text: translate('projects.archive'), style: 'destructive', onPress: () => updateStatus.mutate({ id: project.id, status: 'archived' }) },
      ],
    );
  };
  const archived = project.status === 'archived';
  return (
    <Button variant="outline" loading={updateStatus.isPending} onPress={archived ? () => updateStatus.mutate({ id: project.id, status: 'active' }) : confirmArchive} className="rounded-xl" testID="project-archive">
      <View className="flex-row items-center gap-2">
        {archived ? <ArchiveRestore size={18} color={colors.neutral[500]} /> : <Archive size={18} color={colors.danger[600]} />}
        <Text className={archived ? 'font-semibold text-foreground' : 'font-semibold text-danger-600'}>
          {archived ? translate('projects.restore') : translate('projects.archive')}
        </Text>
      </View>
    </Button>
  );
}
