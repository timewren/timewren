import { act } from '@testing-library/react-native';
import * as React from 'react';
import { AppState } from 'react-native';
import { cleanupAsync, render } from '~/lib/test-utils';
import { FlexScreen } from './flex-screen';

/**
 * Flexsaldoen spørger serveren «saldo pr. dato» (`asOf`), og serveren bruger
 * præmissen ægte: `lte(flexEntries.date, asOf)` og
 * `getEarnedOvertimeByUser({ end: asOf })` i `web/…/enterprise/flex.ts`.
 *
 * Dagen lå derfor frosset fra montering (`useMemo(() => toISODate(new Date()),
 * [])`), hvilket er usynligt indtil klokken bliver 00:05: skærmen stod med
 * gårsdagens saldo, og pull-to-refresh hjalp ikke, fordi `onRefresh` kørte
 * det *samme* `asOf` igen — nøglen havde ikke ændret sig. Det er samme fejl
 * som de tolv andre steder `5b45045` rettede, og som eneste af dem havde den
 * sin egen test.
 */

const mockBalanceCalls: { asOf: string }[] = [];

jest.mock('~/lib/api', () => ({
  errorMessage: (error: unknown) => jest.requireActual('~/lib/api/trpc').errorMessage(error),
  trpc: {
    enterprise: {
      getBalance: {
        useQuery: (input: { asOf: string }) => {
          mockBalanceCalls.push(input);
          return { data: { balance: 12, entries: [] }, isLoading: false, isError: false, error: null, refetch: jest.fn() };
        },
      },
      getEntries: { useQuery: () => ({ data: [], isLoading: false, isError: false, error: null, refetch: jest.fn() }) },
      getTeamBalances: { useQuery: () => ({ data: [], isLoading: false, isError: false, error: null, refetch: jest.fn() }) },
    },
    useUtils: () => ({ enterprise: { getTeamBalances: { invalidate: jest.fn() } } }),
  },
}));

jest.mock('~/features/capabilities/use-capabilities', () => ({
  useCapabilities: () => ({
    isLoading: false,
    isError: false,
    isEnterprise: true,
    isManager: false,
    isHr: false,
    isEnabled: () => true,
  }),
}));

jest.mock('expo-router', () => ({ useRouter: () => ({ back: jest.fn(), push: jest.fn() }) }));

function senesteAsOf() {
  return mockBalanceCalls.at(-1)?.asOf;
}

describe('flexsaldoens dato', () => {
  const realNow = Date.now;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-09-30T23:55:00'));
    mockBalanceCalls.length = 0;
  });

  afterEach(async () => {
    // Afmontér og vent på det, mens de falske timere stadig er slået til. Synkron
    // `cleanup()` afmonterer først efter `useRealTimers()`, og så rydder `StatusBar`
    // sin falske immediate med Nodes ægte `clearImmediate` (se jest-setup.ts).
    await cleanupAsync();
    jest.restoreAllMocks();
    jest.useRealTimers();
    Date.now = realNow;
  });

  it('spørger om dagens saldo, ikke en dato frosset fra montering', () => {
    render(<FlexScreen />);

    expect(senesteAsOf()).toBe('2026-09-30');
  });

  it('følger midnat, selv uden at brugeren rører skærmen', () => {
    render(<FlexScreen />);
    expect(senesteAsOf()).toBe('2026-09-30');

    // Telefonen lå på bordet: intet har rendet siden 23:55.
    act(() => {
      jest.advanceTimersByTime(10 * 60 * 1000);
    });

    // Uden `useToday` står den gamle kode stadig med 30/9 her, fordi `asOf`
    // lå i et memo med tom afhængighedsliste — og et refetch kørte den igen.
    expect(senesteAsOf()).toBe('2026-10-01');
  });

  it('genlæser dagen når appen bliver aktiv igen efter at have ligget i baggrunden', () => {
    const lyttere: ((state: string) => void)[] = [];
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, cb) => {
      lyttere.push(cb as unknown as (state: string) => void);
      return { remove: () => {} } as never;
    });

    render(<FlexScreen />);

    // Appen lå i baggrunden hele natten; iOS dræber baggrundstimere, så
    // `useToday` læser dagen igen, når appen bliver aktiv.
    jest.setSystemTime(new Date('2026-10-01T08:00:00'));
    act(() => {
      lyttere.forEach(cb => cb('active'));
    });

    expect(senesteAsOf()).toBe('2026-10-01');
  });
});
