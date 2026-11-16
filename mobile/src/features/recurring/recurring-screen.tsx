import type { ParkAction, Row } from './recurring-logic';
import type { RouterOutputs } from '~/api/app-router';
import { useRouter } from 'expo-router';
import { Plus, Repeat } from 'lucide-react-native';
import * as React from 'react';
import {
  Card,
  EmptyState,
  ErrorState,
  IconButton,
  ListSkeleton,
  Screen,
  SectionHeader,
  Text,
} from '~/components/ui';
import { errorMessage, trpc } from '~/lib/api';
import { translate } from '~/lib/i18n';
import { useAnnounceLoaded } from '~/lib/notify';
import { TemplateRow } from './components/template-row';
import { mergePending } from './recurring-logic';
import { useGenerate } from './use-generate';
import { usePark } from './use-park';

type Template = RouterOutputs['recurring']['list'][number];

/**
 * Gentagne registreringer: de skabeloner, der er klar, og hele katalogen.
 *
 * «Klar» er **serverens** vurdering — `recurring.getPending` bruger samme
 * præmis som cron'en (`isActive`, `!isPaused`, `frequency` sat,
 * `nextDue <= now`). Appen regner den ikke selv: et lokalt «er den forfalden?»
 * ville svare noget andet end det, der sker den næste morgen.
 */
export function RecurringScreen() {
  const pendingQuery = trpc.recurring.getPending.useQuery();
  const listQuery = trpc.recurring.list.useQuery();
  const { generateRow, busyId } = useGenerate();
  const { parkRow, busyId: parkBusyId } = usePark();
  const router = useRouter();
  const openEdit = React.useCallback((templateId: string) => router.push(`/recurring/${templateId}`), [router]);

  const refresh = React.useCallback(() => {
    void pendingQuery.refetch();
    void listQuery.refetch();
  }, [listQuery, pendingQuery]);

  useAnnounceLoaded(listQuery, translate('common.loaded'));

  const loading = (pendingQuery.isLoading || listQuery.isLoading) && !listQuery.data;
  const all: Template[] = listQuery.data ?? [];
  const known = new Set(all.map(t => t.id));
  // `list` er en supermængde af `getPending` (samme bruger, samme rækker minus
  // de to filtre), så en forfalden skabelon uden katalogsvar er en fejl i
  // serveren. Den springes over frem for at vises med ufuldstændige data.
  const ready = mergePending(pendingQuery.data ?? [], all).filter(r => known.has(r.id));
  const pendingIds = new Set(ready.map(r => r.id));

  const body = loading
    ? <ListSkeleton rows={3} />
    : listQuery.isError || pendingQuery.isError
      ? <ErrorState message={errorMessage(listQuery.error ?? pendingQuery.error)} onRetry={refresh} />
      : all.length === 0
        ? <EmptyTemplates />
        : (
            <>
              <ReadySection rows={ready} onGenerate={generateRow} busyId={busyId} onPark={parkRow} parkBusyId={parkBusyId} onEdit={openEdit} />
              <CatalogueSection all={all} pendingIds={pendingIds} onPark={parkRow} parkBusyId={parkBusyId} onEdit={openEdit} />
            </>
          );

  return (
    <Screen
      title={translate('recurring.title')}
      back
      right={<IconButton icon={Plus} label={translate('recurring.new_action')} onPress={() => router.push('/recurring/new')} testID="recurring-new" />}
      refreshing={listQuery.isRefetching || pendingQuery.isRefetching}
      onRefresh={refresh}
    >
      {body}
    </Screen>
  );
}

function ReadySection({ rows, onGenerate, busyId, onPark, parkBusyId, onEdit }: {
  rows: Row[];
  onGenerate: (id: string) => Promise<unknown>;
  busyId: string | null;
  onPark: (id: string, action: ParkAction) => Promise<unknown>;
  parkBusyId: string | null;
  onEdit: (id: string) => void;
}) {
  if (rows.length === 0) {
    return (
      <Card className="mb-2" testID="recurring-none-ready">
        <Text className="text-sm font-medium text-foreground" tx="recurring.none_due_title" />
        <Text className="mt-1 text-sm text-muted-foreground" tx="recurring.none_due_body" />
      </Card>
    );
  }
  return (
    <>
      <SectionHeader title={translate('recurring.due_title')} />
      {rows.map(row => (
        <TemplateRow
          key={row.id}
          row={row}
          testID="recurring-ready"
          generateBusy={busyId === row.id}
          parkBusy={parkBusyId === row.id}
          onEdit={() => onEdit(row.id)}
          onGenerate={() => {
            void onGenerate(row.id);
          }}
          onPark={(action) => {
            void onPark(row.id, action);
          }}
        />
      ))}
    </>
  );
}

function CatalogueSection({ all, pendingIds, onPark, parkBusyId, onEdit }: {
  all: Template[];
  pendingIds: Set<string>;
  onPark: (id: string, action: ParkAction) => Promise<unknown>;
  parkBusyId: string | null;
  onEdit: (id: string) => void;
}) {
  const rest = all.filter(t => !pendingIds.has(t.id));
  if (rest.length === 0)
    return null;
  return (
    <>
      <SectionHeader title={translate('recurring.all_title')} />
      {rest.map(row => (
        <TemplateRow
          key={row.id}
          row={row as unknown as Row}
          testID="recurring-all"
          parkBusy={parkBusyId === row.id}
          onEdit={() => onEdit(row.id)}
          onPark={(action) => {
            void onPark(row.id, action);
          }}
        />
      ))}
    </>
  );
}

function EmptyTemplates() {
  const router = useRouter();
  return (
    <EmptyState
      icon={Repeat}
      title={translate('recurring.empty_title')}
      description={translate('recurring.empty_body')}
      action={{ label: translate('recurring.form_create'), onPress: () => router.push('/recurring/new'), testID: 'recurring-empty-create' }}
      compact
    />
  );
}
