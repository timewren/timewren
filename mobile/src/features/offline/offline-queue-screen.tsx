import type { QueueItem } from './queue-logic';
import { CloudOff } from 'lucide-react-native';
import * as React from 'react';
import { View } from 'react-native';
import { Badge, Button, Card, EmptyState, ListRow, Screen, SectionHeader, Text } from '~/components/ui';
import { useCapabilities } from '~/features/capabilities/use-capabilities';
import { formatHours, formatTime } from '~/lib/format';
import { translate } from '~/lib/i18n';
import { pendingCount } from './queue-logic';
import { useOfflineQueue } from './queue-store';
import { useOfflineSync } from './use-offline-sync';

function itemTitle(item: QueueItem): string {
  switch (item.type) {
    case 'time.create':
      return `${item.payload.description} · ${formatHours(item.payload.hours)}`;
    case 'time.update':
      return translate('offline.item_update', { description: item.payload.data.description ?? '' });
    case 'time.toggleBillable':
      return translate(item.payload.isBillable ? 'offline.item_billable_on' : 'offline.item_billable_off');
    case 'time.delete':
      return translate('offline.item_delete');
    case 'timer.start':
      return translate('offline.item_timer_start', { description: item.payload.description || translate('timer.default_description') });
  }
}

function itemSubtitle(item: QueueItem): string {
  const date = item.type === 'time.create'
    ? item.payload.date
    : item.type === 'time.update'
      ? (item.payload.data.date ?? '')
      : item.type === 'timer.start' && item.payload.startTime
        ? formatTime(item.payload.startTime)
        : '';
  if (item.failed)
    return item.lastError ? `${translate('offline.failed_label')}: ${item.lastError}` : translate('offline.failed_label');
  return [date, translate('offline.attempts', { count: item.attempts })].filter(Boolean).join(' · ');
}

function QueueRow({ item, last, held }: { item: QueueItem; last: boolean; held: boolean }) {
  const retry = useOfflineQueue.use.retry();
  const remove = useOfflineQueue.use.remove();
  return (
    <View className={last ? '' : 'border-b border-border'}>
      <ListRow
        title={itemTitle(item)}
        subtitle={itemSubtitle(item)}
        right={<Badge label={translate(held ? 'offline.other_org' : item.failed ? 'offline.badge_failed' : 'offline.badge_pending')} tone={held ? 'default' : item.failed ? 'danger' : 'warning'} />}
        chevron={false}
        last
        testID={`offline-item-${item.id}`}
      />
      <View className="flex-row gap-2 px-4 pb-3">
        {item.failed && !held
          ? <Button size="sm" variant="outline" label={translate('offline.retry')} onPress={() => retry(item.id)} testID={`offline-retry-${item.id}`} />
          : null}
        <Button size="sm" variant="ghost" label={translate('offline.discard')} textClassName="text-danger-600 no-underline" onPress={() => remove(item.id)} testID={`offline-discard-${item.id}`} />
      </View>
    </View>
  );
}

/** Kø-oversigt under Indstillinger: ventende og fejlede ændringer med "Prøv igen"/"Kassér". */
export function OfflineQueueScreen() {
  const items = useOfflineQueue.use.items();
  const isOnline = useOfflineQueue.use.isOnline();
  const isSyncing = useOfflineQueue.use.isSyncing();
  const retryAll = useOfflineQueue.use.retryAll();
  const { sync } = useOfflineSync();
  const caps = useCapabilities();
  const activeOrgId = caps.isLoading ? undefined : caps.orgId;
  const pending = pendingCount(items);
  // Elementer fra en anden org må ikke drænes, men de må heller ikke forsvinde
  // fra oversigten — brugeren skal kunne se at de stadig er der.
  const isHeld = (item: QueueItem) => activeOrgId !== undefined && item.orgId !== undefined && item.orgId !== activeOrgId;
  const held = items.filter(isHeld).length;

  const syncNow = () => {
    retryAll();
    void sync();
  };

  return (
    <Screen title={translate('offline.title')} back>
      <Text className="mb-3 text-sm text-muted-foreground">
        {isOnline ? translate('offline.status_online', { count: pending }) : translate('offline.status_offline')}
      </Text>
      {held > 0
        ? (
            <View className="mb-3 rounded-xl bg-muted p-3">
              <Text className="text-sm font-medium text-foreground">{translate('offline.other_org')}</Text>
              <Text className="mt-1 text-sm text-muted-foreground">{translate('offline.other_org_body')}</Text>
            </View>
          )
        : null}
      {items.length === 0
        ? <EmptyState icon={CloudOff} title={translate('offline.empty_title')} description={translate('offline.empty_body')} compact />
        : (
            <View>
              <Button
                label={translate('offline.sync_now')}
                onPress={syncNow}
                loading={isSyncing}
                disabled={!isOnline || pending === 0 || held === items.length}
                testID="offline-sync-now"
              />
              <SectionHeader title={translate('offline.queue_heading', { count: items.length })} />
              <Card className="p-0">
                {items.map((item, i) => <QueueRow key={item.id} item={item} held={isHeld(item)} last={i === items.length - 1} />)}
              </Card>
            </View>
          )}
    </Screen>
  );
}
