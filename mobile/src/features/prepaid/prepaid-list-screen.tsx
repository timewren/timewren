import type { PrepaidSegment } from './prepaid-logic';
import type { RouterOutputs } from '~/api/app-router';
import { useRouter } from 'expo-router';
import { Plus, Ticket } from 'lucide-react-native';
import * as React from 'react';
import { View } from 'react-native';
import { EmptyState, ErrorState, IconButton, List, ListSkeleton, Screen, Segmented } from '~/components/ui';
import { useCapabilities } from '~/features/capabilities/use-capabilities';
import { prepaidHref, prepaidNewHref } from '~/features/clients/hrefs';
import { trpc } from '~/lib/api';
import { translate } from '~/lib/i18n';
import { useAnnounceLoaded } from '~/lib/notify';
import { PrepaidCard } from './components/prepaid-card';
import { prepaidSegment, sortByBalance } from './prepaid-logic';

type Pkg = RouterOutputs['prepaid']['list'][number];

export function PrepaidListScreen() {
  const router = useRouter();
  const caps = useCapabilities();
  const enabled = caps.isEnabled('klippekort');
  const [segment, setSegment] = React.useState<PrepaidSegment>('active');
  const list = trpc.prepaid.list.useQuery({ includeArchived: true }, { enabled });
  // Segmenterne er klient-side filtre af ét kald, så skærmen taler én gang.
  useAnnounceLoaded(list, translate('common.loaded'));

  const counts = React.useMemo(() => {
    const c: Record<PrepaidSegment, number> = { active: 0, expired: 0, archived: 0 };
    for (const pkg of list.data ?? [])
      c[prepaidSegment(pkg)] += 1;
    return c;
  }, [list.data]);
  const data = React.useMemo(
    () => sortByBalance((list.data ?? []).filter(pkg => prepaidSegment(pkg) === segment)),
    [list.data, segment],
  );
  const goNew = React.useCallback(() => router.push(prepaidNewHref()), [router]);

  if (!enabled) {
    return (
      <Screen back title={translate('prepaid.title')}>
        <EmptyState icon={Ticket} title={translate('prepaid.module_disabled_title')} description={translate('prepaid.module_disabled_body')} />
      </Screen>
    );
  }

  return (
    <Screen
      back
      title={translate('prepaid.title')}
      scroll={false}
      right={<IconButton icon={Plus} label={translate('prepaid.create')} onPress={goNew} variant="primary" testID="prepaid-new" />}
      header={(
        <Segmented<PrepaidSegment>
          options={[
            { value: 'active', label: translate('prepaid.active'), badge: counts.active },
            { value: 'expired', label: translate('prepaid.expired'), badge: counts.expired },
            { value: 'archived', label: translate('prepaid.archived') },
          ]}
          value={segment}
          onChange={setSegment}
          testID="prepaid-segment"
        />
      )}
    >
      <PrepaidBody
        state={{ isLoading: list.isLoading, isError: list.isError, isRefetching: list.isRefetching, segment }}
        data={data}
        onRefresh={() => void list.refetch()}
        onNew={goNew}
        onOpen={id => router.push(prepaidHref(id))}
      />
    </Screen>
  );
}

type BodyProps = {
  state: { isLoading: boolean; isError: boolean; isRefetching: boolean; segment: PrepaidSegment };
  data: Pkg[];
  onRefresh: () => void;
  onNew: () => void;
  onOpen: (id: string) => void;
};

function PrepaidBody({ state, data, onRefresh, onNew, onOpen }: BodyProps) {
  if (state.isLoading)
    return <View className="px-4"><ListSkeleton rows={4} /></View>;
  if (state.isError)
    return <ErrorState onRetry={onRefresh} />;
  if (data.length === 0) {
    if (state.segment !== 'active')
      return <EmptyState icon={Ticket} title={translate('prepaid.empty_segment')} compact />;
    return (
      <EmptyState
        icon={Ticket}
        title={translate('prepaid.empty_title')}
        description={translate('prepaid.empty_body')}
        action={{ label: translate('prepaid.create'), onPress: onNew, testID: 'prepaid-empty-new' }}
      />
    );
  }
  return (
    <List
      accessibilityRole="list"
      data={data}
      keyExtractor={item => item.id}
      contentContainerClassName="px-4 pb-8"
      refreshing={state.isRefetching}
      onRefresh={onRefresh}
      renderItem={({ item }) => (
        <View className="mb-2">
          <PrepaidCard pkg={item} onPress={() => onOpen(item.id)} />
        </View>
      )}
    />
  );
}
