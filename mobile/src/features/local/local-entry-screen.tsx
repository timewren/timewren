import type { LocalSelection } from './local-logic';
import { format } from 'date-fns';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as React from 'react';
import { Alert, Pressable, View } from 'react-native';
import { Button, Input, Screen, Text } from '~/components/ui';
import { DateField } from '~/features/entries/components/date-field';
import { formatHoursClock } from '~/lib/format';
import { translate } from '~/lib/i18n';
import { formatWords } from '~/lib/locale';
import { showMessage } from '~/lib/notify';
import { SelectionFields } from './components/selection-fields';
import { addMinutesToClock, entrySeconds, formatClock, manualRange, normalizeClock, suggestRange } from './local-logic';
import { localStore, useLocalStore } from './local-store';

const QUICK_MINUTES = [15, 30, 60, 120, 240];

function quickLabel(minutes: number): string {
  return minutes < 60 ? `${minutes} min` : `${minutes / 60} ${formatWords().hourUnit}`;
}

/**
 * Tilføj eller redigér en lokal registrering. Bygget til at taste tidligere dage hurtigt:
 * fra/til foreslås ud fra dagens seneste post, varighedsknapper sætter "til",
 * og "Gem og tilføj næste" fortsætter hvor posten sluttede.
 */
export function LocalEntryScreen() {
  const params = useLocalSearchParams<{ id?: string; date?: string }>();
  const router = useRouter();
  const entries = useLocalStore.use.entries();
  const existing = entries.find(e => e.id === params.id);
  const draft = useLocalStore.use.draft();

  const [selection, setSelection] = React.useState<LocalSelection>(() => existing
    ? { description: existing.description, projectId: existing.projectId, clientId: existing.clientId, tagIds: existing.tagIds }
    : { ...draft, description: '' });
  const [date, setDate] = React.useState(() => (existing ? format(new Date(existing.startedAt), 'yyyy-MM-dd') : params.date ?? format(new Date(), 'yyyy-MM-dd')));
  const initial = React.useMemo(() => (existing
    ? { from: formatClock(existing.startedAt), to: formatClock(existing.endedAt) }
    : suggestRange(localStore().entries, date, new Date())), [existing?.id]); // eslint-disable-line react/exhaustive-deps
  const [from, setFrom] = React.useState(initial.from);
  const [to, setTo] = React.useState(initial.to);
  const [timesTouched, setTimesTouched] = React.useState(false);

  const range = from && to ? manualRange(date, from, to) : null;
  const error = range && 'error' in range ? translate(`local.entry.${range.error}`) : undefined;
  const valid = range !== null && !('error' in range);

  const changeDate = (next: string) => {
    setDate(next);
    // Ny post: følg den valgte dag, så længe brugeren ikke selv har rettet tiderne.
    if (!existing && !timesTouched) {
      const s = suggestRange(entries, next, new Date());
      setFrom(s.from);
      setTo(s.to);
    }
  };

  const persist = () => {
    if (!range || 'error' in range)
      return false;
    const payload = { ...selection, description: selection.description.trim(), ...range };
    if (existing)
      localStore().updateEntry(existing.id, payload);
    else
      localStore().addEntry(payload);
    return true;
  };

  const save = () => {
    if (persist())
      router.back();
  };

  const saveAndNext = () => {
    if (!persist())
      return;
    const nextFrom = normalizeClock(to);
    setFrom(nextFrom);
    setTo(addMinutesToClock(nextFrom, 60) ?? '');
    setSelection(s => ({ ...s, description: '' }));
    showMessage({ message: translate('local.saved'), type: 'success', duration: 1200 });
  };

  const remove = () => existing && confirmDelete(existing.id, () => router.back());

  const setQuick = (minutes: number) => {
    const next = addMinutesToClock(from, minutes);
    if (next) {
      setTo(next);
      setTimesTouched(true);
    }
  };

  return (
    <Screen back title={translate(existing ? 'local.entry.edit_title' : 'local.entry.new_title')}>
      <DateField label={translate('entries.form.date')} value={date} onChange={changeDate} testID="local-entry-date" />
      <TimeFields
        from={from}
        to={to}
        onFrom={(v) => {
          setFrom(v);
          setTimesTouched(true);
        }}
        onTo={(v) => {
          setTo(v);
          setTimesTouched(true);
        }}
        onQuick={setQuick}
        error={error}
        seconds={valid ? entrySeconds(range) : null}
      />
      <Input
        label={translate('local.description')}
        value={selection.description}
        onChangeText={description => setSelection(s => ({ ...s, description }))}
        testID="local-entry-description"
      />
      <SelectionFields value={selection} onChange={setSelection} testID="local-entry" />
      <Button label={translate('common.save')} onPress={save} disabled={!valid} testID="local-entry-save" />
      {existing
        ? <Button variant="ghost" label={translate('common.delete')} onPress={remove} testID="local-entry-delete" />
        : <Button variant="outline" label={translate('local.entry.save_next')} onPress={saveAndNext} disabled={!valid} testID="local-entry-save-next" />}
    </Screen>
  );
}

function confirmDelete(id: string, onDone: () => void) {
  Alert.alert(translate('local.delete_entry_title'), translate('local.delete_entry_body'), [
    { text: translate('common.cancel'), style: 'cancel' },
    {
      text: translate('common.delete'),
      style: 'destructive',
      onPress: () => {
        localStore().deleteEntry(id);
        onDone();
      },
    },
  ]);
}

type TimeFieldsProps = {
  from: string;
  to: string;
  onFrom: (v: string) => void;
  onTo: (v: string) => void;
  onQuick: (minutes: number) => void;
  error?: string;
  seconds: number | null;
};

/** Fra/til (normaliseres til HH:mm ved blur), varighedsknapper og beregnet varighed. */
function TimeFields({ from, to, onFrom, onTo, onQuick, error, seconds }: TimeFieldsProps) {
  return (
    <View>
      <View className="flex-row gap-3">
        <View className="flex-1">
          <Input
            label={translate('local.entry.from')}
            value={from}
            onChangeText={onFrom}
            onBlur={() => onFrom(normalizeClock(from))}
            placeholder="08:00"
            keyboardType="numbers-and-punctuation"
            selectTextOnFocus
            testID="local-entry-from"
          />
        </View>
        <View className="flex-1">
          <Input
            label={translate('local.entry.to')}
            value={to}
            onChangeText={onTo}
            onBlur={() => onTo(normalizeClock(to))}
            placeholder="16:00"
            keyboardType="numbers-and-punctuation"
            selectTextOnFocus
            testID="local-entry-to"
          />
        </View>
      </View>
      <QuickDurations onPick={onQuick} />
      {error ? <Text className="mb-3 text-sm text-danger-600">{error}</Text> : null}
      {seconds !== null ? <Text className="mb-3 text-sm text-muted-foreground" testID="local-entry-duration">{`${translate('local.entry.duration')}: ${formatHoursClock(seconds / 3600)}`}</Text> : null}
    </View>
  );
}

function QuickDurations({ onPick }: { onPick: (minutes: number) => void }) {
  return (
    <View className="mb-4 flex-row flex-wrap gap-2">
      {QUICK_MINUTES.map(m => (
        <Pressable
          key={m}
          onPress={() => onPick(m)}
          accessibilityRole="button"
          accessibilityLabel={`${translate('local.entry.duration')} ${quickLabel(m)}`}
          className="min-h-11 justify-center rounded-full bg-muted px-3 py-1.5 active:opacity-70"
          testID={`local-quick-${m}`}
        >
          <Text className="text-sm font-medium text-foreground">{`+${quickLabel(m)}`}</Text>
        </Pressable>
      ))}
    </View>
  );
}
