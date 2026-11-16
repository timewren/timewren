import { ChevronLeft, ChevronRight } from 'lucide-react-native';
import * as React from 'react';
import { Pressable, View } from 'react-native';
import { IconButton, Text } from '~/components/ui';
import { translate } from '~/lib/i18n';
import { formatWeekRange, isoWeekNumber } from '../week';

type WeekNavProps = {
  weekStart: string;
  onPrev: () => void;
  onNext: () => void;
  onThisWeek: () => void;
  isThisWeek: boolean;
  testID?: string;
};

/** Forrige / "Uge 37 · 7.–13. sep." / næste. Tryk på midten = denne uge. */
export function WeekNav({ weekStart, onPrev, onNext, onThisWeek, isThisWeek, testID = 'week-nav' }: WeekNavProps) {
  return (
    <View className="flex-row items-center justify-between">
      <IconButton icon={ChevronLeft} onPress={onPrev} label={translate('common.previous_week')} testID={`${testID}-prev`} />
      <Pressable onPress={onThisWeek} hitSlop={8} accessibilityRole="button" className="items-center" testID={`${testID}-title`}>
        <Text className="text-base font-semibold text-foreground">
          {translate('enterprise.common.week', { week: isoWeekNumber(weekStart) })}
        </Text>
        <Text className="text-xs text-muted-foreground">
          {isThisWeek ? translate('enterprise.common.this_week') : formatWeekRange(weekStart)}
        </Text>
      </Pressable>
      <IconButton icon={ChevronRight} onPress={onNext} label={translate('common.next_week')} testID={`${testID}-next`} />
    </View>
  );
}
