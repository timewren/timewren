import type { LocalSelection } from '../local-logic';
import * as Haptics from 'expo-haptics';
import { Play, Square, Trash2 } from 'lucide-react-native';
import * as React from 'react';
import { Alert, Pressable, TextInput, View } from 'react-native';
import { useUniwind } from 'uniwind';
import { Button, Card, colors, Text } from '~/components/ui';
import { useTimerTicker } from '~/features/timer/use-timer-ticker';
import { formatDuration } from '~/lib/format';
import { translate } from '~/lib/i18n';
import { showMessage } from '~/lib/notify';
import { localStore, useLocalStore } from '../local-store';
import { SelectionFields } from './selection-fields';

/** Start/stop-timer uden konto. Tiden udledes af starttidspunktet, så den tæller videre når appen er lukket. */
export function LocalTimerCard() {
  const timer = useLocalStore.use.timer();
  const draft = useLocalStore.use.draft();
  const { theme } = useUniwind();
  const muted = theme === 'dark' ? colors.neutral[400] : colors.neutral[500];
  const running = timer !== null;
  const selection: LocalSelection = timer ?? draft;

  const change = (next: LocalSelection) => (running ? localStore().updateTimer(next) : localStore().setDraft(next));

  const start = () => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    localStore().startTimer();
  };
  const stop = () => {
    const entry = localStore().stopTimer();
    if (entry) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      showMessage({ message: `${translate('local.saved')} · ${formatDuration((Date.parse(entry.endedAt) - Date.parse(entry.startedAt)) / 1000)}`, type: 'success' });
    }
    else {
      showMessage({ message: translate('local.discarded_short'), type: 'info' });
    }
  };
  const discard = () => {
    Alert.alert(translate('timer.discard_title'), translate('timer.discard_body'), [
      { text: translate('timer.cancel'), style: 'cancel' },
      { text: translate('timer.discard'), style: 'destructive', onPress: () => localStore().discardTimer() },
    ]);
  };

  return (
    <Card className={running ? 'border border-primary-300 bg-primary-50 dark:border-primary-800 dark:bg-primary-900' : ''} testID="local-timer-card">
      <LocalElapsed startedAt={timer?.startedAt ?? null} />
      <TextInput
        value={selection.description}
        onChangeText={description => change({ ...selection, description })}
        placeholder={translate('local.description')}
        placeholderTextColor={muted}
        className="mt-3 mb-4 rounded-xl bg-background/60 px-3 py-3 text-base text-foreground dark:bg-card/60"
        returnKeyType="done"
        testID="local-timer-description"
      />
      <SelectionFields value={selection} onChange={change} testID="local-timer" />
      <View className="flex-row items-center gap-2">
        {running
          ? (
              <>
                <Button label={translate('timer.stop')} onPress={stop} className="my-0 h-14 flex-1 bg-danger-600 dark:bg-danger-600" testID="local-timer-stop">
                  <Square size={18} color={colors.white} fill={colors.white} />
                  <Text className="ml-2 text-lg font-semibold text-white">{translate('timer.stop')}</Text>
                </Button>
                <Pressable
                  onPress={discard}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel={translate('timer.discard')}
                  className="size-14 items-center justify-center rounded-md active:bg-muted"
                  testID="local-timer-discard"
                >
                  <Trash2 size={20} color={muted} />
                </Pressable>
              </>
            )
          : (
              <Button label={translate('timer.start')} onPress={start} className="my-0 h-14 flex-1" testID="local-timer-start">
                <Play size={18} color={colors.white} fill={colors.white} />
                <Text className="ml-2 text-lg font-semibold text-white">{translate('timer.start')}</Text>
              </Button>
            )}
      </View>
    </Card>
  );
}

/** Kun tælleren tikker — vælgere og knapper i kortet gen-renderes ikke hvert sekund. */
function LocalElapsed({ startedAt }: { startedAt: string | null }) {
  const elapsed = useTimerTicker(startedAt, 0);
  return (
    <Text
      className={startedAt ? 'text-5xl font-bold tracking-tight text-foreground' : 'text-3xl font-semibold tracking-tight text-muted-foreground'}
      style={{ fontVariant: ['tabular-nums'] }}
      testID="local-timer-elapsed"
    >
      {formatDuration(startedAt ? elapsed : 0)}
    </Text>
  );
}
