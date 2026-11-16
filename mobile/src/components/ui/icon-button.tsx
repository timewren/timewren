import type { LucideIcon } from 'lucide-react-native';
import * as React from 'react';
import { Pressable } from 'react-native';
import { twMerge } from 'tailwind-merge';
import { useUniwind } from 'uniwind';
import colors from './colors';

type IconButtonProps = {
  icon: LucideIcon;
  onPress: () => void;
  label: string;
  size?: number;
  /** 'ghost' (default) eller 'primary' (udfyldt cirkel) */
  variant?: 'ghost' | 'primary';
  className?: string;
  disabled?: boolean;
  testID?: string;
};

/** Rundt ikon-tryk til headere og rækker. `label` er til skærmlæsere. */
export function IconButton({ icon: Icon, onPress, label, size = 22, variant = 'ghost', className = '', disabled, testID }: IconButtonProps) {
  const { theme } = useUniwind();
  const dark = theme === 'dark';
  const color = variant === 'primary' ? colors.white : (dark ? colors.neutral[100] : colors.neutral[800]);
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={label}
      className={twMerge(
        'size-11 items-center justify-center rounded-full',
        variant === 'primary' ? 'bg-primary-600 active:bg-primary-700' : 'active:bg-muted',
        disabled ? 'opacity-40' : '',
        className,
      )}
      testID={testID}
    >
      <Icon size={size} color={color} />
    </Pressable>
  );
}
