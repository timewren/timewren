import { renderHook } from '@testing-library/react-native';
import { isOffline } from '~/features/offline/enqueue';
import { showMessage } from '~/lib/notify';
import { useEntryActions } from './use-entries';

jest.mock('~/features/offline/enqueue', () => ({ isOffline: jest.fn(() => false) }));
jest.mock('~/features/offline/run-or-queue', () => ({
  runOrQueue: jest.fn(async () => ({ kind: 'sent' })),
}));
jest.mock('~/lib/notify', () => ({ announce: jest.fn(), showMessage: jest.fn() }));
jest.mock('~/lib/i18n', () => ({ translate: (key: string) => key }));
jest.mock('~/lib/api', () => ({
  errorMessage: (e: unknown) => (e as Error)?.message ?? 'fejl',
  trpc: {
    useUtils: () => ({
      time: { invalidate: jest.fn() },
      prepaid: { invalidate: jest.fn() },
      dashboard: { invalidate: jest.fn() },
      timerSync: { invalidate: jest.fn() },
      invoices: { invalidate: jest.fn() },
    }),
    time: {
      delete: { useMutation: () => ({ mutateAsync: jest.fn() }) },
      // Som rigtigt `useMutation`: `mutateAsync` afviser, OG kalderoptionens
      // `onError` — det er den der viser beskeden i appen.
      duplicate: {
        useMutation: (opts: { onError?: (e: unknown) => void } = {}) => ({
          isPending: false,
          mutateAsync: async (input: { id: string }) => {
            try {
              return await mockDuplicate(input);
            }
            catch (error) {
              opts.onError?.(error);
              throw error;
            }
          },
        }),
      },
      toggleBillable: { useMutation: () => ({ mutateAsync: jest.fn() }) },
      bulkMarkBilled: {
        useMutation: (opts: { onError?: (e: unknown) => void } = {}) => ({
          isPending: false,
          // Som rigtigt `useMutation`: afviser OG kalder `onError` — det er den
          // der viser beskeden i appen.
          mutateAsync: async (input: { ids: string[]; isBilled: boolean }) => {
            try {
              return await mockBulkMarkBilled(input);
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

const mockBulkMarkBilled = jest.fn(async (_input: { ids: string[]; isBilled: boolean }) => ({ success: true, count: 1 }));

const mockDuplicate = jest.fn(async (_input: { id: string }) => ({ id: 'ny' }));
const duplicate = mockDuplicate as jest.Mock;

function actions() {
  return renderHook(() => useEntryActions());
}

beforeEach(() => {
  jest.clearAllMocks();
  (isOffline as jest.Mock).mockReturnValue(false);
  duplicate.mockImplementation(async () => ({ id: 'ny' }));
});

/**
 * Dobbelttrykket kommer fra handlingsarket, der lukker *efter* trykket — så de to
 * kald kommer i samme tick. Serveren danner en ny post pr. kald, så to kald er
 * to tidsposter.
 */
describe('duplicate låser et dobbelttryk', () => {
  it('sender kun ét kald, selv om der trykkes to gange', async () => {
    const { result } = actions();
    await Promise.all([
      result.current.duplicate('p1'),
      result.current.duplicate('p1'),
    ]);
    expect(duplicate).toHaveBeenCalledTimes(1);
  });

  it('lader to forskellige poster duplikeres sideløbs', async () => {
    const { result } = actions();
    await Promise.all([
      result.current.duplicate('p1'),
      result.current.duplicate('p2'),
    ]);
    expect(duplicate).toHaveBeenCalledTimes(2);
  });

  it('lader den samme post duplikeres igen, når det første kald er færdigt', async () => {
    const { result } = actions();
    await result.current.duplicate('p1');
    await result.current.duplicate('p1');
    expect(duplicate).toHaveBeenCalledTimes(2);
  });

  it('låser op igen når kallet fejlede', async () => {
    duplicate.mockRejectedValueOnce(new Error('net'));
    const { result } = actions();
    await result.current.duplicate('p1');
    await result.current.duplicate('p1');
    expect(duplicate).toHaveBeenCalledTimes(2);
  });

  it('kalder kun `onDone` for det kald, der fik låsen', async () => {
    const onDone = jest.fn();
    const { result } = actions();
    await Promise.all([
      result.current.duplicate('p1', onDone),
      result.current.duplicate('p1', onDone),
    ]);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('melder fejlen pr. kald, ikke to gange', async () => {
    duplicate.mockRejectedValue(new Error('net'));
    const { result } = actions();
    await Promise.all([
      result.current.duplicate('p1'),
      result.current.duplicate('p1'),
    ]);
    expect(showMessage).toHaveBeenCalledTimes(1);
  });

  it('kører slet ikke serveren uden net', () => {
    (isOffline as jest.Mock).mockReturnValue(true);
    const { result } = actions();
    result.current.duplicate('p1');
    expect(duplicate).not.toHaveBeenCalled();
  });
});

/**
 * `time.bulkMarkBilled` sætter `isBilled` uden en fakturalinje — altså den
 * mutation der bryder web's egen invariant `isBilled ⟺ fakturalinje`. Det er
 * dog præcis web's egen handling fra Tid-siden ("Markér som faktureret"), og
 * konsekvensen er den ønskede: posten udgår af `getUninvoicedTimeEntries`, så
 * den ikke kan faktureres to gange.
 *
 * Derfor må den ikke ligge i offline-køen: kø-inputtet er bare `{ id, isBilled }`,
 * så dræningen kan ikke rekonstruere mutationen, og et kø-element ville stå og
 * lyve om en post, der faktisk står på en faktura. Samme regel som `duplicate`
 * og `copyWeek`.
 */
describe('setBilled', () => {
  it('sender pr. post og kun dens eget id', async () => {
    const { result } = actions();
    await result.current.setBilled('e1', true);
    expect(mockBulkMarkBilled).toHaveBeenCalledWith({ ids: ['e1'], isBilled: true });
  });

  it('låser et dobbelttryk på samme post', async () => {
    // Mutationen er idempotent, så to kald er ikke skadelige — men de ville
    // give to kvitteringer, for et dobbelttryk i samme tick.
    const { result } = actions();
    await Promise.all([
      result.current.setBilled('e1', true),
      result.current.setBilled('e1', true),
    ]);
    expect(mockBulkMarkBilled).toHaveBeenCalledTimes(1);
  });

  it('lader to forskellige poster markeres sideløbs', async () => {
    const { result } = actions();
    await Promise.all([
      result.current.setBilled('e1', true),
      result.current.setBilled('e2', true),
    ]);
    expect(mockBulkMarkBilled).toHaveBeenCalledTimes(2);
  });

  it('låser op igen når kallet fejlede', async () => {
    mockBulkMarkBilled.mockRejectedValueOnce(new Error('net'));
    const { result } = actions();
    await result.current.setBilled('e1', true);
    await result.current.setBilled('e1', true);
    expect(mockBulkMarkBilled).toHaveBeenCalledTimes(2);
  });

  it('melder fejlen pr. kald, ikke to gange', async () => {
    mockBulkMarkBilled.mockRejectedValue(new Error('net'));
    const { result } = actions();
    await Promise.all([
      result.current.setBilled('e1', true),
      result.current.setBilled('e1', true),
    ]);
    expect(showMessage).toHaveBeenCalledTimes(1);
  });

  it('kører slet ikke serveren uden net', () => {
    (isOffline as jest.Mock).mockReturnValue(true);
    const { result } = actions();
    result.current.setBilled('e1', true);
    expect(mockBulkMarkBilled).not.toHaveBeenCalled();
  });
});
