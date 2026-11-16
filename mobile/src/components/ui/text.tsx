/* eslint-disable better-tailwindcss/no-unknown-classes */
import type { TextProps, TextStyle } from 'react-native';
import type { TxKeyPath } from '~/lib/i18n';
import * as React from 'react';
import { I18nManager, Text as NNText, StyleSheet } from 'react-native';

import { twMerge } from 'tailwind-merge';
import { translate } from '~/lib/i18n';

type Props = {
  className?: string;
  tx?: TxKeyPath;
} & TextProps;

/**
 * Klarer sig, som om den altid har hørt til UI-kittet: `Text` med `onPress` er
 * et link, så skærmlæseren siger "link" og gør den aktiverbar med tale, og en
 * ren tekst bliver ikke til et stop. Har kaldet selv sat en rolle, vinder den —
 * en knap skal hedde knap. Uden denne regel fik en trykbar tekst ingen rolle
 * overhovedet, og VoiceOver læste den som statisk tekst, som intet gjorde ved
 * trykket.
 */
export function Text({
  className = '',
  style,
  tx,
  children,
  onPress,
  accessible,
  accessibilityRole,
  ...props
}: Props) {
  const textStyle = React.useMemo(
    () =>
      twMerge(
        'font-inter text-base font-normal text-foreground',
        className,
      ),
    [className],
  );

  const nStyle = React.useMemo(
    () =>
      StyleSheet.flatten([
        {
          writingDirection: I18nManager.isRTL ? 'rtl' : 'ltr',
        },
        style,
      ]) as TextStyle,
    [style],
  );
  return (
    <NNText
      className={textStyle}
      style={nStyle}
      onPress={onPress}
      accessible={accessible ?? (onPress ? true : undefined)}
      accessibilityRole={accessibilityRole ?? (onPress ? 'link' : undefined)}
      {...props}
    >
      {tx ? translate(tx) : children}
    </NNText>
  );
}
