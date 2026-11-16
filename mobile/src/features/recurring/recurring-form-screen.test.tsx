import * as React from 'react';
import i18n from '~/lib/i18n';
import { cleanup, fireEvent, screen, setup, waitFor } from '~/lib/test-utils';
import { RecurringFormScreen } from './recurring-form-screen';

/**
 * F11 del 4: en skabelon brugeren **netop har lavet** skal kunne registreres
 * med det samme.
 *
 * Før denne tilstand gik vejen gennem katalogens «Klar nu»-liste, og den har
 * kun de skabeloner cron'ens `getPending` er nået til (`nextDue <= now`). En
 * skabelon med startdato i morgen stod der ikke, så tiden kunne slet ikke lægges
 * ind fra telefonen — den måtte vente på næste kørsel.
 */

const mockCreate = jest.fn();
const mockGenerate = jest.fn();
const mockInvalidate = jest.fn();
const mockToast = jest.fn();
const mockBack = jest.fn();

/** Det `create` svarer: serverens egen række, som `generate` så læser. */
function gemtRække(partial: Record<string, unknown> = {}) {
  return {
    id: 't-ny',
    name: 'Mandag support',
    hours: '6',
    templateType: 'time_entry',
    isPrepaid: false,
    frequency: 'weekly',
    ...partial,
  };
}

const query = (data: unknown = null) => ({ data, isLoading: false, isError: false, error: null, refetch: jest.fn() });

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({}),
  useRouter: () => ({ back: mockBack, push: jest.fn() }),
}));

jest.mock('~/lib/api', () => ({
  errorMessage: (error: unknown) => (error as Error)?.message ?? 'fejl',
  trpc: {
    useUtils: () => ({ recurring: { invalidate: mockInvalidate } }),
    clients: { list: { useQuery: () => query([{ id: 'c1', name: 'Acme' }]) } },
    projects: { list: { useQuery: () => query([]) } },
    prepaid: { list: { useQuery: () => query([]) } },
    recurring: {
      create: { useMutation: () => ({ mutateAsync: mockCreate, isPending: false }) },
      update: { useMutation: () => ({ mutateAsync: jest.fn(), isPending: false }) },
      generate: { useMutation: () => ({ mutateAsync: mockGenerate }) },
      getById: { useQuery: () => query(undefined) },
      list: { useQuery: () => query([]) },
    },
  },
}));

jest.mock('~/features/entries/use-entries', () => ({ useInvalidateEntries: () => mockInvalidate }));

jest.mock('~/features/capabilities/use-capabilities', () => ({ useCapabilities: () => ({ isEnabled: () => false }) }));

jest.mock('~/lib/notify', () => ({
  showMessage: (...args: unknown[]) => mockToast(...args),
  useReportLoad: () => {},
}));

/** Udfyld de felter `validateRecurring` kræver, og tryk «Opret skabelon». */
async function opret(engang = false) {
  const { user } = setup(<RecurringFormScreen />);
  fireEvent.changeText(screen.getByTestId('recurring-name'), 'Mandag support');
  fireEvent.changeText(screen.getByTestId('recurring-description'), 'Support hos Acme');
  fireEvent.changeText(screen.getByTestId('recurring-hours'), '6');
  await user.press(screen.getByTestId('recurring-client-trigger'));
  await user.press(screen.getByTestId('recurring-client-item-c1'));
  if (engang) {
    await user.press(screen.getByTestId('recurring-frequency-trigger'));
    await user.press(screen.getByTestId('recurring-frequency-item-none'));
  }
  await user.press(screen.getByTestId('recurring-submit'));
  await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1));
}

beforeEach(async () => {
  // Skærmen er dansk, og den tekst der dømmes, er dansk.
  await i18n.changeLanguage('da');
  // Som serveren: den gemte række spejler det, der blev sendt.
  mockCreate.mockReset().mockImplementation(async (input: { frequency?: string | null }) => gemtRække({ frequency: input.frequency ?? null }));
  mockGenerate.mockReset().mockResolvedValue({ id: 'e1' });
  mockInvalidate.mockReset();
  mockToast.mockReset();
  mockBack.mockReset();
});

afterEach(cleanup);

describe('den netop gemte skabelon', () => {
  it('bliver stående på skærmen i stedet for at lukke den', async () => {
    await opret();

    expect(screen.getByTestId('recurring-saved')).toBeOnTheScreen();
    expect(mockBack).not.toHaveBeenCalled();
  });

  it('kan registreres med det samme, uden at gå tilbage til katalogen', async () => {
    await opret();

    fireEvent.press(screen.getByTestId('recurring-saved-generate'));

    await waitFor(() => expect(mockGenerate).toHaveBeenCalledWith({ templateId: 't-ny' }));
    expect(screen.getByTestId('recurring-saved-generate')).toBeOnTheScreen();
  });

  it('låser genereringen, så to tryk giver én registrering', async () => {
    // `generate` er ikke idempotent: hvert kald indsætter en ny tidspost.
    await opret();

    fireEvent.press(screen.getByTestId('recurring-saved-generate'));
    fireEvent.press(screen.getByTestId('recurring-saved-generate'));

    await waitFor(() => expect(mockToast).toHaveBeenCalled());
    expect(mockGenerate).toHaveBeenCalledTimes(1);
  });

  it('tilbyder ikke «Registrér nu» til en skabelon der også opretter en opgave', async () => {
    mockCreate.mockResolvedValue(gemtRække({ templateType: 'both' }));
    await opret();

    expect(screen.queryByTestId('recurring-saved-generate')).toBeNull();
    expect(screen.getByText(/opretter også en opgave/)).toBeOnTheScreen();
  });

  it('går tilbage til katalogen på den anden knap', async () => {
    await opret();

    fireEvent.press(screen.getByTestId('recurring-saved-back'));

    expect(mockBack).toHaveBeenCalled();
  });

  it('lover ikke en automatisk kørsel på en engangsklage', async () => {
    // Cron'en kræver `isNotNull(frequency)` (cron'en:78), så en engangsklage løber
    // aldrig af sig selv. Skærmen skal ikke sige det modsatte.
    await opret(true);

    expect(screen.getByText(/løber ikke automatisk/)).toBeOnTheScreen();
    expect(screen.queryByText(/næste gang rykkes frem/)).toBeNull();
  });

  it('siger på en gentagende skabelone, at næste gang rykkes frem', async () => {
    await opret();

    expect(screen.getByText(/næste gang rykkes frem/)).toBeOnTheScreen();
  });
});
