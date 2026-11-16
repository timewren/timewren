import type { Favorite } from '~/features/timer-templates/template-logic';
import type { UseTimer } from '~/features/timer/use-timer';
import * as Haptics from 'expo-haptics';
import { Star } from 'lucide-react-native';
import * as React from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useUniwind } from 'uniwind';
import { colors, Text } from '~/components/ui';
import { useFavoriteTemplates } from '~/features/timer-templates/use-favorite-templates';
import { translate } from '~/lib/i18n';

/**
 * Favoritter i timeren: ét tryk på en skabelon starter den med sit projekt og
 * sin kunde, i stedet for at brugeren skal åbne vælgeren. Rækken er en
 * ekstravej oven på vælgeren, så mens en timer kører, er knapperne låste — de
 * forsvinder ikke, så brugeren stadig kan se sine favoritter til næste post.
 *
 * Rækken er tom, indtil serveren svarer, og bliver tom igen uden net. Det er
 * bevidst: en tom række skal ikke fylde kortet med en pladsholder, og
 * hurtig start på Hjem dækker ét-tryk behovet offline.
 */
type Props = {
  controller: UseTimer;
  disabled: boolean;
};

export function FavoritesRow({ controller, disabled }: Props) {
  const { favorites, start } = useFavoriteTemplates();
  const { theme } = useUniwind();
  const star = theme === 'dark' ? colors.neutral[400] : colors.neutral[500];

  const onPress = React.useCallback((favorite: Favorite) => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    void start(favorite.template, controller.start);
  }, [controller.start, start]);

  if (!favorites.length)
    return null;

  return (
    <View className="mt-3">
      <View className="flex-row items-center gap-1.5">
        <Star size={13} color={star} fill={star} />
        <Text className="text-xs font-medium tracking-wide text-muted-foreground">
          {translate('timer.favorites_title')}
        </Text>
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: 8, paddingTop: 8, paddingRight: 8 }}
        testID="timer-favorites"
      >
        {favorites.map(favorite => (
          <FavoriteChip
            key={favorite.id}
            name={favorite.name}
            label={favorite.label}
            onPress={() => onPress(favorite)}
            disabled={disabled}
          />
        ))}
      </ScrollView>
    </View>
  );
}

function FavoriteChip({ name, label, onPress, disabled }: { name: string; label: string; onPress: () => void; disabled: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      accessibilityLabel={`${translate('timer.start')}: ${name} — ${label}`}
      className="min-h-11 justify-center rounded-full border border-border bg-background/60 px-4 py-2.5 active:opacity-70 disabled:opacity-50 dark:bg-card/60"
      testID={`timer-favorite-${name}`}
    >
      <Text className="text-sm font-medium text-foreground" numberOfLines={1}>{name}</Text>
    </Pressable>
  );
}
