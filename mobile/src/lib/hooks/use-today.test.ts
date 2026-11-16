import { act, renderHook } from '@testing-library/react-native';
import { AppState } from 'react-native';
import { useCurrentYear, useToday } from './use-today';

/**
 * `useToday` skal være stabil gennem dagen og skifte præcis ved midnat.
 * Det var den gamle form (`toISODate(new Date())` under render, eller memoet
 * med tom afhængighedsliste) ikke: en telefon der lå på bordet over natten
 * viste gårsdagens dato — og på to skærme stod den i en query-nøgle.
 */

type Listener = (state: string) => void;

const listeners: Listener[] = [];

/** Vi lytter på den ægte AppState (jest-expo's RN-mock) i stedet for at mocke modulet væk. */
function spyOnAppState() {
  return jest
    .spyOn(AppState, 'addEventListener')
    .mockImplementation((_type, cb) => {
      const listener = cb as unknown as Listener;
      listeners.push(listener);
      return { remove: () => listeners.splice(listeners.indexOf(listener), 1) } as never;
    });
}

function emitAppState(state: string) {
  act(() => {
    listeners.forEach(cb => cb(state));
  });
}

function setSystemTime(iso: string) {
  jest.setSystemTime(new Date(iso));
}

describe('useToday', () => {
  const realNow = Date.now;

  beforeEach(() => {
    jest.useFakeTimers();
    setSystemTime('2026-09-30T21:35:00');
    listeners.length = 0;
    spyOnAppState();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
    Date.now = realNow;
  });

  it('giver dagens ISO-dato ved montering', () => {
    const { result } = renderHook(() => useToday());
    expect(result.current).toBe('2026-09-30');
  });

  it('skifter dato når uret passerer midnat, selv uden et render i mellem', () => {
    const { result } = renderHook(() => useToday());
    expect(result.current).toBe('2026-09-30');

    // Telefonen lå slukket/screenet hele natten: intet har rendet siden 21:35.
    act(() => {
      jest.advanceTimersByTime(3 * 60 * 60 * 1000);
    });

    expect(result.current).toBe('2026-10-01');
  });

  it('genlæser dagen når appen bliver aktiv igen (iOS dræber baggrundstimere)', () => {
    const { result } = renderHook(() => useToday());
    expect(result.current).toBe('2026-09-30');

    // Appen gik i baggrunden før midnat og blev sendt i forgrunden efter.
    setSystemTime('2026-10-01T09:00:00');
    emitAppState('active');

    expect(result.current).toBe('2026-10-01');
  });

  it('beholder dagen ved baggrund→forgrund samme dage', () => {
    const { result } = renderHook(() => useToday());
    emitAppState('background');
    emitAppState('active');
    expect(result.current).toBe('2026-09-30');
  });

  it('rydder både timeren og abonnenten ved unmount', () => {
    const clearSpy = jest.spyOn(globalThis, 'clearTimeout');
    const { unmount } = renderHook(() => useToday());
    expect(listeners).toHaveLength(1);

    unmount();

    expect(clearSpy).toHaveBeenCalled();
    expect(listeners).toHaveLength(0);
  });
});

describe('useCurrentYear', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    setSystemTime('2026-12-31T23:59:30');
    listeners.length = 0;
    spyOnAppState();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('følger årsskiftet med', () => {
    const { result } = renderHook(() => useCurrentYear());
    expect(result.current).toBe(2026);

    act(() => {
      jest.advanceTimersByTime(60 * 1000);
    });

    expect(result.current).toBe(2027);
  });
});
