import type { BottomSheetModal } from '@gorhom/bottom-sheet';
import * as React from 'react';
import { Alert, Pressable, Share } from 'react-native';
import i18n from '~/lib/i18n';
import { fireEvent, screen, setup, waitFor } from '~/lib/test-utils';
import { ShareReportSheet } from './share-report-sheet';

/**
 * Deling af en tidsrapport med et læse-link.
 *
 * Serverens `createShareLink` er **ikke** idempotent — hvert kald indsætter en
 * ny række med sit eget token — og `revokeShareLink` kaster `NOT_FOUND` på det
 * andet kald, fordi den kun matcher rækker med `revokedAt IS NULL`. Begge er
 * derfor låst, og det er disse tests der dømmer låsen.
 */

const mockCreate = jest.fn();
const mockRevoke = jest.fn();
const mockInvalidate = jest.fn();
const mockToast = jest.fn();
const mockRefetch = jest.fn();
const mockUseQuery = jest.fn();
let mockShare: jest.SpyInstance;

jest.mock('~/lib/api', () => ({
  errorMessage: (error: unknown) => (error as Error)?.message ?? 'fejl',
  trpc: {
    useUtils: () => ({ reports: { invalidate: mockInvalidate } }),
    reports: {
      listShareLinks: { useQuery: (...args: unknown[]) => {
        mockUseQuery(...args);
        return mockListState();
      } },
      createShareLink: { useMutation: () => ({ mutateAsync: mockCreate }) },
      revokeShareLink: { useMutation: () => ({ mutateAsync: mockRevoke }) },
    },
  },
}));

jest.mock('~/lib/notify', () => ({
  showMessage: (...args: unknown[]) => mockToast(...args),
  useAnnounceVisible: () => {},
}));

/** Det `createShareLink` svarer — samme felt som `listShareLinks` minus tællerne. */
function createdLink(partial: Record<string, unknown> = {}) {
  return {
    id: 'nyt-link',
    token: 'tok-nyt',
    url: 'https://app.timetrack.dk/r/tok-nyt',
    name: 'Tidsrapport Oktober 2026',
    lockedDates: true,
    ...partial,
  };
}

function listRow(partial: Record<string, unknown> = {}) {
  return {
    id: 'l1',
    token: 'tok-1',
    name: 'September — Acme',
    lockedDates: false,
    viewCount: 3,
    url: 'https://app.timetrack.dk/r/tok-1',
    createdAt: new Date('2026-09-30T09:00:00.000Z'),
    lastViewedAt: null,
    ...partial,
  };
}

/** `getReportData.period` — serverens egen opløsning af perioden. */
const PERIOD = { start: '2026-10-01', end: '2026-10-31' };
const CONFIG = { audience: 'internal', filters: { dateRange: 'thisMonth' }, grouping: 'none', columns: ['hours'], branding: {} };

function listState() {
  return { data: [] as unknown[], isLoading: false, isError: false, error: null as unknown, refetch: mockRefetch };
}

let mockListState: () => ReturnType<typeof listState> = listState;

/** Ark indeni testen: skærmen skal ellers lukke sit indhold, når intet presenterer. */
function Harness() {
  const ref = React.useRef<BottomSheetModal | null>(null);
  React.useEffect(() => {
    ref.current?.present();
  }, []);
  return (
    <>
      <Pressable testID="apn" onPress={() => ref.current?.present()} />
      <ShareReportSheet ref={ref} period={PERIOD} config={CONFIG as never} enabled />
    </>
  );
}

function LukketArk() {
  return <ShareReportSheet ref={React.useRef<BottomSheetModal | null>(null)} period={PERIOD} config={CONFIG as never} enabled={false} />;
}

beforeEach(async () => {
  // Skærmen er dansk, og den tekst der dømmes, er dansk.
  await i18n.changeLanguage('da');
  mockListState = listState;
  mockCreate.mockReset().mockResolvedValue(createdLink());
  mockRevoke.mockReset().mockResolvedValue({ success: true });
  mockInvalidate.mockReset();
  mockToast.mockReset();
  mockRefetch.mockReset();
  mockUseQuery.mockReset();
  // Spyen lægges på igen hver gang: `restoreAllMocks` i `afterEach` rydder den,
  // så en delt URL ellers ville åbne et rigtigt share-ark midt i en test.
  mockShare = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('et nyt delt link', () => {
  /**
   * Serveren får **præcis den config** rapporten viser og **præcis den URL** den
   * selv dannede. En URL vi satte sammen selv ville være den vores base-URL —
   * og den er ikke nødvendigvis web'ens `getAppUrl()`.
   */
  it('sender rapportens egen config og deler det link serveren returnerede', async () => {
    setup(<Harness />);

    fireEvent.press(screen.getByTestId('share-create'));

    await waitFor(() => expect(mockCreate).toHaveBeenCalledWith({
      config: CONFIG,
      name: 'Tidsrapport Oktober 2026',
      lockDates: true,
    }));
    expect(mockShare).toHaveBeenCalledWith(expect.objectContaining({
      message: expect.stringContaining('https://app.timetrack.dk/r/tok-nyt'),
    }));
  });

  it('sender det navn brugeren skrev, trimmet — ikke den forudfyldte standard', async () => {
    setup(<Harness />);

    fireEvent.changeText(screen.getByTestId('share-name'), '  Acme uge 41  ');
    fireEvent.press(screen.getByTestId('share-create'));

    await waitFor(() => expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ name: 'Acme uge 41' })));
  });

  it('sender lockDates: false når slået fra, fordi et ulåst link ruller perioden', async () => {
    setup(<Harness />);

    fireEvent.press(screen.getByTestId('share-lock-dates'));
    fireEvent.press(screen.getByTestId('share-create'));

    await waitFor(() => expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ lockDates: false })));
  });

  /**
   * Selve låsen dømmes i `use-share-link.test.tsx` — herfra kan RNTL ikke nå
   * den, fordi `Button` selv sætter `disabled` mens `loading`, og RNTL springer
   * tryk over på en deaktiveret knap. Det her er den synlige halvdel: knappen
   * låser, mens serveren ikke har svaret.
   */
  it('låser knappen, mens serveren ikke har svaret', async () => {
    let svar: (link: unknown) => void = () => {};
    mockCreate.mockImplementation(() => new Promise((resolve) => {
      svar = resolve;
    }));
    setup(<Harness />);

    fireEvent.press(screen.getByTestId('share-create'));

    await waitFor(() => expect(screen.getByTestId('share-create').props.accessibilityState.busy).toBe(true));
    expect(mockShare).not.toHaveBeenCalled();

    svar(createdLink());
    await waitFor(() => expect(screen.getByTestId('share-create').props.accessibilityState.busy).toBe(false));
  });

  it('melder en fejl og åbner intet share-ark, når serveren afviser', async () => {
    mockCreate.mockRejectedValueOnce(new Error('Navnet er allerede brugt') as never);
    setup(<Harness />);

    fireEvent.press(screen.getByTestId('share-create'));

    await waitFor(() => expect(mockToast).toHaveBeenCalledWith({ message: 'Navnet er allerede brugt', type: 'danger' }));
    expect(mockShare).not.toHaveBeenCalled();
  });

  it('genindlæser listen, så det nye link kan ses blandt de andre', async () => {
    setup(<Harness />);

    fireEvent.press(screen.getByTestId('share-create'));

    await waitFor(() => expect(mockInvalidate).toHaveBeenCalled());
  });
});

describe('de eksisterende links', () => {
  it('viser navn, om perioden er låst, og hvor mange gange den er set', async () => {
    mockListState = () => ({ ...listState(), data: [listRow({ lockedDates: true, viewCount: 1 })] });
    setup(<Harness />);

    expect(await screen.findByText('September — Acme')).toBeOnTheScreen();
    expect(screen.getByText(/Låste datoer · 1 visning$/)).toBeOnTheScreen();
  });

  it('deler det link der trykkes på, ikke det nyeste', async () => {
    mockListState = () => ({ ...listState(), data: [listRow()] });
    setup(<Harness />);

    fireEvent.press(await screen.findByTestId('share-send-l1'));

    await waitFor(() => expect(mockShare).toHaveBeenCalledWith(expect.objectContaining({
      message: expect.stringContaining('https://app.timetrack.dk/r/tok-1'),
    })));
  });

  it('spørger før et link tilbagekaldes, og først derefter kalder serveren', async () => {
    mockListState = () => ({ ...listState(), data: [listRow()] });
    const spion = jest.spyOn(Alert, 'alert');
    setup(<Harness />);

    fireEvent.press(await screen.findByTestId('share-revoke-l1'));

    expect(spion).toHaveBeenCalledWith(expect.any(String), expect.stringContaining('September — Acme'), expect.any(Array));
    expect(mockRevoke).not.toHaveBeenCalled();
  });

  it('tilbagekalder det link brugeren bekræfter, og kun det', async () => {
    mockListState = () => ({ ...listState(), data: [listRow(), listRow({ id: 'l2', name: 'August', url: 'https://app.timetrack.dk/r/tok-2' })] });
    const alert = jest.spyOn(Alert, 'alert');
    setup(<Harness />);

    fireEvent.press(await screen.findByTestId('share-revoke-l2'));
    const knapper = alert.mock.calls[0][2]!;
    knapper[1].onPress!();

    await waitFor(() => expect(mockRevoke).toHaveBeenCalledWith({ id: 'l2' }));
    expect(mockInvalidate).toHaveBeenCalled();
  });

  /**
   * Selve låsen dømmes i `use-share-link.test.tsx`. Herfra ses den synlige
   * halvdel: knappen for et link i gang er låst, så et tryk ikke kan sende det
   * kald igen og få `NOT_FOUND` til svar.
   */
  it('låser knappen på det link, der er ved at blive tilbagekaldt', async () => {
    mockListState = () => ({ ...listState(), data: [listRow(), listRow({ id: 'l2' })] });
    let svar: (v: unknown) => void = () => {};
    mockRevoke.mockImplementation(() => new Promise((resolve) => {
      svar = resolve;
    }));
    let knapper: { text?: string; onPress?: () => void }[] = [];
    jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => {
      knapper = buttons ?? [];
    });
    setup(<Harness />);

    fireEvent.press(await screen.findByTestId('share-revoke-l1'));
    knapper[1].onPress!();

    await waitFor(() => expect(screen.getByTestId('share-revoke-l1').props.accessibilityState.disabled).toBe(true));
    // Det andet link er ikke låst med — de må godt forsvinde samtidig.
    expect(screen.getByTestId('share-revoke-l2').props.accessibilityState.disabled).toBe(false);

    svar({ success: true });
    await waitFor(() => expect(screen.getByTestId('share-revoke-l1').props.accessibilityState.disabled).toBe(false));
  });
});

describe('arkets liste', () => {
  /**
   * `BottomSheetModal` monterer sit indhold hele tiden, så et kald uden `enabled`
   * sprang ved hvert besøg på Rapporter — for en liste brugeren måske aldrig ser.
   */
  it('hentes ikke, før arket er åbent', () => {
    setup(<LukketArk />);

    expect(mockUseQuery).toHaveBeenCalledWith(undefined, { enabled: false });
  });

  it('hentes når arket er åbent', () => {
    setup(<Harness />);

    expect(mockUseQuery).toHaveBeenCalledWith(undefined, { enabled: true });
  });
});

describe('når der ikke er noget at dele', () => {
  it('forklarer hvad et link er, frem for at sige «ingen data»', async () => {
    setup(<Harness />);

    expect(await screen.findByText('Ingen delte rapporter')).toBeOnTheScreen();
  });

  it('viser en fejltilstand med prøv igen når listen ikke kan hentes', async () => {
    mockListState = () => ({ ...listState(), isError: true, error: new Error('Serveren svarer ikke') });
    setup(<Harness />);

    expect(await screen.findByText('Serveren svarer ikke')).toBeOnTheScreen();
    fireEvent.press(screen.getByTestId('retry'));
    expect(mockRefetch).toHaveBeenCalled();
  });
});
