import type { ViewProps } from 'react-native';
import { BottomSheetModalProvider } from '@gorhom/bottom-sheet';

import { ThemeProvider } from '@react-navigation/native';
import { ErrorBoundary as RouterErrorBoundary, Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import * as WebBrowser from 'expo-web-browser';
import * as React from 'react';
import { StyleSheet } from 'react-native';
import FlashMessage from 'react-native-flash-message';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useThemeConfig } from '~/components/ui/use-theme-config';
import { ClientTooOldModal } from '~/features/app-update/client-too-old-modal';
import { hydrateAuth } from '~/features/auth/use-auth-store';
import { StoreTransactionObserver } from '~/features/billing/store-transaction-observer';
import { FeedbackBubble } from '~/features/feedback/feedback-bubble';
import { installConsoleCapture } from '~/features/feedback/feedback-store';

import { APIProvider } from '~/lib/api';
import { subscribeAuthDeepLinks } from '~/lib/auth/deep-link';
import { loadSelectedTheme } from '~/lib/hooks/use-selected-theme';
import { captureError, initMonitoring } from '~/lib/monitoring';
// Import  global CSS file
import '../global.css';

/** Fanger render-fejl på rute-niveau, sender dem til Sentry og viser Expo Routers fallback. */
export function ErrorBoundary(props: React.ComponentProps<typeof RouterErrorBoundary>) {
  React.useEffect(() => {
    captureError(props.error, { route: 'ErrorBoundary' });
  }, [props.error]);
  return <RouterErrorBoundary {...props} />;
}

// eslint-disable-next-line react-refresh/only-export-components
export const unstable_settings = {
  initialRouteName: '(app)',
};

initMonitoring();
installConsoleCapture();
WebBrowser.maybeCompleteAuthSession();
void hydrateAuth();
loadSelectedTheme();
// Prevent the splash screen from auto-hiding before asset loading is complete.
SplashScreen.preventAutoHideAsync();
// Set the animation options. This is optional.
SplashScreen.setOptions({
  duration: 500,
  fade: true,
});

export default function RootLayout() {
  const hasHiddenSplashRef = React.useRef(false);

  React.useEffect(() => subscribeAuthDeepLinks(), []);

  const onLayoutRootView = React.useCallback(() => {
    if (hasHiddenSplashRef.current) {
      return;
    }

    hasHiddenSplashRef.current = true;
    SplashScreen.hide();
  }, []);

  return (
    <Providers onLayout={onLayoutRootView}>
      <Stack>
        <Stack.Screen name="(app)" options={{ headerShown: false }} />
        <Stack.Screen name="onboarding" options={{ headerShown: false }} />
        <Stack.Screen name="login" options={{ headerShown: false }} />
        <Stack.Screen name="signup" options={{ headerShown: false }} />
        <Stack.Screen name="setup" options={{ headerShown: false }} />
        <Stack.Screen name="local" options={{ headerShown: false }} />
        <Stack.Screen name="entries/new" options={{ headerShown: false, presentation: 'modal' }} />
        <Stack.Screen name="entries/[id]" options={{ headerShown: false }} />
        <Stack.Screen name="log-opkald" options={{ headerShown: false, presentation: 'modal' }} />
        <Stack.Screen name="clients/[id]" options={{ headerShown: false }} />
        <Stack.Screen name="clients/new" options={{ headerShown: false, presentation: 'modal' }} />
        <Stack.Screen name="clients/[id]/edit" options={{ headerShown: false }} />
        <Stack.Screen name="projects/index" options={{ headerShown: false }} />
        <Stack.Screen name="projects/[id]" options={{ headerShown: false }} />
        <Stack.Screen name="projects/new" options={{ headerShown: false, presentation: 'modal' }} />
        <Stack.Screen name="projects/[id]/edit" options={{ headerShown: false }} />
        <Stack.Screen name="prepaid/index" options={{ headerShown: false }} />
        <Stack.Screen name="prepaid/[id]" options={{ headerShown: false }} />
        <Stack.Screen name="prepaid/new" options={{ headerShown: false, presentation: 'modal' }} />
        <Stack.Screen name="invoices/index" options={{ headerShown: false }} />
        <Stack.Screen name="invoices/[id]" options={{ headerShown: false }} />
        <Stack.Screen name="tasks/index" options={{ headerShown: false }} />
        <Stack.Screen name="tasks/[id]" options={{ headerShown: false }} />
        <Stack.Screen name="tasks/new" options={{ headerShown: false, presentation: 'modal' }} />
        <Stack.Screen name="reports/index" options={{ headerShown: false }} />
        <Stack.Screen name="week-review" options={{ headerShown: false }} />
        <Stack.Screen name="settings" options={{ headerShown: false }} />
        <Stack.Screen name="search" options={{ headerShown: false, presentation: 'modal' }} />
        <Stack.Screen name="feedback" options={{ headerShown: false, presentation: 'modal' }} />
        <Stack.Screen name="enterprise/timesheet" options={{ headerShown: false }} />
        <Stack.Screen name="enterprise/team" options={{ headerShown: false }} />
        <Stack.Screen name="enterprise/employees/index" options={{ headerShown: false }} />
        <Stack.Screen name="enterprise/employees/[id]" options={{ headerShown: false }} />
        <Stack.Screen name="enterprise/compliance" options={{ headerShown: false }} />
        <Stack.Screen name="enterprise/flex" options={{ headerShown: false }} />
        <Stack.Screen name="enterprise/overtime" options={{ headerShown: false }} />
        <Stack.Screen name="enterprise/inbox" options={{ headerShown: false }} />
        <Stack.Screen name="enterprise/absence/new" options={{ headerShown: false, presentation: 'modal' }} />
        <Stack.Screen name="enterprise/absence/[id]" options={{ headerShown: false }} />
      </Stack>
    </Providers>
  );
}

function Providers({
  children,
  onLayout,
}: {
  children: React.ReactNode;
  onLayout: ViewProps['onLayout'];
}) {
  const theme = useThemeConfig();
  return (
    <GestureHandlerRootView
      onLayout={onLayout}
      style={styles.container}
    >
      <KeyboardProvider>
        <ThemeProvider value={theme}>
          <APIProvider>
            <BottomSheetModalProvider>
              {children}
              <FeedbackBubble />
              <TopFlashMessage />
              <ClientTooOldModal />
              <StoreTransactionObserver />
            </BottomSheetModalProvider>
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
});

/** Toasts under statusbaren (flydende), ikke ovenpå den. */
function TopFlashMessage() {
  const insets = useSafeAreaInsets();
  return <FlashMessage position="top" floating statusBarHeight={insets.top} />;
}
