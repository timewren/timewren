import type { RouterOutputs } from '~/api/app-router';
import type { TxKeyPath } from '~/lib/i18n';
import { useRouter } from 'expo-router';
import { SearchX, X } from 'lucide-react-native';
import * as React from 'react';
import { View } from 'react-native';
import { Card, EmptyState, ErrorState, IconButton, Input, ListRow, ListSkeleton, Screen, SectionHeader, Text } from '~/components/ui';
import { href } from '~/features/more/links';
import { errorMessage, trpc } from '~/lib/api';
import { translate } from '~/lib/i18n';
import { useAnnounceLoaded } from '~/lib/notify';
import { hitHref } from './hit-href';

type Results = RouterOutputs['search']['global'];
type Group = keyof Results;

const GROUPS: { key: Group; labelKey: string }[] = [
  { key: 'clients', labelKey: 'clients' },
  { key: 'projects', labelKey: 'projects' },
  { key: 'tasks', labelKey: 'tasks' },
  { key: 'timeEntries', labelKey: 'time_entries' },
  { key: 'invoices', labelKey: 'invoices' },
  { key: 'prepaid', labelKey: 'prepaid' },
];

function useDebounced(value: string, ms: number): string {
  const [debounced, setDebounced] = React.useState(value);
  React.useEffect(() => {
    const id = setTimeout(setDebounced, ms, value);
    return () => clearTimeout(id);
  }, [value, ms]);
  return debounced;
}

/** Global søgning (modal): kunder, projekter, opgaver, registreringer, fakturaer, klippekort. */
export function SearchScreen() {
  const router = useRouter();
  const [text, setText] = React.useState('');
  const query = useDebounced(text.trim(), 300);
  const search = trpc.search.global.useQuery({ query, limit: 10 }, { enabled: query.length > 0, placeholderData: prev => prev });
  useAnnounceLoaded(search, translate('common.loaded'));

  const total = search.data ? GROUPS.reduce((sum, g) => sum + search.data![g.key].length, 0) : 0;

  return (
    <Screen
      title={translate('search.title')}
      right={<IconButton icon={X} label={translate('more.cancel')} onPress={() => router.back()} testID="search-close" />}
      header={(
        <Input
          value={text}
          onChangeText={setText}
          placeholder={translate('search.placeholder')}
          autoFocus
          autoCorrect={false}
          returnKeyType="search"
          clearButtonMode="while-editing"
          testID="search-input"
        />
      )}
    >
      {query.length === 0
        ? <Text className="mt-6 text-center text-sm text-muted-foreground">{translate('search.empty')}</Text>
        : search.isLoading
          ? <ListSkeleton rows={3} />
          : search.isError
            ? <ErrorState message={errorMessage(search.error)} onRetry={() => void search.refetch()} />
            : total === 0
              ? <EmptyState icon={SearchX} title={translate('search.no_results', { query })} compact />
              : GROUPS.map((g) => {
                  const hits = search.data?.[g.key] ?? [];
                  if (hits.length === 0)
                    return null;
                  return (
                    <View key={g.key}>
                      <SectionHeader title={translate(`search.${g.labelKey}` as TxKeyPath)} />
                      <Card className="p-0">
                        {hits.map((hit, i) => (
                          <ListRow
                            key={hit.id}
                            title={hit.title}
                            subtitle={hit.subtitle}
                            onPress={() => router.push(href(hitHref(hit)))}
                            last={i === hits.length - 1}
                            testID={`search-hit-${hit.type}-${hit.id}`}
                          />
                        ))}
                      </Card>
                    </View>
                  );
                })}
    </Screen>
  );
}
