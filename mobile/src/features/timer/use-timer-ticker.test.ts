import { act, renderHook } from '@testing-library/react-native';
import { AppState } from 'react-native';
import { useTimerTicker } from './use-timer-ticker';

/**
 * Tickeren får `timer-card` og `local-timer-card` til at male forløbet tid.
 * Den skal derfor tælle videre, så længe appen er i forgrunden, og den må
 * ALDRIG stoppe med at tælle: en stående tæller er tabt tid på skærmen.
 */

let mockFocused = true;

jest.mock('@react-navigation/native', () => ({
  useIsFocused: () => mockFocused,
}));

function setAppState(state: 'active' | 'background') {
  act(() => {
    // @ts-expect-error — AppState-listernere er typet any i RN's mock
    AppState.__listeners?.forEach((cb: (s: string) => void) => cb(state));
  });
}

describe('useTimerTicker', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-09-30T12:00:00Z'));
    mockFocused = true;
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('tæller forløbet tid op hvert sekund', () => {
    const start = '2026-09-30T14:00:00+02:00';
    const { result } = renderHook(() => useTimerTicker(start, 0));
    expect(result.current).toBe(0);

    act(() => {
      jest.advanceTimersByTime(5000);
    });

    // 5 sekunder efter kl. 14:00:00 dansk tid.
    expect(result.current).toBe(5);
  });

  it('lægger pausesummen oveni', () => {
    const start = '2026-09-30T14:00:00+02:00';
    const { result } = renderHook(() => useTimerTicker(start, 120));
    act(() => {
      jest.advanceTimersByTime(3000);
    });
    expect(result.current).toBe(123);
  });

  it('returnerer 0 uden starttidspunkt', () => {
    const { result } = renderHook(() => useTimerTicker(null, 90));
    act(() => {
      jest.advanceTimersByTime(5000);
    });
    expect(result.current).toBe(0);
  });

  it('tæller videre efter at have været i baggrunden', () => {
    const start = '2026-09-30T14:00:00+02:00';
    const { result } = renderHook(() => useTimerTicker(start, 0));
    act(() => {
      jest.advanceTimersByTime(2000);
    });
    expect(result.current).toBe(2);

    setAppState('background');
    act(() => {
      jest.advanceTimersByTime(60000);
    });
    // Tiden udledes altid af startTime, så en pause i baggrunden giver intet
    // spring: 2 s før + 60 s baggrund = 62 s, ikke 2 og slet ikke 2 + 60 tik.
    expect(result.current).toBe(62);

    setAppState('active');
    act(() => {
      jest.advanceTimersByTime(3000);
    });
    expect(result.current).toBe(65);
  });

  it('standser intervallet ved unmount', () => {
    const clearSpy = jest.spyOn(globalThis, 'clearInterval');
    const { unmount } = renderHook(() => useTimerTicker('2026-09-30T14:00:00+02:00', 0));
    unmount();
    expect(clearSpy).toHaveBeenCalled();
  });
});
