import type { ParkAction, Row } from '../recurring-logic';
import { Pencil } from 'lucide-react-native';
import * as React from 'react';
import { View } from 'react-native';
import { Badge, Button, Card, IconButton, Text } from '~/components/ui';
import { formatDateShort, formatHours } from '~/lib/format';
import { translate } from '~/lib/i18n';
import { BLOCK_TEXT, clientLabel, frequency, generateBlock, isParked, parkAction } from '../recurring-logic';

type Props = {
  row: Row;
  /** Uden den vises rækken som katalog, ikke som noget der kan registreres. */
  onGenerate?: () => void;
  onPark?: (action: ParkAction) => void;
  /** Åbn formularen. Uden den er rækken uden redigéringsvej. */
  onEdit?: () => void;
  generateBusy?: boolean;
  parkBusy?: boolean;
  testID?: string;
};

/**
 * Én handling pr. række — og kun den, der passer til den tilstand den er i.
 *
 * Der er tre statusser, og de er ikke hinandens modsætninger: `resume` rydder
 * `isPaused`, `toggleActive` sætter `isActive`, og ingen af dem rører den
 * anden. `parkAction` regner den ud, så en række der er både pauset og slået
 * fra får den knap, der faktisk flytter den videre.
 */
/**
 * Etiketten er den handling, knappen gør. `hint` er kun med, når handlingen
 * har en **skjul** følge brugeren ikke kan se: `resume` regner `nextDue` fra i
 * dag (routeren:879), så pausen lægges ikke ind bagefter. `toggleActive`
 * rører kun `isActive` (routeren:809) og gør præcis det, knappen siger, så den
 * får ingen advarsel.
 */
const PARK_TEXT: Record<ParkAction, { label: 'recurring.pause_action' | 'recurring.resume_action' | 'recurring.activate_action'; hint: 'recurring.pause_hint' | 'recurring.resume_hint' | null }> = {
  pause: { label: 'recurring.pause_action', hint: 'recurring.pause_hint' },
  resume: { label: 'recurring.resume_action', hint: 'recurring.resume_hint' },
  activate: { label: 'recurring.activate_action', hint: null },
};

/**
 * Den ene handling: pause, genoptag eller slå til.
 *
 * Egen komponent, så `onPark` er påkrævet her — i rækkens egen JSX er den
 * valgfri, fordi den række uden handling skal kunne læses som ét stop. Uden
 * opdelingen måtte typskolen tage `park` på trods af at den er bredere end det
 * `parket` felt, eller vi skulle hævde det samme to gange.
 */
function ParkButton({ action, busy, onPress, testID }: {
  action: ParkAction;
  busy: boolean;
  onPress: (action: ParkAction) => void;
  testID: string;
}) {
  const { label, hint } = PARK_TEXT[action];
  return (
    <>
      <Button
        className="mt-3"
        variant="outline"
        size="sm"
        label={translate(label)}
        loading={busy}
        onPress={() => onPress(action)}
        testID={`${testID}-park`}
      />
      {hint ? <Text className="mt-2 text-[13px] text-muted-foreground" tx={hint} /> : null}
    </>
  );
}

/**
 * Én skabelon, læst som ét stop.
 *
 * `nextDue` er et **tidspunkt**, men det bruges som en dag: serverens
 * `calculateNextDue` går ud fra `new Date(startDate)` (UTC-midnat) og cron'en
 * går ud fra klokkeslættet den kørte. Derfor vises datoen og ikke «for X siden»
 * — samme regel som `client-activity.tsx` (review-fund F3a).
 */
export function TemplateRow({ row, onGenerate, onPark, onEdit, generateBusy = false, parkBusy = false, testID = 'recurring-row' }: Props) {
  const block = generateBlock(row);
  const parked = isParked(row);
  const park = onPark ? parkAction(row) : null;
  const client = clientLabel(row);
  const freq = frequency(row);
  // En række med en knap må **ikke** grupperes: så bliver knappen ulæselig for
  // skærmlæseren, fordi den ligger under ét label (samme som `ListRow`, der
  // også kun grupperer, når højre side er en tekst).
  const canGenerate = !!onGenerate && !block && !parked;
  const canPress = canGenerate || !!park;
  const label = [
    row.name,
    client,
    formatHours(row.hours),
    translate(freq.key, freq.vars),
    parked ? translate(parked === 'paused' ? 'recurring.paused' : 'recurring.inactive') : null,
  ]
    .filter(part => part !== null)
    .join(', ');

  const body = (
    <>
      <View className="flex-row items-start justify-between gap-2">
        <Text className="flex-1 text-[15px] font-medium text-foreground" numberOfLines={2}>{row.name}</Text>
        <Text className="text-[15px] font-semibold text-foreground" style={{ fontVariant: ['tabular-nums'] }}>{formatHours(row.hours)}</Text>
      </View>
      {onEdit
        ? (
            <View className="-mt-1 mb-1 self-end">
              <IconButton icon={Pencil} label={translate('recurring.edit_action')} onPress={onEdit} size={18} testID={`${testID}-edit`} />
            </View>
          )
        : null}
      <Text className="mt-0.5 text-[13px] text-muted-foreground" numberOfLines={2}>
        {[client, translate(freq.key, freq.vars)].filter(part => part !== null).join(' · ')}
      </Text>
      {row.frequency && row.nextDue
        ? (
            <Text className="mt-0.5 text-[13px] text-muted-foreground">
              {`${translate('recurring.next')}: ${formatDateShort(row.nextDue)}`}
            </Text>
          )
        : null}
      {parked ? <Badge className="mt-2" label={translate(parked === 'paused' ? 'recurring.paused' : 'recurring.inactive')} tone="warning" /> : null}
      {block && onGenerate
        ? <Text className="mt-2 text-[13px] text-muted-foreground" tx={BLOCK_TEXT[block]} />
        : null}
      {/* `park` kan være null for en pauset engangsskabelon — serveren ville
          kaster ved både pause og resume, så den siger hvor den løses. */}
      {row.isPaused && !park && onPark
        ? <Text className="mt-2 text-[13px] text-muted-foreground" tx="recurring.pause_web_only" />
        : null}
      {park && onPark
        ? <ParkButton action={park} busy={parkBusy} onPress={onPark} testID={testID} />
        : null}
      {canGenerate
        ? (
            <Button
              className="mt-3"
              size="sm"
              label={translate('recurring.generate')}
              loading={generateBusy}
              onPress={onGenerate}
              testID={`${testID}-generate`}
            />
          )
        : null}
    </>
  );

  return (
    <Card className="mb-2" testID={testID}>
      {canPress ? body : <View accessible accessibilityLabel={label}>{body}</View>}
    </Card>
  );
}
