import { useRouter } from 'expo-router';
import { Users } from 'lucide-react-native';
import * as React from 'react';
import { Pressable, View } from 'react-native';
import { Card, EmptyState, SectionHeader, Text } from '~/components/ui';
import { href } from '~/features/more/links';
import { trpc } from '~/lib/api';
import { formatHours } from '~/lib/format';
import { translate } from '~/lib/i18n';
import { SectionState } from './section-state';

/** Top 5 kunder efter timer som bar-liste med procent. Skjules når listen er tom. */
export function TopClients() {
  const router = useRouter();
  const query = trpc.clients.getTopClients.useQuery({ limit: 5, sortBy: 'hours' });
  const total = React.useMemo(
    () => (query.data ?? []).reduce((sum, c) => sum + c.totalHours, 0),
    [query.data],
  );

  if (query.isSuccess && (query.data ?? []).length === 0)
    return null;

  return (
    <View>
      <SectionHeader
        title={translate('overview.top_clients')}
        action={{ label: translate('tabs.clients'), onPress: () => router.push(href('/clients')) }}
      />
      <SectionState isLoading={query.isLoading} isError={query.isError} error={query.error} onRetry={() => void query.refetch()} tiles={1}>
        <Card className="gap-3">
          {(query.data ?? []).length === 0
            ? <EmptyState icon={Users} title={translate('overview.top_clients_empty')} compact />
            : (query.data ?? []).map((client) => {
                const share = total > 0 ? client.totalHours / total : 0;
                return (
                  <BarRow
                    key={client.id}
                    label={client.name}
                    value={formatHours(client.totalHours)}
                    share={share}
                    onPress={() => router.push(href(`/clients/${client.id}`))}
                  />
                );
              })}
        </Card>
      </SectionState>
    </View>
  );
}

type BarRowProps = { label: string; value: string; share: number; onPress?: () => void };

export function BarRow({ label, value, share, onPress }: BarRowProps) {
  const pct = Math.round(share * 100);
  const body = (
    <>
      <View className="flex-row items-center justify-between">
        <Text className="flex-1 text-sm text-foreground" numberOfLines={1}>{label}</Text>
        <Text className="text-sm font-medium text-foreground">{value}</Text>
        <Text className="ml-2 w-10 text-right text-xs text-muted-foreground">{`${pct} %`}</Text>
      </View>
      <View className="mt-1 h-2 overflow-hidden rounded-full bg-muted">
        <View className="h-2 rounded-full bg-primary-600 dark:bg-primary-400" style={{ width: `${Math.max(2, pct)}%` }} />
      </View>
    </>
  );
  if (!onPress)
    return <View>{body}</View>;
  return (
    <Pressable onPress={onPress} accessibilityRole="button" className="active:opacity-70">
      {body}
    </Pressable>
  );
}
