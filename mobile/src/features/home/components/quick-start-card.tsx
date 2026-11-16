import type { StartOptions } from '~/features/timer/use-timer';
import * as Haptics from 'expo-haptics';
import { Play } from 'lucide-react-native';
import * as React from 'react';
import { Button, Card, colors, Text } from '~/components/ui';
import { translate } from '~/lib/i18n';
import { isQuickStartable, quickStartLabel } from '../quick-start';
import { useRecentTasks } from '../use-recent-tasks';

/**
 * Ét tryk fra Hjem: starter timeren på den senest brugte kunde/projekt.
 * Skjules når der ikke er noget at starte på — så står timerkortets egen
 * Start (med vælger) tilbage, og brugeren ikke sendes ud i en tom registrering.
 */
type Props = {
  onStart: (opts: StartOptions) => void;
  disabled: boolean;
};

export function QuickStartCard({ onStart, disabled }: Props) {
  const { quickStart } = useRecentTasks();

  const onPress = React.useCallback(() => {
    if (!quickStart)
      return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onStart(quickStart);
  }, [onStart, quickStart]);

  if (!isQuickStartable(quickStart))
    return null;

  const label = quickStartLabel(quickStart, translate('timer.default_description'));

  return (
    <Card className="p-4" testID="quick-start">
      <Text className="text-xs font-medium tracking-wide text-muted-foreground">
        {translate('home.quick_start_title')}
      </Text>
      <Text className="mt-1 text-lg font-semibold text-foreground" numberOfLines={1}>
        {label}
      </Text>
      <Button
        onPress={onPress}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={`${translate('timer.start')}: ${label}`}
        className="mt-3 h-12"
        testID="quick-start-button"
      >
        <Play size={18} color={colors.white} fill={colors.white} />
        <Text className="ml-2 text-base font-semibold text-white">{translate('timer.start')}</Text>
      </Button>
    </Card>
  );
}
