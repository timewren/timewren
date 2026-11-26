import type { PressableProps, ViewProps } from 'react-native';
import * as React from 'react';
import { Pressable, View } from 'react-native';
import { twMerge } from 'tailwind-merge';
import { Text } from './text';

type CardProps = ViewProps & {
  className?: string;
  /** Gør kortet trykbart */
  onPress?: PressableProps['onPress'];
  /**
   * Samlet label for skærmlæseren. Uden den læses indholdet barn for barn,
   * hvilket er rigtigt for et kort med lister — men et trykbart kort skal have
   * én label, ellers læses hver sin linje.
   */
  a11yLabel?: string;
  testID?: string;
};

/** Flad flade på `bg-card` med 1 px kant (Linear-guiden). Brug til alle grupperede indholdsblokke. */
export function Card({ className = '', onPress, a11yLabel, children, testID, ...rest }: CardProps) {
  const cls = twMerge('rounded-xl border border-border bg-card p-4', className);
  if (onPress) {
    const a11y = a11yLabel ? { accessible: true, accessibilityLabel: a11yLabel } : {};
    const inner = a11yLabel
      ? <View importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>{children}</View>
      : children;
    return (
      <Pressable
        onPress={onPress}
        className={twMerge(cls, 'active:opacity-80')}
        accessibilityRole="button"
        testID={testID}
        {...a11y}
      >
        {inner}
      </Pressable>
    );
  }
  return (
    <View className={cls} testID={testID} {...rest}>
      {children}
    </View>
  );
}

type SectionHeaderProps = {
  title: string;
  /** Lille handling til højre, fx "Se alle" */
  action?: { label: string; onPress: () => void; testID?: string };
  className?: string;
};

export function SectionHeader({ title, action, className = '' }: SectionHeaderProps) {
  return (
    <View className={twMerge('mt-6 mb-2 flex-row items-end justify-between', className)}>
      <Text className="text-xs font-semibold tracking-wide text-muted-foreground uppercase" accessibilityRole="header">{title}</Text>
      {action
        ? (
            <Pressable onPress={action.onPress} hitSlop={12} accessibilityRole="button" testID={action.testID}>
              <Text className="text-sm font-medium text-primary-600 dark:text-primary-400">{action.label}</Text>
            </Pressable>
          )
        : null}
    </View>
  );
}
