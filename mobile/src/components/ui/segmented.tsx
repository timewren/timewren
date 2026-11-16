import * as React from 'react';
import { Pressable, View } from 'react-native';
import { twMerge } from 'tailwind-merge';
import { Text } from './text';

export type SegmentOption<T extends string> = { value: T; label: string; badge?: number };

type SegmentedProps<T extends string> = {
  options: SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
  testID?: string;
};

/** Segment-kontrol (Dag/Uge/Måned, Overblik/Anmod/Godkend). */
export function Segmented<T extends string>({ options, value, onChange, className = '', testID }: SegmentedProps<T>) {
  return (
    <View className={twMerge('flex-row rounded-lg bg-muted p-0.5', className)} testID={testID}>
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <Pressable
            key={opt.value}
            onPress={() => onChange(opt.value)}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            accessibilityLabel={opt.badge ? `${opt.label} (${opt.badge})` : opt.label}
            className={twMerge(
              'flex-1 flex-row items-center justify-center gap-1 rounded-md py-1.5',
              active ? 'bg-card shadow-sm dark:bg-[#2a2a2a]' : '',
            )}
            testID={testID ? `${testID}-${opt.value}` : undefined}
          >
            <Text className={twMerge('text-[13px] font-medium', active ? 'text-foreground' : 'text-muted-foreground')}>
              {opt.label}
            </Text>
            {opt.badge
              ? (
                  <View className="min-w-5 items-center rounded-full bg-primary-600 px-1.5">
                    <Text className="text-xs font-semibold text-white">{opt.badge}</Text>
                  </View>
                )
              : null}
          </Pressable>
        );
      })}
    </View>
  );
}
