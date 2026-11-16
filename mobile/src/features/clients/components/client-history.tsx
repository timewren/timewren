import type { LucideIcon } from 'lucide-react-native';
import type { HistoryChange, HistoryEntry, HistoryLog } from '../client-history-logic';
import { Archive, ArchiveRestore, History, Pencil, Plus, Trash2 } from 'lucide-react-native';
import * as React from 'react';
import { View } from 'react-native';
import { Card, colors, EmptyState, ErrorState, ListRow, Skeleton, Text } from '~/components/ui';
import { translate } from '~/lib/i18n';
import { HISTORY_LIMIT, isEmptyHistory, isTruncated, toHistory } from '../client-history-logic';

type Props = {
  logs: readonly HistoryLog[] | undefined;
  isLoading: boolean;
  /**
   * Fejlen skal have sin egen tilstand. Uden den rammer et kald, der svarer
   * 500, `logs`-tjekket, og historikken sagde «Ingen registreringer endnu» —
   * en påstand om kunden der er lige så forkert som nullerne i `ClientStats`.
   */
  isError: boolean;
  /** Allerede omsat af `errorMessage(error)` — denne komponent kender ikke API'et. */
  errorMessage?: string;
  onRetry: () => void;
  /** Samme grænse som blev bedt om; bruges til at sige når listen er klippet. */
  limit?: number;
};

/** Ikon per handling — de samme fem serveren skriver for en kunde. */
const ACTION_ICONS: Record<string, LucideIcon> = {
  archive: Archive,
  create: Plus,
  delete: Trash2,
  restore: ArchiveRestore,
  update: Pencil,
};

function ActionIcon({ entry }: { entry: HistoryEntry }) {
  const Icon = ACTION_ICONS[entry.action] ?? History;
  return <Icon size={16} color={colors.neutral[500]} />;
}

/** Én ændringslinje: «Timepris fra 850 kr. til 950 kr.». */
function ChangeLine({ change }: { change: HistoryChange }) {
  const fra = translate('clients.history_field_from');
  const til = translate('clients.history_field_to');
  return (
    // Ét stop pr. ændring. Uden egen label læser skærmlæseren de fem
    // tekster hver for sig, og «fra» og «til» bliver to løse ord.
    <View
      accessible
      accessibilityLabel={`${change.label} ${fra} ${change.before} ${til} ${change.after}`}
      className="flex-row flex-wrap items-baseline gap-x-1.5"
    >
      <Text className="text-[13px] font-medium text-foreground">{change.label}</Text>
      <Text className="text-[13px] text-muted-foreground">{fra}</Text>
      <Text className="text-[13px] text-muted-foreground line-through">{change.before}</Text>
      <Text className="text-[13px] text-muted-foreground">{til}</Text>
      <Text className="text-[13px] font-medium text-foreground">{change.after}</Text>
    </View>
  );
}

/**
 * Undertitlen på rækken: hvem og hvornår. Uden navnet står der kun «I dag
 * 14:32», som er sandt, men ikke siger hvem der var ved det.
 */
function subtitleOf(entry: HistoryEntry): string {
  return entry.who ? `${translate('clients.history_who')} ${entry.who} · ${entry.when}` : entry.when;
}

/**
 * Én hændelse: rækken med handling, tid og hvem, og under den de felter der
 * blev ændret.
 *
 * Rækken er bevidst ikke trykbar: der er ingen handling bag den, og en række
 * der ligner en knap uden at være en er værre for skærmlæseren end en statisk.
 * Derfor ligger ændringerne synligt under frem for i et ark der skal åbnes.
 */
function HistoryItem({ entry, last }: { entry: HistoryEntry; last: boolean }) {
  return (
    <View className={last ? undefined : 'border-b border-border'}>
      <ListRow
        title={translate(entry.actionKey)}
        subtitle={subtitleOf(entry)}
        left={<ActionIcon entry={entry} />}
        last
        testID={`client-history-${entry.id}`}
      />
      {entry.changes.length > 0
        ? (
            <View className="gap-1 px-4 pb-3 pl-11">
              {/* `detectChanges` går `Object.entries(fieldLabels)` igennem, så
                  hvert feltnavn står højst én gang pr. række. */}
              {entry.changes.map(change => <ChangeLine key={change.field} change={change} />)}
            </View>
          )
        : null}
    </View>
  );
}

/**
 * Kundehistorikken (feature-kø F5): hvem der har rørt kunden, hvad de
 * ændrede, og hvornår — fra `activity.list`, som serveren har skrevet siden
 * `clients.create/update/archive/restore/delete`. Web har samme procedure, men
 * bruger den ingen steder, så historikken har aldrig været synlig for nogen.
 *
 * R5's regel gælder her som overalt: et kald der fejler må ikke male et nul.
 * Derfor har historikken sin egen `ErrorState`, og tom-tilstanden ligger
 * bagefter den — ellers sagde et 500 «Ingen registreringer endnu».
 */
export function ClientHistory({ logs, isLoading, isError, errorMessage, onRetry, limit = HISTORY_LIMIT }: Props) {
  const entries = React.useMemo(() => toHistory(logs ?? []), [logs]);

  if (isLoading) {
    return (
      <Card className="p-0">
        <View className="gap-3 p-4">
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-4 w-2/5" />
        </View>
      </Card>
    );
  }

  if (isError)
    return <Card><ErrorState message={errorMessage} onRetry={onRetry} /></Card>;

  if (isEmptyHistory(entries))
    return <Card><EmptyState title={translate('clients.history_empty')} description={translate('clients.history_empty_body')} compact /></Card>;

  return (
    <Card className="p-0">
      {entries.map((entry, index) => (
        <HistoryItem key={entry.id} entry={entry} last={index === entries.length - 1} />
      ))}
      {isTruncated(logs?.length ?? 0, limit)
        ? (
            <Text className="border-t border-border px-4 py-3 text-[13px] text-muted-foreground" testID="client-history-truncated">
              {translate('clients.history_truncated', { antal: limit })}
            </Text>
          )
        : null}
    </Card>
  );
}
