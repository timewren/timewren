import { renderHook } from '@testing-library/react-native';
import { isOffline } from '~/features/offline/enqueue';
import { useCopyWeek } from './use-copy-week';

jest.mock('~/features/offline/enqueue', () => ({ isOffline: jest.fn(() => false) }));
jest.mock('~/lib/notify', () => ({ announce: jest.fn(), showMessage: jest.fn() }));
jest.mock('~/lib/i18n', () => ({ translate: (key: string, vars?: Record<string, string>) => (vars ? `${key}(${vars.count})` : key) }));
jest.mock('~/lib/api', () => ({
  errorMessage: (e: unknown) => (e as Error)?.message ?? 'fejl',
  trpc: {
    useUtils: () => ({
      time: { invalidate: jest.fn() },
      prepaid: { invalidate: jest.fn() },
      dashboard: { invalidate: jest.fn() },
      timerSync: { invalidate: jest.fn() },
    }),
    time: {
      copyWeek: {
        useMutation: (opts: { onError?: (e: unknown) => void } = {}) => ({
          isPending: false,
          mutateAsync: async (input: { targetWeekStart: string }) => {
            try {
              return await mockCopyWeek(input);
            }
            catch (error) {
              opts.onError?.(error);
              throw error;
            }
          },
        }),
      },
    },
  },
}));

const mockCopyWeek = jest.fn(async (_input: { targetWeekStart: string }) => ({ count: 3 }));
const copyWeek = mockCopyWeek as jest.Mock;

/** En tirsdag i en uge, så `weekRange` finder mandagen i samme uge. */
const TIRSDAG = new Date('2026-10-07T10:00:00');

function week() {
  return renderHook(() => useCopyWeek(TIRSDAG));
}

/** `run()` er ildende; kald den igen først når løftet er helt færdigt. */
async function flush() {
  for (let i = 0; i < 5; i++)
    await Promise.resolve();
}

beforeEach(() => {
  jest.clearAllMocks();
  (isOffline as jest.Mock).mockReturnValue(false);
  copyWeek.mockImplementation(async () => ({ count: 3 }));
});

/**
 * `copyWeek` læser kildeugen på serveren og danner nye poster — to kald er to
 * ugers dobbeltregistrerede timer. Der er ingen kø at genforsøge i, så låsen er
 * eneste beskyttelse.
 */
describe('copyWeek låser et dobbelttryk', () => {
  it('sender kun ét kald pr. uge', () => {
    const { result } = week();
    result.current.run();
    result.current.run();
    expect(copyWeek).toHaveBeenCalledTimes(1);
  });

  it('sender det til målugen, ikke dagens dato', () => {
    const { result } = week();
    result.current.run();
    expect(copyWeek).toHaveBeenCalledWith({ targetWeekStart: '2026-10-05' });
  });

  it('lader en ny uge kopieres, selv mens den første er i gang', () => {
    const { result } = week();
    result.current.run();
    renderHook(() => useCopyWeek(new Date('2026-10-14T10:00:00'))).result.current.run();
    expect(copyWeek).toHaveBeenCalledTimes(2);
  });

  it('sender igen, når den første uge er kopieret færdig', async () => {
    const { result } = week();
    result.current.run();
    await flush();
    result.current.run();
    expect(copyWeek).toHaveBeenCalledTimes(2);
  });

  it('kører slet ikke serveren uden net', () => {
    (isOffline as jest.Mock).mockReturnValue(true);
    const { result } = week();
    result.current.run();
    expect(copyWeek).not.toHaveBeenCalled();
  });
});
