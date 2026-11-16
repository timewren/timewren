import type { UseTimer } from '../use-timer';
import type { PickerSelection } from './project-picker-modal';
import * as Haptics from 'expo-haptics';
import { ChevronRight, Play, Square, Trash2 } from 'lucide-react-native';
import * as React from 'react';
import { Alert, Pressable, TextInput, View } from 'react-native';
import { useUniwind } from 'uniwind';
import { Button, Card, colors, Text, useModal } from '~/components/ui';
import { formatDuration } from '~/lib/format';
import { translate } from '~/lib/i18n';
import { selectionNames } from '../timer-logic';
import { useTimerTicker } from '../use-timer-ticker';
import { FavoritesRow } from './favorites-row';
import { ProjectPickerModal } from './project-picker-modal';

/**
 * Fremhævet timer-kort: stor tæller, valgt kunde/projekt, redigérbar
 * beskrivelse og Start/Stop. Uden valgt projekt åbner Start vælgeren.
 * `controller` kommer fra ét `useTimer()` i skærmen, så reconcile kun kører én gang.
 */
export function TimerCard({ controller }: { controller: UseTimer }) {
  const { isRunning, timer, isBusy, start, stop, discard, updateDescription, switchTo } = controller;
  const picker = useModal();
  const { theme } = useUniwind();
  const dark = theme === 'dark';
  const muted = dark ? colors.neutral[400] : colors.neutral[500];

  const hasSelection = timer.projectId !== null || timer.clientId !== null;
  const selectionLabel = selectionNames(timer)
    || (hasSelection ? translate('timer.client_only') : (isRunning ? translate('timer.internal') : translate('timer.pick_client')));

  const onPicked = React.useCallback((sel: PickerSelection) => {
    if (isRunning) {
      void switchTo(sel);
      return;
    }
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    void start({ ...sel, description: timer.description });
  }, [isRunning, start, switchTo, timer.description]);

  const onStart = () => {
    if (!hasSelection) {
      picker.present();
      return;
    }
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    void start({ ...timer });
  };

  const onStop = async () => {
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    await stop();
  };

  const onDiscard = () => {
    Alert.alert(translate('timer.discard_title'), translate('timer.discard_body'), [
      { text: translate('timer.cancel'), style: 'cancel' },
      { text: translate('timer.discard'), style: 'destructive', onPress: () => void discard() },
    ]);
  };

  return (
    <Card className={isRunning ? 'border border-primary-300 bg-primary-50 dark:border-primary-800 dark:bg-primary-900' : ''} testID="timer-card">
      <View className="flex-row items-center gap-2">
        <View className={`size-2.5 rounded-full ${isRunning ? 'bg-success-500' : 'bg-neutral-300 dark:bg-neutral-600'}`} />
        <Text className="text-xs font-medium tracking-wide text-muted-foreground">
          {translate(isRunning ? 'timer.running' : 'timer.idle')}
        </Text>
      </View>

      <ElapsedText startTime={timer.startTime} baseSeconds={timer.baseSeconds} running={isRunning} />

      <Pressable
        onPress={() => picker.present()}
        className="mt-3 flex-row items-center justify-between rounded-xl bg-background/60 px-3 py-2.5 active:opacity-70 dark:bg-card/60"
        accessibilityRole="button"
        testID="timer-selection"
      >
        <Text className="flex-1 text-base font-medium text-foreground" numberOfLines={1}>{selectionLabel}</Text>
        <ChevronRight size={18} color={muted} />
      </Pressable>

      <FavoritesRow controller={controller} disabled={isRunning || isBusy} />

      <TextInput
        value={timer.description}
        onChangeText={updateDescription}
        onEndEditing={() => isRunning && void switchTo({ description: timer.description })}
        placeholder={translate('timer.description_placeholder')}
        placeholderTextColor={muted}
        className="mt-2 rounded-xl bg-background/60 px-3 py-2.5 text-base text-foreground dark:bg-card/60"
        returnKeyType="done"
        testID="timer-description"
      />

      <TimerActions isRunning={isRunning} isBusy={isBusy} onStart={onStart} onStop={onStop} onDiscard={onDiscard} muted={muted} />

      <ProjectPickerModal ref={picker.ref} onSelect={onPicked} />
    </Card>
  );
}

/**
 * Kun tælleren tikker hvert sekund — resten af kortet og Hjem-skærmen gen-renderes ikke.
 */
function ElapsedText({ startTime, baseSeconds, running }: { startTime: string | null; baseSeconds: number; running: boolean }) {
  const elapsed = useTimerTicker(startTime, baseSeconds);
  return (
    <Text
      className={running ? 'mt-2 text-5xl font-bold tracking-tight text-foreground' : 'mt-2 text-3xl font-semibold tracking-tight text-muted-foreground'}
      style={{ fontVariant: ['tabular-nums'] }}
      testID="timer-elapsed"
    >
      {formatDuration(elapsed)}
    </Text>
  );
}

type ActionsProps = {
  isRunning: boolean;
  isBusy: boolean;
  onStart: () => void;
  onStop: () => void;
  onDiscard: () => void;
  muted: string;
};

function TimerActions({ isRunning, isBusy, onStart, onStop, onDiscard, muted }: ActionsProps) {
  return (
    <View className="mt-3 flex-row items-center gap-2">
      {isRunning
        ? (
            <>
              <Button
                label={translate('timer.stop')}
                onPress={onStop}
                loading={isBusy}
                className="my-0 h-12 flex-1 bg-danger-600 dark:bg-danger-600"
                textClassName="text-white dark:text-white"
                testID="timer-stop"
              >
                <Square size={18} color={colors.white} fill={colors.white} />
                <Text className="ml-2 text-base font-semibold text-white">{translate('timer.stop')}</Text>
              </Button>
              <Pressable
                onPress={onDiscard}
                disabled={isBusy}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={translate('timer.discard')}
                className="size-12 items-center justify-center rounded-md active:bg-muted"
                testID="timer-discard"
              >
                <Trash2 size={20} color={muted} />
              </Pressable>
            </>
          )
        : (
            <Button
              label={translate('timer.start')}
              onPress={onStart}
              loading={isBusy}
              className="my-0 h-12 flex-1"
              testID="timer-start"
            >
              <Play size={18} color={colors.white} fill={colors.white} />
              <Text className="ml-2 text-base font-semibold text-white">{translate('timer.start')}</Text>
            </Button>
          )}
    </View>
  );
}
