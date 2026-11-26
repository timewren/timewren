import { fireEvent, render, renderAsync, screen } from '@testing-library/react-native';
import { Try } from 'expo-router/build/views/Try';
import i18n from 'i18next';
import { Text } from 'react-native';
import { Uniwind } from 'uniwind';
import RootLayout, { ErrorBoundary } from '~/app/_layout';
import { hydrateAuth } from '~/features/auth/use-auth-store';
import { resources } from '~/lib/i18n/resources';
import { captureError } from '~/lib/monitoring';
import { storage } from '~/lib/storage';

jest.mock('~/global.css', () => ({}));
jest.mock('expo-router', () => {
  const { Text } = require('react-native');
  const Stack = () => <Text>TimeTrack klar</Text>;
  Stack.Screen = () => null;
  return { Stack, ErrorBoundary: ({ error }: { error: Error }) => <Text>{error.message}</Text> };
});
jest.mock('expo', () => {
  const splash = {
    held: false,
    hide: jest.fn(() => {
      splash.held = false;
    }),
  };
  return {
    requireOptionalNativeModule: (name: string) => name === 'ExpoSplashScreen' ? splash : null,
  };
});
jest.mock('expo-splash-screen', () => ({
  hide: () => mockNativeSplash().hide(),
  preventAutoHideAsync: async () => {
    const splash = mockNativeSplash();
    if (splash.preventError)
      throw splash.preventError;
    splash.held = true;
    return true;
  },
  setOptions: jest.fn(),
}));
jest.mock('expo-web-browser', () => ({ maybeCompleteAuthSession: jest.fn() }));
jest.mock('~/components/ui/modal', () => ({
  AccessibleSheetProvider: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock('~/components/ui/use-theme-config', () => ({
  useThemeConfig: () => require('@react-navigation/native').DefaultTheme,
}));
jest.mock('~/features/app-update/client-too-old-modal', () => ({ ClientTooOldModal: () => null }));
jest.mock('~/features/auth/use-auth-store', () => {
  const state = { status: 'signIn', checking: false, navigationKey: 0 };
  return {
    hydrateAuth: jest.fn().mockResolvedValue(undefined),
    useAuthStore: {
      getState: () => state,
      use: { status: () => state.status, checking: () => state.checking, navigationKey: () => state.navigationKey },
    },
  };
});
jest.mock('~/features/billing/store-transaction-observer', () => ({ StoreTransactionObserver: () => null }));
jest.mock('~/features/feedback/feedback-bubble', () => ({ FeedbackBubble: () => null }));
jest.mock('~/features/feedback/feedback-store', () => ({ installConsoleCapture: jest.fn() }));
// Som den rigtige APIProvider: auth-tjekket starter, når netværksstatus kendes ved montering.
jest.mock('~/lib/api', () => ({
  APIProvider: ({ children, onNetworkReady }: { children: React.ReactNode; onNetworkReady: (retry: boolean) => Promise<unknown> }) => {
    require('react').useEffect(() => {
      void onNetworkReady(false);
    }, [onNetworkReady]);
    return children;
  },
}));
jest.mock('~/lib/auth/deep-link', () => ({ subscribeAuthDeepLinks: () => jest.fn() }));
jest.mock('~/lib/monitoring', () => ({ captureError: jest.fn(), initMonitoring: jest.fn() }));
jest.mock('~/lib/storage', () => ({ storage: { getString: jest.fn() } }));
jest.mock('react-native-flash-message', () => () => null);
jest.mock('react-native-gesture-handler', () => ({ GestureHandlerRootView: require('react-native').View }));
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaInsetsContext: require('react').createContext(null),
  useSafeAreaInsets: () => ({ top: 0 }),
}));
jest.mock('uniwind', () => ({ Uniwind: { setTheme: jest.fn() } }));

function mockNativeSplash(): { held: boolean; hide: jest.Mock; preventError?: Error } {
  return require('expo').requireOptionalNativeModule('ExpoSplashScreen');
}

beforeAll(async () => {
  await i18n.init({ resources, lng: 'da' });
});

beforeEach(() => {
  jest.clearAllMocks();
  // React logs caught errors in development even when the boundary handles them.
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

it('frigiver en fastholdt splash ved auth-fejl før layout og genstarter auth ved genforsøg', async () => {
  const error = new Error('SecureStore utilgængelig');
  jest.mocked(hydrateAuth).mockRejectedValueOnce(error);
  expect(mockNativeSplash().held).toBe(true);

  await renderAsync(<Try catch={ErrorBoundary}><RootLayout /></Try>);

  expect(mockNativeSplash().hide).toHaveBeenCalled();
  expect(mockNativeSplash().held).toBe(false);
  expect(captureError).toHaveBeenCalledWith(error);
  expect(screen.queryByText(error.message)).toBeNull();

  fireEvent.press(screen.getByRole('button'));
  expect(await screen.findByText('TimeTrack klar')).toBeOnTheScreen();
  expect(hydrateAuth).toHaveBeenCalledTimes(2);
});

it('håndterer afvisning ved forsøg på at fastholde splash', async () => {
  jest.isolateModules(() => {
    const splash = mockNativeSplash();
    splash.preventError = new Error('Splash unavailable');
    require('~/app/_layout');
    expect(splash.held).toBe(false);
  });
  await Promise.resolve();
});

it('viser fejlskærmen ved tema-init-fejl og læser temaet igen ved genforsøg', async () => {
  const error = new Error('Tema kunne ikke indlæses');
  jest.mocked(storage.getString)
    .mockImplementationOnce(() => { throw error; })
    .mockReturnValueOnce('dark');

  await renderAsync(<Try catch={ErrorBoundary}><RootLayout /></Try>);

  expect(captureError).toHaveBeenCalledWith(error);
  expect(screen.queryByText(error.message)).toBeNull();
  fireEvent.press(screen.getByRole('button'));
  expect(await screen.findByText('TimeTrack klar')).toBeOnTheScreen();
  expect(Uniwind.setTheme).toHaveBeenCalledWith('dark');
});

it('starter med systemtema ved en ukendt gemt temaværdi', async () => {
  jest.mocked(storage.getString).mockReturnValueOnce('udgået-tema');

  await renderAsync(<Try catch={ErrorBoundary}><RootLayout /></Try>);

  expect(Uniwind.setTheme).toHaveBeenCalledWith('system');
  expect(screen.getByText('TimeTrack klar')).toBeOnTheScreen();
});

it.each([
  ['da', 'Prøv igen', 'Appen kunne ikke indlæses. Prøv igen.'],
  ['en', 'Try again', 'The app couldn’t load. Please try again.'],
  ['de', 'Erneut versuchen', 'Die App konnte nicht geladen werden. Bitte versuche es erneut.'],
  ['es', 'Reintentar', 'No se pudo cargar la aplicación. Inténtalo de nuevo.'],
] as const)('viser lokaliseret fejl og genforsøg på %s uden appens providers', async (language, retry, message) => {
  await i18n.changeLanguage(language);
  const error = new Error('Intern exception');
  let shouldFail = true;
  function Route() {
    if (shouldFail)
      throw error;
    return <Text>TimeTrack klar</Text>;
  }

  render(<Try catch={ErrorBoundary}><Route /></Try>);

  expect(screen.queryByText(error.message)).toBeNull();
  expect(screen.getByRole('alert')).toHaveTextContent(message);
  const button = screen.getByRole('button', { name: retry });
  expect(captureError).toHaveBeenCalledTimes(1);
  shouldFail = false;
  fireEvent.press(button);
  expect(screen.getByText('TimeTrack klar')).toBeOnTheScreen();
});

it('rapporterer en ny renderfejl efter genforsøg og undgår dubletter for samme fejl', () => {
  const first = new Error('Første fejl');
  const second = new Error('Anden fejl');
  let error = first;
  function Route(): never {
    throw error;
  }

  render(<Try catch={ErrorBoundary}><Route /></Try>);
  fireEvent.press(screen.getByRole('button'));
  expect(captureError).toHaveBeenCalledTimes(1);

  error = second;
  fireEvent.press(screen.getByRole('button'));
  expect(screen.getByRole('button')).toBeOnTheScreen();
  expect(captureError).toHaveBeenCalledTimes(2);
  expect(captureError).toHaveBeenLastCalledWith(second);
});
