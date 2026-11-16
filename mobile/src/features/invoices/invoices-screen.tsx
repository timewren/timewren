import type { BottomSheetModal } from '@gorhom/bottom-sheet';
import type { InvoiceListItem } from './components/invoice-row';
import type { InvoiceFilter } from './invoice-logic';
import { useRouter } from 'expo-router';
import { FileText, Plus } from 'lucide-react-native';
import * as React from 'react';
import { View } from 'react-native';
import {
  EmptyState,
  ErrorState,
  IconButton,
  List,
  ListSkeleton,
  Screen,
  Segmented,
  StatTile,
} from '~/components/ui';
import { useCapabilities } from '~/features/capabilities/use-capabilities';
import { trpc } from '~/lib/api';
import { formatMoney } from '~/lib/format';
import { translate } from '~/lib/i18n';
import { useAnnounceLoaded } from '~/lib/notify';
import { InvoiceRow } from './components/invoice-row';
import { FromTimeSheet } from './from-time-sheet';
import { INVOICE_FILTERS, listStats, matchesFilter } from './invoice-logic';

export function InvoicesScreen() {
  const caps = useCapabilities();
  const enabled = caps.isEnabled('invoicing');
  const router = useRouter();
  const [filter, setFilter] = React.useState<InvoiceFilter>('all');
  const sheetRef = React.useRef<BottomSheetModal | null>(null);

  const list = trpc.invoices.list.useQuery(undefined, { enabled });
  const stats = trpc.invoices.getStats.useQuery(undefined, { enabled });

  const filterOptions = React.useMemo(
    () => INVOICE_FILTERS.map(f => ({ value: f, label: translate(`invoices.filter.${f}`) })),
    [],
  );
  const visible = React.useMemo(
    () => (list.data ?? []).filter(i => matchesFilter(i, filter)),
    [list.data, filter],
  );
  const extra = React.useMemo(() => listStats(list.data ?? []), [list.data]);

  const refresh = React.useCallback(() => {
    void list.refetch();
    void stats.refetch();
  }, [list, stats]);

  const renderItem = React.useCallback(
    ({ item }: { item: InvoiceListItem }) => (
      <InvoiceRow invoice={item} onPress={() => router.push(`/invoices/${item.id}`)} />
    ),
    [router],
  );

  if (!enabled) {
    return (
      <Screen title={translate('invoices.title')} back>
        <EmptyState icon={FileText} title={translate('invoices.module_off_title')} description={translate('invoices.module_off_body')} />
      </Screen>
    );
  }

  return (
    <Screen
      title={translate('invoices.title')}
      back
      scroll={false}
      right={<IconButton icon={Plus} label={translate('invoices.from_time.title')} variant="primary" onPress={() => sheetRef.current?.present()} testID="invoices-add" />}
      header={<Segmented options={filterOptions} value={filter} onChange={setFilter} testID="invoices-filter" />}
    >
      <List
        accessibilityRole="list"
        data={visible}
        keyExtractor={item => item.id}
        renderItem={renderItem}
        refreshing={list.isRefetching}
        onRefresh={refresh}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 32 }}
        ListHeaderComponent={(
          <View className="mb-4 flex-row gap-3">
            <StatTile label={translate('invoices.stats.outstanding')} value={formatMoney(stats.data?.totalPending ?? 0)} loading={stats.isLoading} error={stats.isError} tone="primary" />
            <StatTile label={translate('invoices.stats.overdue')} value={formatMoney(extra.overdueAmount)} loading={list.isLoading} error={list.isError} tone={extra.overdueAmount > 0 ? 'danger' : 'default'} />
            <StatTile label={translate('invoices.stats.paid_month')} value={formatMoney(extra.paidThisMonth)} loading={list.isLoading} error={list.isError} tone="success" />
          </View>
        )}
        ListEmptyComponent={(
          <InvoicesEmpty
            isLoading={list.isLoading}
            isError={list.isError}
            onRetry={refresh}
            onCreate={() => sheetRef.current?.present()}
          />
        )}
      />
      <FromTimeSheet
        ref={sheetRef}
        onCreated={id => router.push(`/invoices/${id}`)}
        onManual={() => router.push('/invoices/new')}
      />
    </Screen>
  );
}

type EmptyProps = { isLoading: boolean; isError: boolean; onRetry: () => void; onCreate: () => void };

function InvoicesEmpty({ isLoading, isError, onRetry, onCreate }: EmptyProps) {
  useAnnounceLoaded({ isLoading, isError }, translate('common.loaded'));
  if (isLoading)
    return <ListSkeleton rows={4} />;
  if (isError)
    return <ErrorState onRetry={onRetry} />;
  return (
    <EmptyState
      icon={FileText}
      title={translate('invoices.empty_title')}
      description={translate('invoices.empty_body')}
      action={{ label: translate('invoices.from_time.title'), onPress: onCreate, testID: 'invoices-empty-create' }}
      compact
    />
  );
}
