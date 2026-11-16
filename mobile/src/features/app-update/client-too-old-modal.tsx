import { ArrowUpCircle } from 'lucide-react-native';
import * as React from 'react';
import { Linking, Modal, Platform, View } from 'react-native';
import { useUniwind } from 'uniwind';
import { Button, colors, Text } from '~/components/ui';
import { storeUrl } from '~/features/more/links';
import { useClientTooOld } from '~/lib/api/client-version';
import { translate } from '~/lib/i18n';

/**
 * Blokerende besked, når serveren afviser appen som for gammel
 * (`CLIENT_TOO_OLD`). Kan ikke lukkes: skrivninger afvises alligevel, og
 * ventende registreringer ligger sikkert i offline-køen til opdateringen.
 */
export function ClientTooOldModal() {
  const tooOld = useClientTooOld(s => s.tooOld);
  const { theme } = useUniwind();
  if (!tooOld)
    return null;
  return (
    <Modal visible animationType="fade" onRequestClose={() => {}} statusBarTranslucent>
      <View className="flex-1 items-center justify-center gap-4 bg-background px-8" testID="client-too-old">
        <ArrowUpCircle size={48} color={colors.primary[theme === 'dark' ? 400 : 600]} />
        <Text className="text-center text-xl font-semibold text-foreground" accessibilityRole="header">
          {translate('update.title')}
        </Text>
        <Text className="text-center text-muted-foreground">{translate('update.body')}</Text>
        <Button
          className="mt-2 self-stretch"
          label={translate('update.button')}
          onPress={() => void Linking.openURL(storeUrl(Platform.OS))}
          testID="client-too-old-update"
        />
      </View>
    </Modal>
  );
}
