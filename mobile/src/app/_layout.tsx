import type { ViewProps } from 'react-native';

import { ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import * as WebBrowser from 'expo-web-browser';
import * as React from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import FlashMessage from 'react-native-flash-message';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { RootErrorScreen } from '~/components/root-error-screen';
import { AccessibleSheetProvider } from '~/components/ui/modal';
import { useThemeConfig } from '~/components/ui/use-theme-config';
import { ClientTooOldModal } from '~/features/app-update/client-too-old-modal';
import { hydrateAuth, useAuthStore } from '~/features/auth/use-auth-store';
import { StoreTransactionObserver } from '~/features/billing/store-transaction-observer';
import { FeedbackBubble } from '~/features/feedback/feedback-bubble';
import { installConsoleCapture } from '~/features/feedback/feedback-store';

import { APIProvider } from '~/lib/api';
import { subscribeAuthDeepLinks } from '~/lib/auth/deep-link';
import { loadSelectedTheme } from '~/lib/hooks/use-selected-theme';
import { translate } from '~/lib/i18n';
import { initMonitoring } from '~/lib/monitoring';
// Import  global CSS file
import '../global.css';

export { RootErrorScreen as ErrorBoundary };

// eslint-disable-next-line react-refresh/only-export-components
export const unstable_settings = {
  initialRouteName: '(app)',
};

initMonitoring();
installConsoleCapture();
WebBrowser.maybeCompleteAuthSession();
// Prevent the splash screen from auto-hiding before asset loading is complete.
void SplashScreen.preventAutoHideAsync().catch(() => {
  // Appen kan stadig starte, hvis splash-skærmen ikke kan holdes synlig.
});
// Set the animation options. This is optional.
SplashScreen.setOptions({
  duration: 500,
  fade: true,
});

export default function RootLayout() {
  const status = useAuthStore.use.status();
  const checking = useAuthStore.use.checking();
  const navigationKey = useAuthStore.use.navigationKey();
  const hasHiddenSplashRef = React.useRef(false);

  const [startupError, setStartupError] = React.useState<Error>();

  React.useLayoutEffect(loadSelectedTheme, []);

  // APIProvider starter auth-tjekket, når netværksstatus kendes (og igen ved
  // genforsøg fra fejlskærmen, som monterer roden på ny). En afvist hydrering
  // vises på fejlskærmen i stedet for at forsvinde som en ubehandlet promise.
  const onNetworkReady = React.useCallback(async (retry: boolean) => {
    try {
      return await revalidateSignedInSession(retry);
    }
    catch (error) {
      setStartupError(error instanceof Error ? error : new Error('Auth initialization failed'));
    }
  }, []);

  React.useEffect(() => subscribeAuthDeepLinks(), []);

  const onLayoutRootView = React.useCallback(() => {
    if (hasHiddenSplashRef.current) {
      return;
    }

    hasHiddenSplashRef.current = true;
    SplashScreen.hide();
  }, []);

  if (startupError)
    throw startupError;

  return (
    <Providers onLayout={onLayoutRootView} onNetworkReady={onNetworkReady}>
      {status !== 'idle' && (
        <View
          style={[styles.container, checking && styles.concealed]}
          pointerEvents={checking ? 'none' : 'auto'}
          accessibilityElementsHidden={checking}
          importantForAccessibility={checking ? 'no-hide-descendants' : 'auto'}
        >
          <AccessibleSheetProvider key={navigationKey}>
            <AppStack />
            {/* Inde i arkprovideren, så TalkBack ikke når boblen bag et åbent handlingsark. */}
            <FeedbackBubble />
          </AccessibleSheetProvider>
        </View>
      )}
      {(status === 'idle' || checking) && (
        <View className="absolute inset-0 items-center justify-center bg-background">
          <ActivityIndicator />
        </View>
      )}
    </Providers>
  );
}

function AppStack() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(app)" options={{ title: translate('tabs.home') }} />
      <Stack.Screen name="onboarding" options={{ title: translate('navigation.welcome') }} />
      <Stack.Screen name="login" options={{ title: translate('auth.sign_in') }} />
      <Stack.Screen name="signup" options={{ title: translate('auth.signup.title') }} />
      <Stack.Screen name="setup" options={{ title: translate('setup.start.title') }} />
      <Stack.Screen name="local" options={{ title: translate('navigation.app') }} />
      <Stack.Screen name="entries/new" options={{ title: translate('entries.new_title'), presentation: 'modal' }} />
      <Stack.Screen name="entries/[id]" options={{ title: translate('entries.edit_title') }} />
      <Stack.Screen name="log-opkald" options={{ title: translate('calls.title'), presentation: 'modal' }} />
      <Stack.Screen name="clients/[id]" options={{ title: translate('navigation.client') }} />
      <Stack.Screen name="clients/new" options={{ title: translate('clients.new_title'), presentation: 'modal' }} />
      <Stack.Screen name="clients/[id]/edit" options={{ title: translate('clients.edit_title') }} />
      <Stack.Screen name="projects/index" options={{ title: translate('projects.list_title') }} />
      <Stack.Screen name="projects/[id]" options={{ title: translate('navigation.project') }} />
      <Stack.Screen name="projects/new" options={{ title: translate('projects.new_title'), presentation: 'modal' }} />
      <Stack.Screen name="projects/[id]/edit" options={{ title: translate('projects.edit_title') }} />
      <Stack.Screen name="prepaid/index" options={{ title: translate('prepaid.title') }} />
      <Stack.Screen name="prepaid/[id]" options={{ title: translate('navigation.prepaid') }} />
      <Stack.Screen name="prepaid/new" options={{ title: translate('prepaid.new_title'), presentation: 'modal' }} />
      <Stack.Screen name="invoices/index" options={{ title: translate('invoices.title') }} />
      <Stack.Screen name="invoices/[id]" options={{ title: translate('navigation.invoice') }} />
      <Stack.Screen name="tasks/index" options={{ title: translate('tasks.title') }} />
      <Stack.Screen name="tasks/[id]" options={{ title: translate('navigation.task') }} />
      <Stack.Screen name="tasks/new" options={{ title: translate('tasks.new'), presentation: 'modal' }} />
      <Stack.Screen name="reports/index" options={{ title: translate('reports.title') }} />
      <Stack.Screen name="week-review" options={{ title: translate('week_review.title') }} />
      <Stack.Screen name="settings" options={{ title: translate('navigation.settings') }} />
      <Stack.Screen name="search" options={{ title: translate('search.title'), presentation: 'modal' }} />
      <Stack.Screen name="feedback" options={{ title: translate('settings.feedback.title'), presentation: 'modal' }} />
      <Stack.Screen name="enterprise/timesheet" options={{ title: translate('enterprise.timesheet.title') }} />
      <Stack.Screen name="enterprise/team" options={{ title: translate('enterprise.team.title') }} />
      <Stack.Screen name="enterprise/employees/index" options={{ title: translate('enterprise.employees.title') }} />
      <Stack.Screen name="enterprise/employees/[id]" options={{ title: translate('enterprise.employees.profile') }} />
      <Stack.Screen name="enterprise/compliance" options={{ title: translate('enterprise.compliance.title') }} />
      <Stack.Screen name="enterprise/flex" options={{ title: translate('enterprise.flex.title') }} />
      <Stack.Screen name="enterprise/overtime" options={{ title: translate('enterprise.overtime.title') }} />
      <Stack.Screen name="enterprise/inbox" options={{ title: translate('enterprise.inbox.title') }} />
      <Stack.Screen name="enterprise/absence/new" options={{ title: translate('enterprise.absence.new_title'), presentation: 'modal' }} />
      <Stack.Screen name="enterprise/absence/[id]" options={{ title: translate('enterprise.absence.detail_title') }} />
      <Stack.Screen name="invoices/new" options={{ title: translate('invoices.new.title') }} />
      <Stack.Screen name="cashflow" options={{ title: translate('cashflow.title') }} />
      <Stack.Screen name="logbook/index" options={{ title: translate('logbook.title') }} />
      <Stack.Screen name="logbook/[user-id]" options={{ title: translate('logbook.day_title') }} />
      <Stack.Screen name="project-health" options={{ title: translate('project_health.title') }} />
      <Stack.Screen name="recurring/index" options={{ title: translate('recurring.title') }} />
      <Stack.Screen name="recurring/new" options={{ title: translate('recurring.new_title') }} />
      <Stack.Screen name="recurring/[id]" options={{ title: translate('recurring.edit_title') }} />
      <Stack.Screen name="waste" options={{ title: translate('waste.title') }} />
      <Stack.Screen name="[...messing]" options={{ title: translate('common.not_found_title'), headerShown: true }} />
    </Stack>
  );
}

async function revalidateSignedInSession(retry: boolean) {
  if (useAuthStore.getState().status === 'signOut')
    return true;
  return hydrateAuth(retry);
}

function Providers({
  children,
  onLayout,
  onNetworkReady,
}: {
  children: React.ReactNode;
  onLayout: ViewProps['onLayout'];
  onNetworkReady: (retry: boolean) => Promise<boolean | undefined>;
}) {
  const theme = useThemeConfig();
  return (
    <GestureHandlerRootView
      onLayout={onLayout}
      style={styles.container}
    >
      <KeyboardProvider>
        <ThemeProvider value={theme}>
          <APIProvider onNetworkReady={onNetworkReady}>
            {children}
            <TopFlashMessage />
            <ClientTooOldModal />
            <StoreTransactionObserver />
          </APIProvider>
        </ThemeProvider>
      </KeyboardProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  concealed: {
    opacity: 0,
  },
});

/** Toasts under statusbaren (flydende), ikke ovenpå den. */
function TopFlashMessage() {
  const insets = useSafeAreaInsets();
  return <FlashMessage position="top" floating statusBarHeight={insets.top} />;
}
