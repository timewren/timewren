import * as React from 'react';
import { View } from 'react-native';
import { twMerge } from 'tailwind-merge';
import { initials } from '~/lib/format';
import { Image } from './image';
import { Text } from './text';

type AvatarProps = {
  name: string | null | undefined;
  image?: string | null;
  size?: number;
  className?: string;
};

/**
 * Rundt avatar med billede eller initialer.
 *
 * Billedvarianten får `accessibilityRole="image"` og navnet som label — ellers
 * hører skærmlæseren intet, fordi billedet ikke har tekst. Initialer læses
 * normalt (to bogstaver), så de får samme behandling: ét stop med navnet.
 * I en `ListRow` skjuler rækken avataren, fordi titlen lige ved siden af siger
 * præcis det samme navn.
 */
export function Avatar({ name, image, size = 36, className = '' }: AvatarProps) {
  const style = { width: size, height: size, borderRadius: size / 2 };
  const spoken = name?.trim() ? { accessible: true, accessibilityRole: 'image' as const, accessibilityLabel: name } : {};
  if (image) {
    return <Image source={{ uri: image }} style={style} className={className} contentFit="cover" {...spoken} />;
  }
  return (
    <View style={style} className={twMerge('items-center justify-center bg-primary-100 dark:bg-primary-900', className)} {...spoken}>
      <Text
        className="font-semibold text-primary-700 dark:text-primary-200"
        style={{ fontSize: size * 0.38 }}
        {...(name?.trim() ? { importantForAccessibility: 'no-hide-descendants' as const, accessibilityElementsHidden: true } : {})}
      >
        {initials(name)}
      </Text>
    </View>
  );
}
