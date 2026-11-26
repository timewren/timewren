import type { ActivityStats } from './client-activity-logic';
import type { RouterOutputs } from '~/api/app-router';
import type { ProjectListItem } from '~/features/projects/components/project-list';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Archive, ArchiveRestore, Mail, Pencil, Phone } from 'lucide-react-native';
import * as React from 'react';
import { Alert, Linking, Pressable, View } from 'react-native';
import { useUniwind } from 'uniwind';
import {
  Badge,
  Button,
  Card,
  ColorDot,
  colors,
  EmptyState,
  ErrorState,
  IconButton,
  ListSkeleton,
  Screen,
  SectionHeader,
  Text,
} from '~/components/ui';
import { useCapabilities } from '~/features/capabilities/use-capabilities';
import { PrepaidCard } from '~/features/prepaid/components/prepaid-card';
import { ProjectList } from '~/features/projects/components/project-list';
import { errorMessage, trpc, useInvalidateDirectory } from '~/lib/api';
import { translate } from '~/lib/i18n';
import { showMessage, useReportLoad } from '~/lib/notify';
import { ScreenLoad } from '~/lib/notify-load';
import { HISTORY_LIMIT } from './client-history-logic';
import { ClientActivity } from './components/client-activity';
import { ClientHistory } from './components/client-history';
import { ClientStats } from './components/client-stats';
import { RecentEntries } from './components/recent-entries';
import { clientEditHref, entriesNewHref, prepaidHref, prepaidNewHref, projectNewHref } from './hrefs';

type Client = RouterOutputs['clients']['getById'];

export function ClientDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const caps = useCapabilities();
  const showPrepaid = caps.isEnabled('klippekort');
  const showProjects = caps.isEnabled('projects');
  const showInvoices = caps.isEnabled('invoicing');

  const client = trpc.clients.getById.useQuery({ id }, { enabled: !!id });
  const stats = trpc.clients.listWithStats.useQuery({ includeArchived: true }, { enabled: !!id });
  const projects = trpc.projects.getByClient.useQuery({ clientId: id }, { enabled: !!id && showProjects });
  const prepaid = trpc.prepaid.list.useQuery({ clientId: id, activeOnly: true }, { enabled: !!id && showPrepaid });
  const recent = trpc.time.list.useQuery({ clientId: id, limit: 5 }, { enabled: !!id });
  // `invoices.list` kan ikke filtrere på status, kun sortere nyeste først,
  // så grænsen er vilkårlig og kortet tager den første (jf. `lastInvoice`).
  const invoices = trpc.invoices.list.useQuery({ clientId: id, limit: 10 }, { enabled: !!id && showInvoices });
  // Historikken er én rapport, så den skal selv afgrænses: `entityId` er
  // påkrævet for at få netop denne kunde, ellers får vi hele loggen.
  const history = trpc.activity.list.useQuery({ entityType: 'client', entityId: id, limit: HISTORY_LIMIT }, { enabled: !!id });

  // Ét stop for hele skærmen: regionerne *melder* ind i det, og de to med egne
  // lister (projekterne, `ProjectList`; fakturaerne, `ClientActivity`) gør det
  // selv. Gatede kald er slået fra når kapabiliteten mangler, og React Query
  // tæller et slået-fra kald som færdigt, så et lukket hjørne ikke forsinker.
  useReportLoad(client, translate('common.loaded'));
  useReportLoad(stats, translate('common.loaded'));
  useReportLoad(prepaid, translate('common.loaded'));
  useReportLoad(recent, translate('common.loaded'));
  useReportLoad(invoices, translate('common.loaded'));
  useReportLoad(history, translate('common.loaded'));

  const clientStats = React.useMemo(() => stats.data?.find(c => c.id === id)?.stats, [stats.data, id]);
  const { refreshing, refresh } = refreshAll([client, stats, projects, prepaid, recent, invoices, history]);

  let body: React.ReactNode;
  if (client.isLoading) {
    body = <Screen back title={translate('navigation.client')}><ListSkeleton rows={4} /></Screen>;
  }
  else if (client.isError || !client.data) {
    body = <Screen back title={translate('navigation.client')}><ErrorState message={errorMessage(client.error)} onRetry={refresh} /></Screen>;
  }
  else {
    const data = client.data;
    body = (
      <Screen
        back
        title={data.name}
        subtitle={data.company ?? undefined}
        refreshing={refreshing}
        onRefresh={refresh}
        right={<IconButton icon={Pencil} label={translate('clients.edit')} onPress={() => router.push(clientEditHref(id))} testID="client-edit" />}
      >
        <ClientHeader client={data} />
        <ClientStats client={data} stats={clientStats} isLoading={stats.isLoading} isError={stats.isError} errorMessage={errorMessage(stats.error)} onRetry={() => void stats.refetch()} />

        {showInvoices
          ? <ActivitySection clientStats={clientStats} statsFailed={stats.isError} invoices={invoices} />
          : null}

        <Button
          label={translate('clients.log_time')}
          onPress={() => router.push(entriesNewHref({ clientId: id }))}
          className="mt-4 rounded-xl bg-primary-600"
          textClassName="text-white"
          testID="client-log-time"
        />

        {showProjects
          ? (
              <ProjectsSection
                clientId={id}
                projects={projects.data}
                isLoading={projects.isLoading}
                isError={projects.isError}
                error={projects.error}
                onRetry={() => void projects.refetch()}
              />
            )
          : null}

        {showPrepaid
          ? (
              <PrepaidSection
                clientId={id}
                packages={prepaid.data}
                isLoading={prepaid.isLoading}
                isError={prepaid.isError}
                error={prepaid.error}
                onRetry={() => void prepaid.refetch()}
                onOpen={pid => router.push(prepaidHref(pid))}
              />
            )
          : null}

        <RecentSection recent={recent} />

        <HistorySection history={history} />

        <SectionHeader title={translate('clients.actions_title')} />
        <ArchiveAction client={data} />
      </Screen>
    );
  }

  return <ScreenLoad message={translate('common.loaded')}>{body}</ScreenLoad>;
}

/** Kun den del af et tRPC-query vi videregiver til en sektion. */
type Queryish<T> = {
  data: T | undefined;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  refetch: () => unknown;
};

/**
 * Ét pull-to-refresh for hele skærmen. `refreshing` og `refresh` læser den
 * samme liste, så de kan ikke komme i uoverensstemmelse om hvilke kald der
 * genhentes — den fejl, en kodet værdi pr. kald invitede til.
 */
function refreshAll(kall: { isRefetching: boolean; refetch: () => unknown }[]) {
  return {
    refreshing: kall.some(k => k.isRefetching),
    refresh: () => {
      for (const k of kall) void k.refetch();
    },
  };
}

/** «Seneste tid»-sektionen med overskrift, så `ClientDetailScreen` holder sig under linjetallet. */
function RecentSection({ recent }: { recent: Queryish<RouterOutputs['time']['list']> }) {
  return (
    <>
      <SectionHeader title={translate('clients.recent_time')} />
      <RecentEntries
        entries={recent.data?.entries}
        isLoading={recent.isLoading}
        isError={recent.isError}
        errorMessage={errorMessage(recent.error)}
        onRetry={() => void recent.refetch()}
        emptyTitle={translate('clients.no_time')}
      />
    </>
  );
}

type ActivitySectionProps = {
  clientStats: ActivityStats;
  /** `clients.listWithStats` fejlede — `ClientStats` ovenfor viser fejlen. */
  statsFailed: boolean;
  invoices: Queryish<RouterOutputs['invoices']['list']>;
};

/** «Historik»-sektionen med overskrift, så skærmen holder sig under linjetallet. */
function HistorySection({ history }: { history: Queryish<RouterOutputs['activity']['list']> }) {
  return (
    <>
      <SectionHeader title={translate('clients.history_title')} />
      <ClientHistory
        logs={history.data}
        isLoading={history.isLoading}
        isError={history.isError}
        errorMessage={errorMessage(history.error)}
        onRetry={() => void history.refetch()}
        limit={HISTORY_LIMIT}
      />
    </>
  );
}

/** «Senest set»-sektionen med overskrift, så `ClientDetailScreen` holder sig under linjetallet. */
function ActivitySection({ clientStats, statsFailed, invoices }: ActivitySectionProps) {
  return (
    <>
      <SectionHeader title={translate('clients.activity_section')} />
      <ClientActivity
        stats={clientStats}
        statsFailed={statsFailed}
        invoices={invoices.data}
        isLoading={invoices.isLoading}
        isError={invoices.isError}
        errorMessage={errorMessage(invoices.error)}
        onRetry={() => void invoices.refetch()}
      />
    </>
  );
}

type ProjectsSectionProps = {
  clientId: string;
  projects: ProjectListItem[] | undefined;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  onRetry: () => void;
};

/**
 * Projektregionen med sin egen fejltilstand.
 *
 * Den lå i skærmens JSX, hvilket gjorde den umulig at melde ind i skærmens
 * stop — så den talte selv, oven i skærmens egen besked.
 */
function ProjectsSection({ clientId, projects, isLoading, isError, error, onRetry }: ProjectsSectionProps) {
  const router = useRouter();
  return (
    <>
      <SectionHeader
        title={translate('clients.projects_section')}
        action={{ label: translate('clients.new_project'), onPress: () => router.push(projectNewHref(clientId)), testID: 'client-new-project' }}
      />
      <ProjectList
        projects={projects}
        isLoading={isLoading}
        isError={isError}
        errorMessage={errorMessage(error)}
        onRetry={onRetry}
        emptyTitle={translate('clients.no_projects')}
        emptyAction={{ label: translate('clients.new_project'), onPress: () => router.push(projectNewHref(clientId)) }}
      />
    </>
  );
}

function ClientHeader({ client }: { client: Client }) {
  const { theme } = useUniwind();
  const tint = theme === 'dark' ? colors.primary[400] : colors.primary[600];
  const hasContact = !!client.email || !!client.phone;
  return (
    <Card>
      <View className="flex-row items-center gap-2">
        <ColorDot color={client.color} size={12} />
        <Text className="text-sm text-muted-foreground">{[client.address, client.postalCode, client.city].filter(Boolean).join(', ') || client.country || ''}</Text>
        {client.isArchived ? <Badge label={translate('clients.archived')} tone="warning" /> : null}
      </View>
      {hasContact
        ? (
            <View className="mt-3 gap-2">
              {client.email
                ? (
                    <ContactRow icon={<Mail size={16} color={tint} />} text={client.email} onPress={() => void Linking.openURL(`mailto:${client.email}`)} testID="client-email" />
                  )
                : null}
              {client.phone
                ? (
                    <ContactRow icon={<Phone size={16} color={tint} />} text={client.phone} onPress={() => void Linking.openURL(`tel:${client.phone}`)} testID="client-phone" />
                  )
                : null}
            </View>
          )
        : null}
      {client.cvrNumber ? <Text className="mt-2 text-xs text-muted-foreground">{`CVR ${client.cvrNumber}`}</Text> : null}
    </Card>
  );
}

function ContactRow({ icon, text, onPress, testID }: { icon: React.ReactNode; text: string; onPress: () => void; testID: string }) {
  return (
    <Pressable onPress={onPress} className="flex-row items-center gap-2 active:opacity-70" accessibilityRole="link" testID={testID}>
      {icon}
      <Text className="text-base text-primary-600 dark:text-primary-400">{text}</Text>
    </Pressable>
  );
}

type PrepaidPkg = RouterOutputs['prepaid']['list'][number];

type PrepaidSectionProps = PrepaidListProps & { clientId: string };

function PrepaidSection({ clientId, packages, isLoading, isError, error, onRetry, onOpen }: PrepaidSectionProps) {
  const router = useRouter();
  return (
    <>
      <SectionHeader
        title={translate('clients.prepaid_section')}
        action={{ label: translate('clients.new_prepaid'), onPress: () => router.push(prepaidNewHref(clientId)), testID: 'client-new-prepaid' }}
      />
      <PrepaidList packages={packages} isLoading={isLoading} isError={isError} error={error} onRetry={onRetry} onOpen={onOpen} />
    </>
  );
}

type PrepaidListProps = {
  packages: PrepaidPkg[] | undefined;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  onRetry: () => void;
  onOpen: (id: string) => void;
};

function PrepaidList({ packages, isLoading, isError, error, onRetry, onOpen }: PrepaidListProps) {
  if (isLoading)
    return <ListSkeleton rows={1} />;
  // Et kald der fejler betyder ikke "kunden har ingen klippekort".
  if (isError)
    return <Card><ErrorState message={errorMessage(error)} onRetry={onRetry} /></Card>;
  if (!packages || packages.length === 0)
    return <Card><EmptyState title={translate('clients.no_prepaid')} compact /></Card>;
  return (
    <View className="gap-2">
      {packages.map(pkg => <PrepaidCard key={pkg.id} pkg={pkg} hideClient onPress={() => onOpen(pkg.id)} />)}
    </View>
  );
}

function ArchiveAction({ client }: { client: Client }) {
  const router = useRouter();
  const invalidateDirectory = useInvalidateDirectory();
  const onDone = (message: string) => {
    invalidateDirectory();
    showMessage({ message, type: 'success' });
  };
  const onError = (error: unknown) => showMessage({ message: errorMessage(error), type: 'danger' });
  const archive = trpc.clients.archive.useMutation({
    onSuccess: () => {
      onDone(translate('clients.archived_toast'));
      router.back();
    },
    onError,
  });
  const unarchive = trpc.clients.unarchive.useMutation({
    onSuccess: () => onDone(translate('clients.restored')),
    onError,
  });

  const confirmArchive = () => {
    Alert.alert(
      translate('clients.archive_confirm_title', { name: client.name }),
      translate('clients.archive_confirm_body'),
      [
        { text: translate('clients.cancel'), style: 'cancel' },
        { text: translate('clients.archive'), style: 'destructive', onPress: () => archive.mutate({ id: client.id }) },
      ],
    );
  };

  if (client.isArchived) {
    return (
      <Button variant="outline" label={translate('clients.restore')} loading={unarchive.isPending} onPress={() => unarchive.mutate({ id: client.id })} testID="client-restore">
        <View className="flex-row items-center gap-2">
          <ArchiveRestore size={18} color={colors.neutral[500]} />
          <Text className="font-semibold text-foreground">{translate('clients.restore')}</Text>
        </View>
      </Button>
    );
  }
  return (
    <Button variant="outline" loading={archive.isPending} onPress={confirmArchive} testID="client-archive">
      <View className="flex-row items-center gap-2">
        <Archive size={18} color={colors.danger[600]} />
        <Text className="font-semibold text-danger-600">{translate('clients.archive')}</Text>
      </View>
    </Button>
  );
}
