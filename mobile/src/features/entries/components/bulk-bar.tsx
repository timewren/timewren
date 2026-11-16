import type { BilledState } from '../bulk-select';
import * as React from 'react';
import { View } from 'react-native';
import { Button, Text } from '~/components/ui';
import { translate } from '~/lib/i18n';
import { marksBilled } from '../bulk-select';

type BulkBarProps = {
  count: number;
  billedState: BilledState;
  busy: boolean;
  onMarkBilled: () => void;
  onDelete: () => void;
  onCancel: () => void;
};

/**
 * Bundlinjen i udvalgstilstand: antal valgt, de to handlinger der gælder for
 * hele mængden, og en måde ud.
 *
 * Knappens etiket følger `billedState`: på en blandet mængde siger den
 * "Marker som faktureret", fordi det er dét trykket gør — ikke "Fjern
 * markering", der ville være en løgn om de poster der ikke er fakturerede.
 * Uden valgte poster er knapperne deaktiverede frem for skjulte, så
 * placeringen ikke hopper, mens brugeren markerer.
 */
export function BulkBar({ count, billedState, busy, onMarkBilled, onDelete, onCancel }: BulkBarProps) {
  const has = count > 0;
  return (
    <View className="absolute inset-x-0 bottom-0 gap-2 border-t border-border bg-card px-4 pt-2 pb-6">
      <View className="flex-row items-center gap-3">
        <Text className="flex-1 text-sm text-muted-foreground" testID="bulk-count">
          {has ? translate(count === 1 ? 'entries.bulk_count_one' : 'entries.bulk_count_other', { count }) : translate('entries.bulk_empty')}
        </Text>
        <Button variant="ghost" onPress={onCancel} testID="bulk-cancel" label={translate('entries.actions.cancel')} />
      </View>
      <View className="flex-row gap-2">
        <Button
          className="flex-1"
          disabled={!has || busy}
          onPress={onMarkBilled}
          testID="bulk-billed"
          label={translate(marksBilled(billedState) ? 'entries.actions.mark_billed' : 'entries.actions.unmark_billed')}
        />
        <Button
          className="flex-1"
          variant="destructive"
          disabled={!has || busy}
          onPress={onDelete}
          testID="bulk-delete"
          label={translate('entries.actions.delete')}
        />
      </View>
    </View>
  );
}
