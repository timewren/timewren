import type { LucideIcon } from 'lucide-react-native';
import { useRouter } from 'expo-router';
import { CalendarDays, Cloud, Timer } from 'lucide-react-native';
import * as React from 'react';
import { Image, ScrollView } from 'react-native';
import {
  Button,
  colors,
  FocusAwareStatusBar,
  SafeAreaView,
  Text,
  View,
} from '~/components/ui';
import { localStore } from '~/features/local/local-store';
import { isTimeWren, timewrenBrand } from '~/features/server/server-config';
import { useIsFirstTime } from '~/lib/hooks';
import { translate } from '~/lib/i18n';

type PointKey = 'timer' | 'days' | 'account';
const POINTS: Array<{ icon: LucideIcon; key: PointKey }> = [
  { icon: Timer, key: 'timer' },
  { icon: CalendarDays, key: 'days' },
  { icon: Cloud, key: 'account' },
];

/**
 * Velkomstskærm ved første start. Hovedvejen er at komme i gang uden konto;
 * konto/login er sekundære. Indholdet scroller, knapperne ligger fast i bunden,
 * så intet overlapper ved stor skriftstørrelse eller små skærme.
 */
export function OnboardingScreen() {
  const [, setIsFirstTime] = useIsFirstTime();
  const router = useRouter();

  const go = (to: '/login' | '/signup' | '/local') => {
    setIsFirstTime(false);
    if (to === '/local')
      localStore().enable();
    router.replace(to);
  };

  return (
    <SafeAreaView className="flex-1 bg-background">
      <FocusAwareStatusBar />
      <ScrollView contentContainerClassName="flex-grow justify-center px-6 py-8">
        <View className="mb-8 items-center">
          <Image
            source={isTimeWren ? require('../../../assets/timewren/icon.png') : require('../../../assets/icon.png')}
            style={{ width: 64, height: 64, borderRadius: 16 }}
            accessibilityIgnoresInvertColors
          />
          <Text className="mt-4 text-3xl font-bold text-foreground">{timewrenBrand?.name ?? 'TimeTrack'}</Text>
          <Text className="mt-1 text-center text-base text-muted-foreground" tx="onboarding.tagline" />
        </View>
        <View className="gap-5">
          {POINTS.map(p => <PointRow key={p.key} icon={p.icon} pointKey={p.key} />)}
        </View>
      </ScrollView>
      <View className="border-t border-border px-6 pt-3 pb-2">
        <Button label={translate('onboarding.start_local')} onPress={() => go('/local')} testID="onboarding-local" />
        <Text className="mb-1 text-center text-xs text-muted-foreground" tx="onboarding.start_local_hint" />
        <View className="flex-row justify-center gap-6">
          <Button variant="ghost" size="sm" fullWidth={false} label={translate('onboarding.create_account')} onPress={() => go('/signup')} testID="onboarding-signup" />
          <Button variant="ghost" size="sm" fullWidth={false} label={translate('onboarding.have_account')} onPress={() => go('/login')} testID="onboarding-login" />
        </View>
      </View>
    </SafeAreaView>
  );
}

function PointRow({ icon: Icon, pointKey }: { icon: LucideIcon; pointKey: PointKey }) {
  return (
    <View className="flex-row items-start gap-4">
      <View className="size-10 items-center justify-center rounded-xl bg-primary-100 dark:bg-primary-900">
        <Icon size={20} color={colors.primary[600]} />
      </View>
      <View className="flex-1">
        <Text className="font-semibold text-foreground" tx={`onboarding.points.${pointKey}.title`} />
        <Text className="text-sm text-muted-foreground" tx={`onboarding.points.${pointKey}.body`} />
      </View>
    </View>
  );
}
