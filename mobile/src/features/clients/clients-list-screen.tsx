import type { ClientSort } from './client-logic';
import type { RouterOutputs } from '~/api/app-router';
import { useRouter } from 'expo-router';
import { Plus, Search, Users } from 'lucide-react-native';
import * as React from 'react';
import { TextInput, View } from 'react-native';
import { useUniwind } from 'uniwind';
import {
  Card,
  colors,
  EmptyState,
  ErrorState,
  IconButton,
  List,
  ListSkeleton,
  Screen,
  Segmented,
} from '~/components/ui';
import { useCapabilities } from '~/features/capabilities/use-capabilities';
import { trpc } from '~/lib/api';
import { translate } from '~/lib/i18n';
import { useAnnounceLoaded } from '~/lib/notify';
import { filterClients } from './client-logic';
import { ClientRow } from './components/client-row';
import { clientHref } from './hrefs';

type Client = RouterOutputs['clients']['listWithStats'][number];
type Segment = 'active' | 'archived';

export function ClientsListScreen() {
  const router = useRouter();
  const caps = useCapabilities();
  const [query, setQuery] = React.useState('');
  const [segment, setSegment] = React.useState<Segment>('active');
  const [sort, setSort] = React.useState<ClientSort>('name');
  const enabled = caps.isEnabled('clients');

  const list = trpc.clients.listWithStats.useQuery({ includeArchived: true }, { enabled });
  const data = React.useMemo(
    () => filterClients(list.data ?? [], { query, archived: segment === 'archived', sort }),
    [list.data, query, segment, sort],
  );

  const goNew = React.useCallback(() => router.push('/clients/new'), [router]);

  if (!enabled) {
    return (
      <Screen title={translate('clients.title')}>
        <EmptyState icon={Users} title={translate('clients.module_disabled_title')} description={translate('clients.module_disabled_body')} />
      </Screen>
    );
  }

  return (
    <Screen
      title={translate('clients.title')}
      scroll={false}
      right={<IconButton icon={Plus} label={translate('clients.create')} onPress={goNew} testID="clients-new" />}
      header={(
        <View className="gap-2">
          <SearchField value={query} onChange={setQuery} />
          <Segmented<Segment>
            options={[
              { value: 'active', label: translate('clients.active') },
              { value: 'archived', label: translate('clients.archived') },
            ]}
            value={segment}
            onChange={setSegment}
            testID="clients-segment"
          />
          <Segmented<ClientSort>
            options={[
              { value: 'name', label: translate('clients.sort_name') },
              { value: 'hours', label: translate('clients.sort_hours') },
              { value: 'activity', label: translate('clients.sort_activity') },
            ]}
            value={sort}
            onChange={setSort}
            testID="clients-sort"
          />
        </View>
      )}
    >
      <ClientsBody
        state={{ isLoading: list.isLoading, isError: list.isError, isRefetching: list.isRefetching, query, segment }}
        data={data}
        onRefresh={() => void list.refetch()}
        onNew={goNew}
        onOpen={id => router.push(clientHref(id))}
      />
    </Screen>
  );
}

type BodyState = { isLoading: boolean; isError: boolean; isRefetching: boolean; query: string; segment: Segment };
type BodyProps = {
  state: BodyState;
  data: Client[];
  onRefresh: () => void;
  onNew: () => void;
  onOpen: (id: string) => void;
};

function ClientsBody({ state, data, onRefresh, onNew, onOpen }: BodyProps) {
  useAnnounceLoaded(state, translate('common.loaded'));
  if (state.isLoading)
    return <View className="px-4"><ListSkeleton rows={5} /></View>;
  if (state.isError)
    return <ErrorState onRetry={onRefresh} />;
  if (data.length === 0)
    return <ClientsEmpty query={state.query} segment={state.segment} onNew={onNew} />;
  return (
    <List
      accessibilityRole="list"
      data={data}
      keyExtractor={item => item.id}
      contentContainerClassName="px-4 pb-8"
      refreshing={state.isRefetching}
      onRefresh={onRefresh}
      renderItem={({ item }) => (
        <Card className="mb-2 p-0">
          <ClientRow client={item} onPress={() => onOpen(item.id)} last />
        </Card>
      )}
    />
  );
}

function ClientsEmpty({ query, segment, onNew }: { query: string; segment: Segment; onNew: () => void }) {
  if (query.trim())
    return <EmptyState icon={Search} title={translate('clients.empty_search_title')} compact />;
  if (segment === 'archived')
    return <EmptyState icon={Users} title={translate('clients.empty_archived_title')} compact />;
  return (
    <EmptyState
      icon={Users}
      title={translate('clients.empty_title')}
      description={translate('clients.empty_body')}
      action={{ label: translate('clients.create'), onPress: onNew, testID: 'clients-empty-new' }}
    />
  );
}

function SearchField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { theme } = useUniwind();
  const dark = theme === 'dark';
  return (
    <View className="flex-row items-center gap-2 rounded-xl bg-muted px-3">
      <Search size={18} color={dark ? colors.neutral[400] : colors.neutral[500]} />
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={translate('clients.search_placeholder')}
        placeholderTextColor={colors.neutral[400]}
        className="flex-1 py-2.5 text-base text-foreground"
        autoCorrect={false}
        clearButtonMode="while-editing"
        returnKeyType="search"
        testID="clients-search"
      />
    </View>
  );
}
