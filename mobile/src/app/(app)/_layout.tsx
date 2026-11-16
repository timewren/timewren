import type { LucideIcon } from 'lucide-react-native';
import { Redirect, Tabs } from 'expo-router';
import {
  Clock,
  Ellipsis,
  House,
  LayoutDashboard,
  Palmtree,
  Users,
} from 'lucide-react-native';
import * as React from 'react';
import { useTranslation } from 'react-i18next';
import { useUniwind } from 'uniwind';
import { colors } from '~/components/ui';
import { useAuthStore } from '~/features/auth/use-auth-store';
import { useCapabilities } from '~/features/capabilities/use-capabilities';
import { hasLocalData } from '~/features/local/local-logic';
import { localStore, useLocalStore } from '~/features/local/local-store';
import { useNotifications } from '~/features/notifications/use-notifications';
import { useRunningNotification } from '~/features/notifications/use-running-notification';
import { useTimerReminder } from '~/features/notifications/use-timer-reminder';
import { useOfflineSync } from '~/features/offline/use-offline-sync';
import { useTimerFreshness } from '~/features/timer/use-timer-freshness';
import { useTimerRecovery } from '~/features/timer/use-timer-recovery';
import { trpc } from '~/lib/api';
import { useIsFirstTime } from '~/lib/hooks/use-is-first-time';
import { translate } from '~/lib/i18n';

function tabIcon(Icon: LucideIcon) {
  return function TabIcon({ color, size }: { color: string; size: number }) {
    return <Icon color={color} size={size} strokeWidth={1.75} />;
  };
}

/**
 * Adaptiv bundnavigation. Fem faner: Hjem · Tid · Overblik · (Fravær | Kunder) · Mere.
 * Fjerde fane afhænger af tier: enterprise får Fravær, alle andre får Kunder.
 * Ruter der ikke skal vises får `href: null` (Expo Router kræver at filen findes).
 */
export default function TabLayout() {
  const status = useAuthStore.use.status();
  const [isFirstTime] = useIsFirstTime();
  const caps = useCapabilities();
  const { theme } = useUniwind();
  const dark = theme === 'dark';
  const profile = trpc.user.getProfile.useQuery(undefined, { enabled: status === 'signIn' });
  useOfflineSync();
  useNotifications(status === 'signIn');
  useTimerReminder();
  useRunningNotification();
  useTimerRecovery();
  useTimerFreshness(status === 'signIn');
  const localEnabled = useLocalStore.use.enabled();
  const hasLocal = useLocalStore(hasLocalData);
  const importDeferred = useLocalStore.use.importDeferred();

  // Logget ind uden lokale data: "uden konto"-tilstanden er ikke længere relevant.
  React.useEffect(() => {
    if (status === 'signIn' && localEnabled && !hasLocal)
      localStore().clearAll();
  }, [status, localEnabled, hasLocal]);

  if (isFirstTime)
    return <Redirect href="/onboarding" />;
  if (status === 'signOut')
    return <Redirect href={localEnabled ? '/local' : '/login'} />;
  // Ny bruger uden gennemført opsætning (ejer af egen org) sendes til in-app-opsætning.
  if (profile.data && profile.data.onboardingCompleted === false && caps.isAdmin)
    return <Redirect href="/setup" />;
  // Tid registreret uden konto tilbydes overført, når kontoen er klar.
  if (status === 'signIn' && profile.data && hasLocal && !importDeferred)
    return <Redirect href="/local/import" />;

  const showAbsence = caps.isEnterprise;
  const showClients = !caps.isEnterprise && caps.isEnabled('clients');
  const showTeam = !caps.isEnterprise && !showClients && caps.hasOrg;

  return <TabBar dark={dark} showAbsence={showAbsence} showClients={showClients} showTeam={showTeam} />;
}

type TabBarProps = { dark: boolean; showAbsence: boolean; showClients: boolean; showTeam: boolean };

function TabBar({ dark, showAbsence, showClients, showTeam }: TabBarProps) {
  // Abonnerer på sprogskift, så fanetitlerne følger med når sproget ændres i appen.
  useTranslation();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary[dark ? 400 : 600],
        tabBarInactiveTintColor: colors.theme[dark ? 'dark' : 'light'].mutedForeground,
        tabBarStyle: {
          backgroundColor: colors.theme[dark ? 'dark' : 'light'].card,
          borderTopColor: colors.theme[dark ? 'dark' : 'light'].border,
        },
        tabBarLabelStyle: { fontFamily: 'Inter', fontSize: 12, fontWeight: '500' },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: translate('tabs.home'),
          tabBarIcon: tabIcon(House),
          tabBarButtonTestID: 'home-tab',
        }}
      />
      <Tabs.Screen
        name="time"
        options={{
          title: translate('tabs.time'),
          tabBarIcon: tabIcon(Clock),
          tabBarButtonTestID: 'time-tab',
        }}
      />
      <Tabs.Screen
        name="overview"
        options={{
          title: translate('tabs.overview'),
          tabBarIcon: tabIcon(LayoutDashboard),
          tabBarButtonTestID: 'overview-tab',
        }}
      />
      <Tabs.Screen
        name="absence"
        options={{
          href: showAbsence ? undefined : null,
          title: translate('tabs.absence'),
          tabBarIcon: tabIcon(Palmtree),
          tabBarButtonTestID: 'absence-tab',
        }}
      />
      <Tabs.Screen
        name="clients"
        options={{
          href: showClients ? undefined : null,
          title: translate('tabs.clients'),
          tabBarIcon: tabIcon(Users),
          tabBarButtonTestID: 'clients-tab',
        }}
      />
      <Tabs.Screen
        name="team"
        options={{
          href: showTeam ? undefined : null,
          title: translate('tabs.team'),
          tabBarIcon: tabIcon(Users),
          tabBarButtonTestID: 'team-tab',
        }}
      />
      <Tabs.Screen
        name="more"
        options={{
          title: translate('tabs.more'),
          tabBarIcon: tabIcon(Ellipsis),
          tabBarButtonTestID: 'more-tab',
        }}
      />
    </Tabs>
  );
}
