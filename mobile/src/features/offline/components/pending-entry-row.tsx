import type { PendingEntry } from '../use-pending-entries';
import * as React from 'react';
import { View } from 'react-native';
import { Badge, ListRow, Text } from '~/components/ui';
import { formatHours } from '~/lib/format';
import { translate } from '~/lib/i18n';

type PendingEntryRowProps = { entry: PendingEntry; last?: boolean };

/** Ventende offline-post i dagslisten: ikke trykbar (intet server-id endnu). */
export function PendingEntryRow({ entry, last }: PendingEntryRowProps) {
  const right = (
    <View className="items-end gap-1">
      <Text className="text-base font-semibold text-foreground">{formatHours(entry.hours)}</Text>
      <Badge label={translate(entry.failed ? 'offline.badge_failed' : 'offline.badge_pending')} tone={entry.failed ? 'danger' : 'warning'} />
    </View>
  );
  return (
    <ListRow
      title={entry.description || translate('timer.default_description')}
      subtitle={translate(entry.failed ? 'offline.row_failed' : 'offline.row_pending')}
      right={right}
      chevron={false}
      last={last}
      className="opacity-80"
      testID={`pending-entry-${entry.id}`}
    />
  );
}
