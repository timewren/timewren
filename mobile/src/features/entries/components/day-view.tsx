import type { TimeEntry } from '../use-entries';
import type { PendingEntry } from '~/features/offline/use-pending-entries';
import { CalendarDays } from 'lucide-react-native';
import * as React from 'react';
import { View } from 'react-native';
import { Card, EmptyState, ListSkeleton, StatTile } from '~/components/ui';
import { PendingEntryRow } from '~/features/offline/components/pending-entry-row';
import { formatHours } from '~/lib/format';
import { translate } from '~/lib/i18n';
import { sumHours } from '../period';
import { EntryRow } from './entry-row';

type DayViewProps = {
  entries: TimeEntry[];
  /**
   * Ventende offline-oprettelser for dagen (vises nederst med badge). De kan
   * ikke vælges: de findes ikke på serveren endnu, så en bulk-handling på dem
   * ville enten fejle eller slå ind på en post brugeren ikke mente.
   */
  pending?: PendingEntry[];
  isLoading: boolean;
  onPressEntry: (entry: TimeEntry) => void;
  onLongPressEntry: (entry: TimeEntry, getTrigger: () => View | null) => void;
  onRegister: () => void;
  /** Udvalgstilstand: `undefined` er normal visning, elfter de valgte id'er. */
  selectedIds?: ReadonlySet<string>;
};

/** Dagsvisning: total øverst, derefter dagens poster. */
export function DayView({ entries, pending = [], isLoading, onPressEntry, onLongPressEntry, onRegister, selectedIds }: DayViewProps) {
  if (isLoading)
    return <ListSkeleton rows={4} />;

  const total = sumHours(entries) + sumHours(pending);
  const count = entries.length + pending.length;
  return (
    <View className="gap-4">
      <View className="flex-row gap-3">
        <StatTile label={translate('entries.total')} value={formatHours(total)} tone="primary" testID="day-total" />
        <StatTile label={translate('entries.count_label')} value={String(count)} />
      </View>
      {count === 0
        ? (
            <EmptyState
              icon={CalendarDays}
              title={translate('entries.empty_title')}
              description={translate('entries.empty_body')}
              action={{ label: translate('entries.register'), onPress: onRegister, testID: 'day-empty-register' }}
              compact
            />
          )
        : (
            <Card className="p-0">
              {entries.map((entry, i) => (
                <EntryRow
                  key={entry.id}
                  entry={entry}
                  pendingSync={'pendingSync' in entry ? true : undefined}
                  onPress={() => onPressEntry(entry)}
                  // I udvalgstilstand er et langt tryk samme som et tryk: begge
                  // markerer. Handlingsarket ville redigere/slette netop de
                  // poster, der er samlet til behandling.
                  onLongPress={selectedIds ? () => onPressEntry(entry) : getTrigger => onLongPressEntry(entry, getTrigger)}
                  selected={selectedIds ? selectedIds.has(entry.id) : undefined}
                  last={i === entries.length - 1 && pending.length === 0}
                />
              ))}
              {pending.map((entry, i) => (
                <PendingEntryRow key={entry.id} entry={entry} last={i === pending.length - 1} />
              ))}
            </Card>
          )}
    </View>
  );
}
