import { AccessibilityInfo } from 'react-native';
import i18n from '~/lib/i18n';
import { cleanup, render } from '~/lib/test-utils';
import { LogCallScreen } from './log-call-screen';

/**
 * `log-call-screen` har to kalde og en `ListSkeleton`, men sagde ingenting —
 * CI-porten i `notify.test.ts` (`kalder useReportLoad på hver skærm OG
 * komponent med et kald og en pladsholder`) faldt over præcis den fil, da
 * den blev tilføjet.
 *
 * Det er ikke kun en kilde-fejl: skærmen løber en skeleton, mens kundelisten
 * og de seneste opgaver hentes, og skifter så *hele overfladen* til
 * `NewEntryScreen`. En skærmlæser hørte intet i det skifte.
 *
 * Her løber den ægte kæde: `LogCallForm` → `useReportLoad` → `ScreenLoad` →
 * `useLoadAnnounce` → `announceForAccessibility`.
 */

const mockClients = jest.fn();
const mockRecent = jest.fn();

jest.mock('~/lib/api', () => ({
  errorMessage: (error: unknown) => jest.requireActual('~/lib/api/trpc').errorMessage(error),
  trpc: {
    clients: { list: { useQuery: () => mockClients() } },
  },
}));

jest.mock('~/features/home/use-recent-tasks', () => ({ useRecentTasks: () => mockRecent() }));

jest.mock('expo-router', () => ({
  Redirect: () => null,
  useLocalSearchParams: () => ({ minutter: '12', telefon: '+4512345678' }),
  useRouter: () => ({ replace: jest.fn(), back: jest.fn(), push: jest.fn() }),
}));

jest.mock('~/features/auth/use-auth-store', () => ({ useAuthStore: { use: { status: () => 'signIn' } } }));

// Formularen er et helt skærmbillede med egne kalde; her dømmes kun skærmens stop.
jest.mock('~/features/entries/new-entry-screen', () => ({ NewEntryScreen: () => null }));

jest.mock('~/features/calls/call-settings', () => ({ isCallLoggingEnabled: () => true }));

const spoken = AccessibilityInfo.announceForAccessibility as jest.Mock;
const LOADED = i18n.t('common.loaded');

function laver(fejl = false) {
  return { data: undefined, isLoading: true, isError: fejl, error: null, refetch: jest.fn() };
}

function klar(data: unknown = []) {
  return { data, isLoading: false, isError: false, error: null, refetch: jest.fn() };
}

afterEach(() => {
  cleanup();
  jest.clearAllMocks();
});

describe('opkaldsskærmens stop', () => {
  it('læser "indlæst" når skeleton forsvinder', () => {
    mockClients.mockReturnValue(laver());
    mockRecent.mockReturnValue(laver());
    const view = render(<LogCallScreen />);
    expect(spoken).not.toHaveBeenCalledWith(LOADED);

    mockClients.mockReturnValue(klar());
    mockRecent.mockReturnValue(klar());
    view.rerender(<LogCallScreen />);

    expect(spoken).toHaveBeenCalledWith(LOADED);
  });

  it('læser den kun ÉN gang for to kalde', () => {
    mockClients.mockReturnValue(laver());
    mockRecent.mockReturnValue(laver());
    const view = render(<LogCallScreen />);

    mockClients.mockReturnValue(klar());
    view.rerender(<LogCallScreen />);
    expect(spoken).not.toHaveBeenCalledWith(LOADED);

    mockRecent.mockReturnValue(klar());
    view.rerender(<LogCallScreen />);
    expect(spoken).toHaveBeenCalledTimes(1);
  });

  it('tier når ingen af kaldenes leverede', () => {
    // Begge fejler med det samme: skærmen ventede aldrig på en skeleton, så
    // "indlæst" ville være en løgn om data der ikke kom.
    mockClients.mockReturnValue(laver());
    mockRecent.mockReturnValue(laver());
    const view = render(<LogCallScreen />);

    mockClients.mockReturnValue({ data: undefined, isLoading: false, isError: true, error: null, refetch: jest.fn() });
    mockRecent.mockReturnValue({ data: undefined, isLoading: false, isError: true, error: null, refetch: jest.fn() });
    view.rerender(<LogCallScreen />);

    expect(spoken).not.toHaveBeenCalledWith(LOADED);
  });

  it('taler når ét kald fejler og det andet leverer', () => {
    // Ét fejlet hjørne skal ikke gøre hele skærmen lydløs — den region har sin
    // egen fejl, og skærmen skal stadig sige at resten kom.
    mockClients.mockReturnValue(laver());
    mockRecent.mockReturnValue(laver());
    const view = render(<LogCallScreen />);

    mockClients.mockReturnValue({ data: undefined, isLoading: false, isError: true, error: null, refetch: jest.fn() });
    mockRecent.mockReturnValue(klar());
    view.rerender(<LogCallScreen />);

    expect(spoken).toHaveBeenCalledWith(LOADED);
  });
});
