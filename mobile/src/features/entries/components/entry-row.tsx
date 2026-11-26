import type { TimeEntry } from '../use-entries';
import * as React from 'react';
import { View } from 'react-native';
import { twMerge } from 'tailwind-merge';
import { Badge, ListRow, Text } from '~/components/ui';
import { formatHours } from '~/lib/format';
import { translate } from '~/lib/i18n';
import { entryContextLabel, entryTitle } from '../labels';

type EntryRowProps = {
  entry: TimeEntry;
  onPress: () => void;
  onLongPress: (getTrigger: () => View | null) => void;
  last?: boolean;
  /** Rækken har en rettelse i offline-køen — vis den nye værdi + "venter". */
  pendingSync?: boolean;
  /**
   * Udvalgstilstand. `undefined` (ikke sat) er normal visning; `true`/`false`
   * markerer rækken og fortæller skærmlæseren, at trykket markerer frem for at
   * åbne. Derfor er tilstanden `undefined` og ikke bare `false`: en række der
   * ikke er valgt i udvalgstilstand skal stadig sige det.
   */
  selected?: boolean;
};

/** Én tidspost i dagslisten: beskrivelse, projekt/kunde, timer og status-chips. */
export function EntryRow({ entry, onPress, onLongPress, last, pendingSync, selected }: EntryRowProps) {
  const rowRef = React.useRef<View>(null);
  const nonBillable = entry.isBillable === false;
  const right = (
    <View className="items-end gap-1">
      <Text className="text-base font-semibold text-foreground">{formatHours(entry.hours)}</Text>
      {pendingSync
        ? <Badge label={translate('offline.badge_pending')} tone="warning" />
        : entry.isBilled
          ? <Badge label={translate('entries.billed_badge')} tone="success" />
          : entry.isPrepaid
            ? <Badge label={translate('entries.prepaid_badge')} tone="violet" />
            : nonBillable
              ? <Badge label={translate('entries.non_billable')} tone="warning" />
              : null}
    </View>
  );
  return (
    <ListRow
      title={entryTitle(entry)}
      subtitle={entryContextLabel(entry)}
      right={right}
      chevron={false}
      onPress={onPress}
      pressRef={rowRef}
      onLongPress={() => onLongPress(() => rowRef.current)}
      actionLabel={selected === undefined ? translate('entries.actions.title') : undefined}
      last={last}
      // Samme markering som en kørende timer (`timer-card`): brand-blå i lys
      // modus, dæmpet i mørk — ikke en ny farve kun til denne skærm.
      className={twMerge(selected ? 'bg-primary-50 dark:bg-primary-900' : '')}
      a11yState={selected === undefined ? undefined : { selected }}
      testID={`entry-${entry.id}`}
    />
  );
}
