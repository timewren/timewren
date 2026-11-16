import type { StatTone } from './stat-tile';
import * as React from 'react';
import { View } from 'react-native';
import { twMerge } from 'tailwind-merge';
import { Text } from './text';

const BG: Record<StatTone, string> = {
  default: 'bg-muted',
  primary: 'bg-primary-100 dark:bg-primary-900/30',
  success: 'bg-success-100 dark:bg-success-900/30',
  warning: 'bg-warning-100 dark:bg-warning-900/30',
  danger: 'bg-danger-100 dark:bg-danger-900/30',
  violet: 'bg-violet-100 dark:bg-violet-700/30',
};

const FG: Record<StatTone, string> = {
  default: 'text-muted-foreground',
  primary: 'text-primary-700 dark:text-primary-400',
  success: 'text-success-700 dark:text-success-400',
  warning: 'text-warning-700 dark:text-warning-400',
  danger: 'text-danger-700 dark:text-danger-400',
  violet: 'text-violet-700 dark:text-violet-300',
};

type BadgeProps = {
  label: string;
  tone?: StatTone;
  className?: string;
};

/** Lille status-chip: "Godkendt", "Afventer", "Udløber snart". */
export function Badge({ label, tone = 'default', className = '' }: BadgeProps) {
  return (
    <View className={twMerge('self-start rounded-full px-2 py-0.5', BG[tone], className)}>
      <Text className={twMerge('text-xs font-medium', FG[tone])}>{label}</Text>
    </View>
  );
}
