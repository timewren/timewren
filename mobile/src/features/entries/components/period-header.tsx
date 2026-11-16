import { ChevronLeft, ChevronRight } from 'lucide-react-native';
import * as React from 'react';
import { Pressable, View } from 'react-native';
import { IconButton, Text } from '~/components/ui';
import { translate } from '~/lib/i18n';

type PeriodHeaderProps = {
  title: string;
  /** Skjul "I dag"-genvejen når perioden allerede indeholder i dag */
  showToday: boolean;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
};

/** Pil-navigation mellem perioder + titel (tryk = i dag). */
export function PeriodHeader({ title, showToday, onPrev, onNext, onToday }: PeriodHeaderProps) {
  return (
    <View className="flex-row items-center justify-between">
      <IconButton icon={ChevronLeft} onPress={onPrev} label={translate('entries.prev')} testID="period-prev" />
      <Pressable onPress={onToday} className="flex-1 items-center" accessibilityRole="button" hitSlop={8}>
        <Text className="text-base font-semibold text-foreground" numberOfLines={1}>{title}</Text>
        {showToday
          ? <Text className="text-xs font-medium text-primary-600 dark:text-primary-400">{translate('entries.today')}</Text>
          : null}
      </Pressable>
      <IconButton icon={ChevronRight} onPress={onNext} label={translate('entries.next')} testID="period-next" />
    </View>
  );
}
