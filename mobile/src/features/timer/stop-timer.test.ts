import type { StopResult } from './timer-service';
import type { AppRouter } from '~/api/app-router';
import { TRPCClientError } from '@trpc/client';
// Mockes nedenfor: her vil vi se selve toast-kaldet, som `~/lib/notify` videredir.
import { showMessage } from 'react-native-flash-message';
import { isOffline } from '~/features/offline/enqueue';
import { hasQueuedStart, queueTimerStop } from '~/features/offline/timer-offline';
import { queryClient } from '~/lib/api/provider';
import { withStopLock } from './stop-lock';
import { reconcileTimerNow, stopTimerNow } from './stop-timer';
import { getPendingStop, recoverPendingStop, setPendingStop } from './timer-recovery';
import { reconcileTimer, saveLocalOnlyTimer, stopTimerOnServer } from './timer-service';

const mockState = { current: null as unknown };
// `reset` rydder den lokale session, som den rigtige gør — ellers ville
// dobbelttryk-testen tro at timeren stadig kører efter det første stop.
const mockActions = {
  reset: jest.fn(() => {
    mockState.current = { startTime: null, pendingSync: false, baseSeconds: 0 };
  }),
  replace: jest.fn(),
};
const mockJournal = { current: null as { stoppedAt: string; state: { startTime: string | null } } | null };
// Køens elementer, som afstemningen læser for at vide, hvilke sessioner vi
// selv har stoppet (se `reconcileTimerNow`).
const mockKoe = { items: [] as unknown[] };

jest.mock('react-native-flash-message', () => ({ showMessage: jest.fn() }));

jest.mock('~/lib/i18n', () => ({ translate: (key: string) => key }));

jest.mock('~/lib/format', () => ({ formatHours: (h: number) => `${h.toFixed(2)} t` }));

jest.mock('~/lib/api', () => ({ errorMessage: (e: unknown) => (e as Error)?.message ?? 'fejl' }));

jest.mock('~/lib/api/provider', () => ({
  queryClient: { invalidateQueries: jest.fn() },
}));

jest.mock('~/features/offline/enqueue', () => ({ isOffline: jest.fn(() => false) }));

jest.mock('~/features/offline/queue-store', () => ({ offlineQueue: () => ({ items: mockKoe.items }) }));

jest.mock('~/features/offline/timer-offline', () => ({ queueTimerStop: jest.fn(() => 1.5), hasQueuedStart: jest.fn(() => false), dropQueuedStarts: jest.fn() }));

jest.mock('./timer-recovery', () => ({
  recoverPendingStop: jest.fn(async () => {}),
  setPendingStop: jest.fn(),
  getPendingStop: jest.fn(() => null),
}));

jest.mock('./timer-service', () => ({
  reconcileTimer: jest.fn(async () => ({})),
  saveLocalOnlyTimer: jest.fn(async () => ({ kind: 'saved', hours: 2, complianceWarnings: [] })),
  stopTimerOnServer: jest.fn(async () => ({ kind: 'saved', hours: 2, complianceWarnings: [] })),
}));

jest.mock('./timer-store', () => ({
  getTimerState: () => mockState.current,
  timerActions: () => mockActions,
}));

type State = { startTime: string | null; pendingSync: boolean; baseSeconds: number };
const mock = {
  offline: false,
  invalidate: jest.fn(),
  reconcile: jest.fn(async () => {}),
};

/** Som tRPC selv bylder den, når fetch'en fejler — kun sådan er det en netfejl. */
function netfejl(): TRPCClientError<AppRouter> {
  return TRPCClientError.from(new TypeError('Network request failed')) as TRPCClientError<AppRouter>;
}

/** En permanent afvisning fra serveren (zod, manglet adgang) — ikke netfejl. */
function afvisning(message: string, code: string): TRPCClientError<AppRouter> {
  return new TRPCClientError(message, {
    result: { error: { code: -32000, message, data: { code, httpStatus: 400, path: 'x' } } },
  } as any);
}

function setTimer(patch: Partial<State> = {}) {
  mockState.current = {
    startTime: '2026-09-29T08:00:00.000Z',
    pendingSync: false,
    baseSeconds: 0,
    ...patch,
  };
}

function setStopResult(result: StopResult) {
  (stopTimerOnServer as jest.Mock).mockResolvedValue(result);
}

beforeEach(() => {
  jest.clearAllMocks();
  (isOffline as jest.Mock).mockReturnValue(false);
  mockJournal.current = null;
  (getPendingStop as jest.Mock).mockImplementation(() => mockJournal.current);
  setTimer();
  setStopResult({ kind: 'saved', hours: 2, complianceWarnings: [] });
  mockKoe.items = [];
  // `clearAllMocks` rydder kaldene, men ikke implementationen — et afvist
  // kald fra forrige test ville ellers blive arvet af den næste.
  (saveLocalOnlyTimer as jest.Mock).mockResolvedValue({ kind: 'saved', hours: 2, complianceWarnings: [] });
});

describe('stopTimerNow', () => {
  it('gør ingenting når timeren ikke kører', async () => {
    setTimer({ startTime: null });
    expect(await stopTimerNow()).toBe(false);
    expect(stopTimerOnServer).not.toHaveBeenCalled();
    expect(showMessage).not.toHaveBeenCalled();
  });

  it('skriver stop-journal før kæden og rydder den ved gemt tid', async () => {
    const busy: boolean[] = [];
    expect(await stopTimerNow({ setBusy: b => busy.push(b), invalidate: mock.invalidate, reconcile: mock.reconcile })).toBe(true);
    // Først selve journalen, så den igen med null når tiden er gemt.
    expect(setPendingStop).toHaveBeenCalledTimes(2);
    expect(setPendingStop).toHaveBeenLastCalledWith(null);
    expect(busy).toEqual([true, false]);
    expect(mock.invalidate).toHaveBeenCalledTimes(1);
  });

  it('lader journalen ligge, når kæden dør — så intet tid tabes', async () => {
    (stopTimerOnServer as jest.Mock).mockRejectedValue(netfejl());
    expect(await stopTimerNow()).toBe(false);
    expect(setPendingStop).toHaveBeenCalledTimes(1);
    expect(setPendingStop).not.toHaveBeenLastCalledWith(null);
  });

  it('rydder journalen og afstemmer, når claimet aldrig blev taget', async () => {
    setStopResult({ kind: 'claim_failed', reason: 'already_stopping' });
    expect(await stopTimerNow({ reconcile: mock.reconcile })).toBe(false);
    expect(setPendingStop).toHaveBeenLastCalledWith(null);
    expect(mock.reconcile).toHaveBeenCalledTimes(1);
  });

  it('beholder journalen når tiden er gemt men claimet ikke bekræftet', async () => {
    setStopResult({ kind: 'saved_unconfirmed', hours: 2 });
    expect(await stopTimerNow()).toBe(true);
    expect(setPendingStop).toHaveBeenCalledTimes(1);
    expect(setPendingStop).not.toHaveBeenLastCalledWith(null);
  });

  it('kalder aldrig claim-kæden for en lokal session — serveren kender den ikke', async () => {
    setTimer({ pendingSync: true });
    expect(await stopTimerNow()).toBe(true);
    expect(stopTimerOnServer).not.toHaveBeenCalled();
    expect(saveLocalOnlyTimer).toHaveBeenCalledTimes(1);
  });

  it('lægger en død gemning i køen som ubekræftet, så den ikke dobbeltfaktureres', async () => {
    setTimer({ pendingSync: true });
    (saveLocalOnlyTimer as jest.Mock).mockRejectedValue(netfejl());
    expect(await stopTimerNow()).toBe(true);
    expect(queueTimerStop).toHaveBeenCalledWith(
      expect.anything(),
      'timer.default_description',
      expect.objectContaining({ unconfirmed: true }),
    );
  });

  it('viser en permanent afvisning i stedet for at sende den i køen', async () => {
    // Review-fund 29/9: alt blev køet, også en fejl der bliver ved med at
    // fejle. Køen viste så "gemt offline" oveni en fejl brugeren aldrig løser,
    // og tiden lå der med en besked om, at den var gemt.
    setTimer({ pendingSync: true });
    (saveLocalOnlyTimer as jest.Mock).mockRejectedValue(afvisning('Projektet er lukket', 'BAD_REQUEST'));
    expect(await stopTimerNow()).toBe(false);
    expect(queueTimerStop).not.toHaveBeenCalled();
    // Timeren kører videre, så brugeren kan rette årsagen og prøve igen.
    expect(mockActions.reset).not.toHaveBeenCalled();
    expect(showMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'danger' }));
  });

  it('viser en udløbet session i stedet for at lægge tiden i køen', async () => {
    // Review-fund 30/9: `classifyError` regnede UNAUTHORIZED som forbigående,
    // så en udløbet cookie gav "gemt offline", mens køen drænede fem 401'er over
    // ca. 30 minutter. Timeren var reset, så det eneste synlige resultat var en
    // løfte om en gemt tid, der aldrig nåede serveren.
    setTimer({ pendingSync: true });
    (saveLocalOnlyTimer as jest.Mock).mockRejectedValue(afvisning('Du er logget ud. Log ind igen.', 'UNAUTHORIZED'));
    expect(await stopTimerNow()).toBe(false);
    expect(queueTimerStop).not.toHaveBeenCalled();
    expect(mockActions.reset).not.toHaveBeenCalled();
    expect(showMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'danger' }));
  });

  it('lægger en 5xx i køen som ubekræftet — den kan have gemt posten', async () => {
    // En serverfejl kan komme EFTER at posten blev oprettet. Vises den bare,
    // trykker brugeren igen, og samme time gemmes to gange. Ubekræft-markeringen
    // får dræningen til at slå dagen op først.
    setTimer({ pendingSync: true });
    (saveLocalOnlyTimer as jest.Mock).mockRejectedValue(afvisning('Database kunne ikke nås', 'INTERNAL_SERVER_ERROR'));
    expect(await stopTimerNow()).toBe(true);
    expect(queueTimerStop).toHaveBeenCalledWith(
      expect.anything(),
      'timer.default_description',
      expect.objectContaining({ unconfirmed: true }),
    );
  });

  it('uden net gemmes posten i køen og claim-kæden røres slet ikke', async () => {
    (isOffline as jest.Mock).mockReturnValue(true);
    expect(await stopTimerNow({ reconcile: mock.reconcile })).toBe(true);
    expect(isOffline()).toBe(true);
    expect(stopTimerOnServer).not.toHaveBeenCalled();
    expect(setPendingStop).not.toHaveBeenCalled();
    expect(mock.reconcile).not.toHaveBeenCalled();
  });
});

/**
 * Et stop, der døde med en fejl efter at claimet var taget.
 *
 * `time.create` indsætter rækken og trækker på klippekortet i én
 * transaktion og laver først derefter andet arbejde, så en 5xx eller et
 * tabt svar kan ramme EFTER at posten ligger gemt. Står den så i køen,
 * skal næste stop kunne genkende den — ellers gemmes samme tidsrum to
 * gange, og det er den dyreste fejl i appen. Derfor bevares stop-øjeblikket
 * i journalen, indtil vi ved HVAD der skete.
 */
describe('stop der døde med en fejl efter claimet', () => {
  const femXx = () => afvisning('Database kunne ikke nås', 'INTERNAL_SERVER_ERROR');

  it('beholder journalen ved en 5xx — den kan have gemt posten', async () => {
    setStopResult({ kind: 'save_failed', error: femXx() });
    expect(await stopTimerNow()).toBe(false);
    expect(setPendingStop).toHaveBeenCalledTimes(1);
    expect(setPendingStop).not.toHaveBeenLastCalledWith(null);
  });

  it('k1 (#783): claimet står (claimKept) — journalen bliver, timeren nulstilles ikke, brugeren advares', async () => {
    setStopResult({ kind: 'save_failed', error: netfejl(), claimKept: true });
    expect(await stopTimerNow()).toBe(false);
    expect(setPendingStop).not.toHaveBeenLastCalledWith(null);
    expect(mockActions.reset).not.toHaveBeenCalled();
    expect(showMessage).toHaveBeenCalledWith(expect.objectContaining({ message: 'timer.save_uncertain', type: 'warning' }));
  });

  it('beholder journalen ved tabt net — det kan have gemt posten', async () => {
    setStopResult({ kind: 'save_failed', error: netfejl() });
    expect(await stopTimerNow()).toBe(false);
    expect(setPendingStop).toHaveBeenCalledTimes(1);
    expect(setPendingStop).not.toHaveBeenLastCalledWith(null);
  });

  it('rydder journalen når serveren afviste endeligt — intet blev gemt', async () => {
    // En permanent afvisning (zod, lukket projekt) kan ikke have oprettet en
    // post, så et genkald skal have et FRIT tidspunkt — ellers læner det sig
    // op ad et tidspunkt hvis post aldrig blev oprettet, og tiden gemmes aldrig.
    setStopResult({ kind: 'save_failed', error: afvisning('Projektet er lukket', 'BAD_REQUEST') });
    expect(await stopTimerNow()).toBe(false);
    expect(setPendingStop).toHaveBeenLastCalledWith(null);
    expect(showMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'danger' }));
  });

  it('rydder journalen ved en udløbet session — den afviste før den gemte noget', async () => {
    // En 401 opstår i middleware, FØR `time.create` kører, så intet kan være
    // gemt. Timeren kører videre, så brugeren logger ind igen og trykker Stop:
    // han taber ingen tid og får et frit stop-øjeblik.
    setStopResult({ kind: 'save_failed', error: afvisning('Du er logget ud.', 'UNAUTHORIZED') });
    expect(await stopTimerNow()).toBe(false);
    expect(setPendingStop).toHaveBeenLastCalledWith(null);
    expect(mockActions.reset).not.toHaveBeenCalled();
  });

  it('genkender posten fra det tidligere stop, der døde', async () => {
    // Beviset på at journalen faktisk virker: et genkald efter en død
    // gemning skal sende SAMME `stoppedAt` videre. Det er den nøgle
    // `findSavedEntry` matcher på, så posten fra det første kald genkendes
    // og ikke oprettes en gang til.
    mockJournal.current = { stoppedAt: '2026-09-29T10:00:00.000Z', state: { startTime: '2026-09-29T08:00:00.000Z' } };
    setStopResult({ kind: 'save_failed', error: femXx() });
    await stopTimerNow();
    expect(stopTimerOnServer).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ now: new Date('2026-09-29T10:00:00.000Z') }),
    );
  });
});

describe('stopTimerNow uden React', () => {
  it('afstemmer med queryClient for tid, klippekort og timer', async () => {
    await stopTimerNow();
    expect(queryClient.invalidateQueries).toHaveBeenCalledTimes(3);
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: [['time']] });
  });
});

describe('dobbeltstop må ikke dobbeltfakturere', () => {
  it('gennemfører kun ÉN kæde ved to tryk i træk', async () => {
    // Dobbelttryk i appen, notifikationsknappen OG en afstemning kan alle nå
    // stop-kæden samtidig. Uden ét fælles lock lavede hver sit `stoppedAt`,
    // så `findSavedEntry` aldrig ramte og tiden blev gemt to gange.
    const results = await Promise.all([stopTimerNow(), stopTimerNow()]);
    expect(stopTimerOnServer).toHaveBeenCalledTimes(1);
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it('sender stop-tidspunktet videre i kæden, så et gentaget stop finder posten', async () => {
    await stopTimerNow();
    const [, opts] = (stopTimerOnServer as jest.Mock).mock.calls[0] as [unknown, { now?: Date }];
    expect(opts.now).toBeInstanceOf(Date);
  });

  it('genbruger journalens stop-tidspunkt, når et tidligere stop ikke blev bekræftet', async () => {
    // `saved_unconfirmed` beholder journalen. Et nyt tryk skal derfor skrive
    // det SAMME `stoppedAt` — ellers danner det en post med en anden
    // sluttid, som `findSavedEntry` ikke kan genkende.
    mockJournal.current = { stoppedAt: '2026-09-29T09:30:00.000Z', state: { startTime: '2026-09-29T08:00:00.000Z' } };
    await stopTimerNow();

    const [, opts] = (stopTimerOnServer as jest.Mock).mock.calls[0] as [unknown, { now?: Date }];
    expect(opts.now?.toISOString()).toBe('2026-09-29T09:30:00.000Z');
    expect(setPendingStop).toHaveBeenCalledWith(expect.objectContaining({ stoppedAt: '2026-09-29T09:30:00.000Z' }));
  });

  it('tager et nyt tidspunkt når journalen tilhører en anden session', async () => {
    mockJournal.current = { stoppedAt: '2026-09-29T07:00:00.000Z', state: { startTime: '2026-09-29T06:00:00.000Z' } };
    await stopTimerNow();
    const [, opts] = (stopTimerOnServer as jest.Mock).mock.calls[0] as [unknown, { now?: Date }];
    expect(opts.now?.toISOString()).not.toBe('2026-09-29T07:00:00.000Z');
  });

  it('gør krav på eget claim når journalen viser et afbrudt stop af DEN session', async () => {
    // Kun journalen kan bevise, at et stopping-intent på serveren er VORT:
    // både web-appen og mobilen sender `source: 'web'`.
    mockJournal.current = { stoppedAt: '2026-09-29T09:30:00.000Z', state: { startTime: '2026-09-29T08:00:00.000Z' } };
    await stopTimerNow();
    const [, opts] = (stopTimerOnServer as jest.Mock).mock.calls[0] as [unknown, { ownClaim?: boolean }];
    expect(opts.ownClaim).toBe(true);
  });

  it('gør ALDRIG krav på eget claim for et helt nyt stop', async () => {
    await stopTimerNow();
    const [, opts] = (stopTimerOnServer as jest.Mock).mock.calls[0] as [unknown, { ownClaim?: boolean }];
    expect(opts.ownClaim).toBe(false);
  });

  it('venter på en recovery der er i gang, så de to kæder aldrig løber samtidig', async () => {
    // Recovery (app-start/forgrund) og stop (tap/notifikation) rammer begge
    // serveren med samme session. De skal deles om ét lock.
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    (recoverPendingStop as jest.Mock).mockImplementation(() =>
      withStopLock(async () => {
        await gate;
      }));

    // Afstemningen (app-start/forgrund) tager låsen først...
    const recovering = recoverPendingStop();
    await Promise.resolve();
    // ...så et stop-tryk må vente på den og ikke ramme serveren selv.
    const stopping = stopTimerNow();
    await Promise.resolve();
    expect(stopTimerOnServer).not.toHaveBeenCalled();

    release();
    await Promise.all([recovering, stopping]);
    expect(stopTimerOnServer).toHaveBeenCalledTimes(1);
  });
});

describe('reconcileTimerNow', () => {
  // Serverens række står stadig som "kørende" med den sessions `startTime`,
  // vi stoppede uden net, indtil køens dræning rydder den. Uden listen ville
  // afstemningen adoptere den døde session, og næste stop ville gemme præcis
  // det samme tidsrum igen — dobbeltfaktureret.
  it('fortæller afstemningen hvilke sessioner der er stoppet og venter i køen', async () => {
    mockKoe.items = [
      { id: '1', type: 'time.create', payload: { startTime: '2026-09-29T08:00:00.000Z' }, meta: { clearTimer: true } },
    ];
    setTimer({ startTime: '2026-09-29T08:00:00.000Z' });

    await reconcileTimerNow();

    expect(reconcileTimer).toHaveBeenCalledWith(expect.anything(), ['2026-09-29T08:00:00.000Z']);
  });

  it('lader en tom kø være tom — en igangværende timer skal stadig adopteres', async () => {
    setTimer();
    await reconcileTimerNow();
    expect(reconcileTimer).toHaveBeenCalledWith(expect.anything(), []);
  });
});

describe('stop af en session, hvis start venter i køen (#703)', () => {
  it('lægger stoppet bag sin køede start, også online (#703)', async () => {
    // Starten venter stadig i køen: gemmes posten direkte, afspilles starten
    // bagefter som en timer, ingen stopper. Stoppet skal bag den i køen.
    setTimer({ pendingSync: true });
    (hasQueuedStart as jest.Mock).mockReturnValueOnce(true);
    expect(await stopTimerNow()).toBe(true);
    expect(saveLocalOnlyTimer).not.toHaveBeenCalled();
    expect(stopTimerOnServer).not.toHaveBeenCalled();
    expect(queueTimerStop).toHaveBeenCalledTimes(1);
  });
});

describe('forældet lokal session (stoppet/skiftet på en anden enhed)', () => {
  it('session_changed: intet gemmes, journalen ryddes, den aktuelle hentes og brugeren får besked', async () => {
    setStopResult({ kind: 'session_changed' });
    expect(await stopTimerNow({ invalidate: mock.invalidate, reconcile: mock.reconcile })).toBe(false);
    expect(setPendingStop).toHaveBeenLastCalledWith(null);
    expect(mockActions.reset).not.toHaveBeenCalled();
    expect(mock.reconcile).toHaveBeenCalledTimes(1);
    expect(showMessage).toHaveBeenCalledWith(expect.objectContaining({ message: 'timer.session_changed' }));
  });

  it('advarer når klippekortet ikke kunne trækkes', async () => {
    setStopResult({ kind: 'saved', hours: 2, complianceWarnings: [], prepaidSkipped: true });
    expect(await stopTimerNow()).toBe(true);
    expect(showMessage).toHaveBeenCalledWith(expect.objectContaining({ message: 'timer.prepaid_skipped', type: 'warning' }));
  });

  it('afstemningen lægger ikke et svar ind, hvis den lokale timer ændrede sig undervejs', async () => {
    setTimer({ startTime: null });
    (reconcileTimer as jest.Mock).mockImplementationOnce(async () => {
      // En start landede, mens afstemningen ventede på serveren.
      setTimer({ startTime: '2026-09-29T10:00:00.000Z' });
      return { startTime: null };
    });
    await reconcileTimerNow();
    expect(mockActions.replace).not.toHaveBeenCalled();
  });

  it('afstemningen lægger svaret ind, når intet ændrede sig', async () => {
    (reconcileTimer as jest.Mock).mockImplementationOnce(async () => ({ startTime: null }));
    await reconcileTimerNow();
    expect(mockActions.replace).toHaveBeenCalledWith({ startTime: null });
  });
});
