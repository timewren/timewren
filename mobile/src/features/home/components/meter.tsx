import type { StatTone } from '~/components/ui';
import * as React from 'react';
import { View } from 'react-native';
import { twMerge } from 'tailwind-merge';

const FILL: Record<StatTone, string> = {
  default: 'bg-neutral-500',
  primary: 'bg-primary-600',
  success: 'bg-success-500',
  warning: 'bg-warning-500',
  danger: 'bg-danger-500',
  violet: 'bg-violet-500',
};

type MeterProps = {
  /** 0–1 */
  fraction: number;
  tone?: StatTone;
  className?: string;
  /** Hvad bjælken måler — uden den siger skærmlæseren kun "progress bar" */
  a11yLabel?: string;
};

/** Tynd, tonet saldo-/fremdriftsbjælke (statisk — ingen animation nødvendig). */
export function Meter({ fraction, tone = 'primary', className = '', a11yLabel }: MeterProps) {
  const pct = Math.round(Math.min(1, Math.max(0, Number.isFinite(fraction) ? fraction : 0)) * 100);
  return (
    <View
      className={twMerge('h-2 overflow-hidden rounded-full bg-muted', className)}
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 100, now: pct }}
      accessibilityLabel={a11yLabel}
    >
      <View className={twMerge('h-full rounded-full', FILL[tone])} style={{ width: `${pct}%` }} />
    </View>
  );
}
