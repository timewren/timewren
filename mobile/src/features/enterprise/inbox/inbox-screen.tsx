import type { InboxItem } from './use-inbox';
import { useRouter } from 'expo-router';
import { BellOff } from 'lucide-react-native';
import * as React from 'react';
import { Pressable, View } from 'react-native';
import { Button } from '~/components/ui/button';
import { Card } from '~/components/ui/card';
import { EmptyState, ErrorState } from '~/components/ui/empty-state';
import { Screen } from '~/components/ui/screen';
import { Segmented } from '~/components/ui/segmented';
import { ListSkeleton } from '~/components/ui/skeleton';
import { Text } from '~/components/ui/text';
import { EnterpriseGate } from '~/features/enterprise/absence/components/enterprise-gate';
import { errorMessage } from '~/lib/api';
import { formatAgo } from '~/lib/format';
import { translate } from '~/lib/i18n';
import { showMessage, useAnnounceLoaded } from '~/lib/notify';
import { inboxRouteFor } from './inbox-logic';
import { useInbox, useInboxUnreadCount, useMarkInboxRead } from './use-inbox';

type Filter = 'all' | 'unread';

function InboxRow({ item, onPress, last }: { item: InboxItem; onPress: () => void; last: boolean }) {
  const unread = !item.readAt;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      className={`flex-row gap-3 px-4 py-3 active:bg-muted ${last ? '' : 'border-b border-border'}`}
      testID={`inbox-${item.id}`}
    >
      <View className="w-3 items-center pt-2">
        {unread ? <View className="size-2 rounded-full bg-primary-600" /> : null}
      </View>
      <View className="flex-1">
        <Text className={unread ? 'text-base font-semibold text-foreground' : 'text-base text-foreground'} numberOfLines={2}>{item.title}</Text>
        <Text className="text-sm text-muted-foreground" numberOfLines={3}>{item.body}</Text>
        <Text className="mt-1 text-xs text-muted-foreground">{formatAgo(item.createdAt)}</Text>
      </View>
    </Pressable>
  );
}

function InboxBody() {
  const router = useRouter();
  const [filter, setFilter] = React.useState<Filter>('all');
  const [refreshing, setRefreshing] = React.useState(false);
  const inbox = useInbox(filter === 'unread');
  useAnnounceLoaded(inbox, translate('common.loaded'));
  const unread = useInboxUnreadCount();
  const markRead = useMarkInboxRead();

  const open = React.useCallback((item: InboxItem) => {
    if (!item.readAt)
      markRead.mutate({ id: item.id }, { onError: e => showMessage({ message: errorMessage(e), type: 'danger' }) });
    const route = inboxRouteFor(item.url);
    if (route)
      router.push(route as never);
  }, [markRead, router]);

  const onRefresh = React.useCallback(async () => {
    setRefreshing(true);
    await inbox.refetch();
    setRefreshing(false);
  }, [inbox]);

  const items = inbox.data ?? [];
  const options: { value: Filter; label: string; badge?: number }[] = [
    { value: 'all', label: translate('enterprise.inbox.all') },
    { value: 'unread', label: translate('enterprise.inbox.unread'), badge: unread },
  ];

  return (
    <Screen
      title={translate('enterprise.inbox.title')}
      back
      header={<Segmented options={options} value={filter} onChange={setFilter} testID="inbox-filter" />}
      refreshing={refreshing}
      onRefresh={() => void onRefresh()}
    >
      {unread > 0
        ? (
            <Button
              variant="ghost"
              label={translate('enterprise.inbox.mark_all_read')}
              loading={markRead.isPending}
              onPress={() => markRead.mutate({})}
              className="my-0 mb-2"
              testID="mark-all-read"
            />
          )
        : null}
      {inbox.isLoading
        ? <ListSkeleton />
        : inbox.isError
          ? <ErrorState message={errorMessage(inbox.error)} onRetry={() => void inbox.refetch()} />
          : items.length === 0
            ? (
                <EmptyState
                  icon={BellOff}
                  title={translate(filter === 'unread' ? 'enterprise.inbox.empty_unread' : 'enterprise.inbox.empty')}
                  description={translate('enterprise.inbox.empty_body')}
                />
              )
            : (
                <Card className="p-0">
                  {items.map((item, i) => (
                    <InboxRow key={item.id} item={item} onPress={() => open(item)} last={i === items.length - 1} />
                  ))}
                </Card>
              )}
    </Screen>
  );
}

export function InboxScreen() {
  return (
    <EnterpriseGate title={translate('enterprise.inbox.title')} back>
      <InboxBody />
    </EnterpriseGate>
  );
}
