/* eslint-disable better-tailwindcss/no-unknown-classes */
import type { PressableProps, View } from 'react-native';
import type { VariantProps } from 'tailwind-variants';
import * as React from 'react';
import { ActivityIndicator, Pressable, Text, useWindowDimensions } from 'react-native';
import { tv } from 'tailwind-variants';

import { textSafeHeight } from '~/lib/text-scale';

const button = tv({
  slots: {
    // Linear-guiden: rolige, flade knapper med lg-radius og mellemvægt; 44 pt høje for touch.
    container: 'my-2 flex flex-row items-center justify-center rounded-lg px-4',
    label: 'font-inter text-[15px] font-medium',
    indicator: 'h-6 text-white',
  },

  variants: {
    variant: {
      default: {
        container: 'bg-primary-600 active:bg-primary-700 dark:bg-primary-500 dark:active:bg-primary-600',
        label: 'text-white',
        indicator: 'text-white',
      },
      secondary: {
        container: 'bg-primary-600 active:bg-primary-700',
        label: 'text-white',
        indicator: 'text-white',
      },
      outline: {
        container: 'border border-border bg-card active:bg-muted',
        label: 'text-foreground',
        indicator: 'text-foreground',
      },
      destructive: {
        container: 'bg-danger-600 active:bg-danger-700',
        label: 'text-white',
        indicator: 'text-white',
      },
      ghost: {
        container: 'bg-transparent active:bg-muted',
        label: 'text-neutral-700 dark:text-neutral-300',
        indicator: 'text-neutral-700 dark:text-neutral-300',
      },
      link: {
        container: 'bg-transparent',
        label: 'text-primary-600 underline dark:text-primary-400',
        indicator: 'text-primary-600 dark:text-primary-400',
      },
    },
    size: {
      default: {
        container: 'h-11 px-4',
        label: 'text-[15px]',
      },
      lg: {
        container: 'h-12 px-6',
        label: 'text-base',
      },
      sm: {
        container: 'h-8 px-3',
        label: 'text-sm',
        indicator: 'h-2',
      },
      icon: { container: 'size-9' },
    },
    disabled: {
      true: {
        container: 'bg-muted',
        label: 'text-muted-foreground',
        indicator: 'text-muted-foreground',
      },
    },
    fullWidth: {
      true: {
        container: '',
      },
      false: {
        container: 'self-center',
      },
    },
  },
  defaultVariants: {
    variant: 'default',
    disabled: false,
    fullWidth: true,
    size: 'default',
  },
});

type ButtonVariants = VariantProps<typeof button>;

/**
 * Grundhøjderne fra `size`-varianterne ovenfor, i pixels. `icon` mangler med
 * vilje — den har intet i sig, der skalerer. Bruges til `minHeight`, så en
 * knap der vokser med systemets skriftstørrelse aldrig klipper sin etiket.
 */
const SIZE_HEIGHT: Partial<Record<NonNullable<ButtonVariants['size']>, number>> = {
  default: 44,
  lg: 48,
  sm: 32,
};

type Props = {
  label?: string;
  loading?: boolean;
  className?: string;
  textClassName?: string;
  /** Ikke tilgængelig: knappen sætter selv `style` ud fra skriftstørrelsen. */
} & ButtonVariants & Omit<PressableProps, 'disabled' | 'style'>;

export function Button({ ref, label: text, loading = false, variant = 'default', disabled = false, size = 'default', className = '', testID, textClassName = '', accessibilityLabel, accessibilityRole = 'button', accessibilityState, ...props }: Props & { ref?: React.RefObject<View | null> }) {
  const styles = React.useMemo(
    () => button({ variant, disabled, size }),
    [variant, disabled, size],
  );

  // `h-11` i klasserne er en fast højde. Teksten skalerer med systemet, så
  // ved de store indstillinger skal knappen vokse, ellers klippes etiketten.
  const { fontScale } = useWindowDimensions();
  const baseHeight = size ? SIZE_HEIGHT[size] : undefined;
  const style = React.useMemo(
    () => (baseHeight ? { minHeight: textSafeHeight(baseHeight, fontScale) } : undefined),
    [baseHeight, fontScale],
  );

  return (
    <Pressable
      disabled={disabled || loading}
      className={styles.container({ className })}
      {...props}
      style={style}
      ref={ref}
      testID={testID}
      accessibilityRole={accessibilityRole}
      // `loading` erstatter teksten med en spinner, så uden dette læser VoiceOver intet.
      accessibilityLabel={accessibilityLabel ?? (props.children ? undefined : text)}
      accessibilityState={{ busy: loading, ...accessibilityState }}
    >
      {props.children
        ? (
            props.children
          )
        : (
            <>
              {loading
                ? (
                    <ActivityIndicator
                      size="small"
                      className={styles.indicator()}
                      testID={testID ? `${testID}-activity-indicator` : undefined}
                    />
                  )
                : (
                    <Text
                      testID={testID ? `${testID}-label` : undefined}
                      className={styles.label({ className: textClassName })}
                    >
                      {text}
                    </Text>
                  )}
            </>
          )}
    </Pressable>
  );
}
