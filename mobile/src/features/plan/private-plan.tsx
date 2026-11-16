import type { BottomSheetModal } from '@gorhom/bottom-sheet';
import { useRouter } from 'expo-router';
import { BarChart3, Cloud, Download, Users } from 'lucide-react-native';
import * as React from 'react';
import { Pressable, View } from 'react-native';
import { useUniwind } from 'uniwind';
import { Button, colors, Modal, Text } from '~/components/ui';
import { BottomSheetView } from '~/components/ui/bottom-sheet';
import { useAuthStore } from '~/features/auth/use-auth-store';
import { translate } from '~/lib/i18n';

/** Lille, roligt mærke ved Privat-funktioner. `beta` = åben gratis indtil Privat kan købes. */
export function PrivateBadge({ beta = true, onPress }: { beta?: boolean; onPress?: () => void }) {
  const body = (
    <View className="flex-row items-center rounded-full bg-violet-100 px-2 py-0.5 dark:bg-violet-700/30">
      <Text className="text-[11px] font-medium text-violet-700 dark:text-violet-300">
        {translate(beta ? 'plan.badge_beta' : 'plan.badge')}
      </Text>
    </View>
  );
  if (!onPress)
    return body;
  return (
    <Pressable onPress={onPress} hitSlop={8} accessibilityRole="button" accessibilityLabel={translate('plan.what_is')} testID="private-badge">
      {body}
    </Pressable>
  );
}

const FEATURES = [
  { icon: Cloud, key: 'sync' },
  { icon: Users, key: 'clients' },
  { icon: BarChart3, key: 'stats' },
  { icon: Download, key: 'export' },
] as const;

/**
 * Forklaring af Privat i et bundark — aldrig blokerende. "Ikke nu" er lige så synlig som
 * vejen videre. Købet kræver en konto: uden konto oprettes den først, med konto går
 * vejen til abonnementsskærmen, hvor butikkens priser og købsknappen er.
 */
export function PrivatePlanSheet({ ref }: { ref: React.RefObject<BottomSheetModal | null> }) {
  const { theme } = useUniwind();
  const dark = theme === 'dark';
  const router = useRouter();
  const signedIn = useAuthStore.use.status() === 'signIn';
  const snapPoints = React.useMemo(() => ['70%'], []);
  const close = () => ref.current?.dismiss();

  const proceed = () => {
    close();
    router.push(signedIn ? '/settings/subscription' : '/signup');
  };

  return (
    <Modal ref={ref} snapPoints={snapPoints} title={translate('plan.title')} backgroundStyle={{ backgroundColor: dark ? colors.theme.dark.card : colors.white }}>
      <BottomSheetView>
        <View className="px-5 pb-8" testID="private-plan-sheet">
          <Text className="text-[13px] text-muted-foreground" tx="plan.intro" />
          <View className="mt-4 gap-3">
            {FEATURES.map(({ icon: Icon, key }) => (
              <View key={key} className="flex-row items-start gap-3">
                <Icon size={18} color={colors.violet[dark ? 300 : 600]} />
                <View className="flex-1">
                  <Text className="text-sm font-medium text-foreground" tx={`plan.features.${key}.title`} />
                  <Text className="text-[13px] text-muted-foreground" tx={`plan.features.${key}.body`} />
                </View>
              </View>
            ))}
          </View>
          <Text className="mt-4 text-[13px] text-muted-foreground" tx="plan.price_note" />
          {signedIn ? null : <Text className="mt-2 text-[13px] text-muted-foreground" tx="plan.account_note" />}
          <View className="mt-4 gap-2">
            <Button
              className="my-0"
              label={translate(signedIn ? 'plan.see_plans' : 'plan.create_account')}
              onPress={proceed}
              testID="private-plan-continue"
            />
            <Button className="my-0" variant="outline" label={translate('plan.not_now')} onPress={close} testID="private-plan-close" />
          </View>
        </View>
      </BottomSheetView>
    </Modal>
  );
}
