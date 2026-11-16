import type { ServerTimerState } from './timer-logic';
import type { AppRouter } from '~/api/app-router';
import { TRPCClientError } from '@trpc/client';

const calls: string[] = [];

jest.mock('~/lib/api/trpc', () => ({
  trpcClient: {
    timerSync: {
      getStateWithVersion: { query: jest.fn() },
      getState: { query: jest.fn(async () => ({ taskId: null })) },
      sync: { mutate: jest.fn() },
      claimForStop: { mutate: jest.fn() },
      confirmStop: { mutate: jest.fn() },
      cancelStop: { mutate: jest.fn() },
      clear: { mutate: jest.fn() },
    },
    time: { create: { mutate: jest.fn() }, list: { query: jest.fn() } },
    prepaid: { getActiveForClient: { query: jest.fn() } },
  },
  isTRPCClientError: (error: unknown) => error instanceof jest.requireActual('@trpc/client').TRPCClientError,
}));

const mockClient = jest.requireMock('~/lib/api/trpc').trpcClient;

// eslint-disable-next-line import/first
import { EMPTY_TIMER, startLocal } from './timer-logic';
// eslint-disable-next-line import/first
import {
  discardTimerOnServer,
  reconcileTimer,
  rescueParkedStop,
  saveLocalOnlyTimer,
  startTimerOnServer,
  stopTimerOnServer,
  updateTimerOnServer,
} from './timer-service';

const T0 = new Date('2026-09-06T08:00:00.000Z');

/** En endelig afvisning fra serveren (zod, lukket projekt) — posten er IKKE gemt. */
function afvisning(message: string, code = 'BAD_REQUEST'): TRPCClientError<AppRouter> {
  return new TRPCClientError(message, {
    result: { error: { code: -32000, message, data: { code, httpStatus: 400, path: 'time.create' } } },
  } as any);
}

/** Som tRPC selv bygger den, når svaret aldrig når frem. */
function netfejl(): TRPCClientError<AppRouter> {
  return TRPCClientError.from(new TypeError('Network request failed')) as TRPCClientError<AppRouter>;
}

const idle: ServerTimerState = {
  isRunning: false,
  startTime: null,
  elapsedSeconds: 0,
  baseSeconds: 0,
  projectId: null,
  clientId: null,
  description: '',
  project: null,
  client: null,
  version: 0,
  intent: null,
  intentAt: null,
  intentFrom: null,
  prepaidChoice: null,
  sessionId: null,
};

const runningOnServer: ServerTimerState = {
  ...idle,
  isRunning: true,
  startTime: T0.toISOString(),
  projectId: 'p1',
  clientId: 'c1',
  project: { id: 'p1', name: 'Website', clientId: 'c1' },
  client: { id: 'c1', name: 'Acme' },
  version: 5,
};

function track(name: string, fn: jest.Mock, impl: () => Promise<unknown>) {
  fn.mockImplementation(() => {
    calls.push(name);
    return impl();
  });
}

/** Serveren står med VORES claim fra et stop, der aldrig blev bekræftet. */
function stuckStopping(overrides: Partial<ServerTimerState> = {}): ServerTimerState {
  return {
    ...runningOnServer,
    intent: 'stopping',
    intentFrom: 'web',
    intentAt: '2026-09-06T09:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  calls.length = 0;
  jest.clearAllMocks();
  track('getState', mockClient.timerSync.getStateWithVersion.query, async () => ({ ...runningOnServer, version: 5 }));
  track('claim', mockClient.timerSync.claimForStop.mutate, async () => ({ success: true, version: 6 }));
  track('create', mockClient.time.create.mutate, async () => ({ id: 'e1', complianceWarnings: ['Advarsel'] }));
  track('confirm', mockClient.timerSync.confirmStop.mutate, async () => ({ success: true, version: 7 }));
  track('cancel', mockClient.timerSync.cancelStop.mutate, async () => ({ success: true, version: 7 }));
  track('sync', mockClient.timerSync.sync.mutate, async () => ({ success: true, version: 1, syncedAt: '' }));
  track('list', mockClient.time.list.query, async () => ({ entries: [], hasMore: false }));
  track('prepaid', mockClient.prepaid.getActiveForClient.query, async () => []);
  track('clear', mockClient.timerSync.clear.mutate, async () => ({ success: true }));
});

const localRunning = { ...EMPTY_TIMER, startTime: T0.toISOString(), projectId: 'p1', clientId: 'c1', version: 5 };

describe('stopTimerOnServer', () => {
  it('kører getState → claim → create → confirm i den rækkefølge', async () => {
    const result = await stopTimerOnServer(localRunning, {
      fallbackDescription: 'Tidsregistrering',
      now: new Date(T0.getTime() + 3_600_000),
    });
    await Promise.resolve();
    expect(calls).toEqual(['getState', 'claim', 'list', 'prepaid', 'create', 'confirm']);
    // Sessions-tjekket rejser med: serveren må kun claime, hvis rækken stadig
    // er DEN session (start) i den version, vi så.
    expect(mockClient.timerSync.claimForStop.mutate).toHaveBeenCalledWith({
      expectedVersion: 5,
      expectedStartTime: T0.getTime(),
      source: 'web',
    });
    expect(mockClient.time.create.mutate).toHaveBeenCalledWith(
      expect.objectContaining({ hours: 1, fromTimer: true, description: 'Tidsregistrering' }),
    );
    expect(mockClient.timerSync.confirmStop.mutate).toHaveBeenCalledWith({ version: 6, source: 'web' });
    expect(result).toEqual({ kind: 'saved', hours: 1, complianceWarnings: ['Advarsel'] });
  });

  it('frigiver claimet med cancelStop når gemningen afvises endeligt — og bekræfter ikke', async () => {
    track('create', mockClient.time.create.mutate, async () => {
      throw afvisning('Afvist');
    });
    const result = await stopTimerOnServer(localRunning, { fallbackDescription: 'x' });
    await Promise.resolve();
    expect(calls).toEqual(['getState', 'claim', 'list', 'prepaid', 'create', 'cancel']);
    expect(mockClient.timerSync.cancelStop.mutate).toHaveBeenCalledWith({ version: 6, source: 'web' });
    expect(result.kind).toBe('save_failed');
  });

  it('gemmer ikke igen når serveren allerede er stoppet og gemt fra en anden enhed', async () => {
    track('getState', mockClient.timerSync.getStateWithVersion.query, async () => ({ ...idle, version: 8 }));
    const result = await stopTimerOnServer(localRunning, { fallbackDescription: 'x' });
    expect(result).toEqual({ kind: 'stopped_elsewhere' });
    expect(calls).toEqual(['getState']);
  });

  it('stopper ved mislykket claim uden at oprette en post', async () => {
    track('claim', mockClient.timerSync.claimForStop.mutate, async () => ({ success: false, reason: 'version_mismatch', version: 9 }));
    const result = await stopTimerOnServer(localRunning, { fallbackDescription: 'x' });
    expect(result).toEqual({ kind: 'claim_failed', reason: 'version_mismatch' });
    expect(calls).toEqual(['getState', 'claim']);
  });
});

/** Vort eget afbrudte claim: serveren står i 'stopping' for DEN session. */
const oursStopped = { ownClaim: true };

describe('afbrudt stop (claim stående på serveren)', () => {
  const STOP = new Date(T0.getTime() + 3_600_000);

  it('tager ikke et nyt claim, når serveren allerede står med VORES stopping', async () => {
    track('getState', mockClient.timerSync.getStateWithVersion.query, async () => stuckStopping({ version: 6 }));
    const result = await stopTimerOnServer(localRunning, { fallbackDescription: 'x', now: STOP, ...oursStopped });
    expect(mockClient.timerSync.claimForStop.mutate).not.toHaveBeenCalled();
    expect(calls).toEqual(['getState', 'list', 'prepaid', 'create', 'confirm']);
    expect(result.kind).toBe('saved');
  });

  it('laver ALDRIG posten igen, når den allerede findes fra det afbrudte stop', async () => {
    track('getState', mockClient.timerSync.getStateWithVersion.query, async () => stuckStopping({ version: 6 }));
    track('list', mockClient.time.list.query, async () => ({
      entries: [{ id: 'e1', startTime: new Date(T0), endTime: new Date(STOP) }],
      hasMore: false,
    }));
    const result = await stopTimerOnServer(localRunning, { fallbackDescription: 'x', now: STOP, ...oursStopped });
    expect(mockClient.time.create.mutate).not.toHaveBeenCalled();
    expect(calls).toEqual(['getState', 'list', 'confirm']);
    expect(result).toEqual({ kind: 'saved', hours: 1, complianceWarnings: [], alreadySaved: true });
  });

  it('meld saved_unconfirmed når bekræftelsen aldrig går igennem, så kæden kan prøves igen', async () => {
    track('getState', mockClient.timerSync.getStateWithVersion.query, async () => stuckStopping({ version: 6 }));
    track('list', mockClient.time.list.query, async () => ({
      entries: [{ id: 'e1', startTime: new Date(T0), endTime: new Date(STOP) }],
      hasMore: false,
    }));
    track('confirm', mockClient.timerSync.confirmStop.mutate, async () => ({ success: false, reason: 'version_mismatch', version: 9 }));
    const result = await stopTimerOnServer(localRunning, { fallbackDescription: 'x', now: STOP, ...oursStopped });
    expect(result).toEqual({ kind: 'saved_unconfirmed', hours: 1 });
  });

  it('prøver bekræftelsen igen med den version serveren beder om', async () => {
    let attempt = 0;
    track('getState', mockClient.timerSync.getStateWithVersion.query, async () => stuckStopping({ version: 6 }));
    track('list', mockClient.time.list.query, async () => ({
      entries: [{ id: 'e1', startTime: new Date(T0), endTime: new Date(STOP) }],
      hasMore: false,
    }));
    track('confirm', mockClient.timerSync.confirmStop.mutate, async () => {
      attempt += 1;
      return attempt === 1
        ? { success: false, reason: 'version_mismatch', version: 9 }
        : { success: true, version: 10 };
    });
    const result = await stopTimerOnServer(localRunning, { fallbackDescription: 'x', now: STOP, ...oursStopped });
    expect(mockClient.timerSync.confirmStop.mutate).toHaveBeenNthCalledWith(1, { version: 6, source: 'web' });
    expect(mockClient.timerSync.confirmStop.mutate).toHaveBeenNthCalledWith(2, { version: 9, source: 'web' });
    expect(result.kind).toBe('saved');
  });

  it('rører ikke et claim, der tilhører en ANDEN kilde end mobilens', async () => {
    track('getState', mockClient.timerSync.getStateWithVersion.query, async () => stuckStopping({ intentFrom: 'extension' }));
    const result = await stopTimerOnServer(localRunning, { fallbackDescription: 'x', now: STOP, ...oursStopped });
    expect(mockClient.time.create.mutate).not.toHaveBeenCalled();
    expect(result).toEqual({ kind: 'claim_failed', reason: 'already_stopping' });
  });

  it('overtager ALDRIG web\'ens eget igangværende stop uden bevis for, at det er vores', async () => {
    // Både web-appen og mobilen sender `source: 'web'` (enum'en har kun
    // web/extension), så et stopping-intent med 'web' er ikke genkendeligt som
    // mobilens. Uden beviset oprettede mobilen sin egen post og bekræftede
    // web'ens claim — og web'ens egen gemning landede oveni, så samme time
    // blev faktureret to gange.
    track('getState', mockClient.timerSync.getStateWithVersion.query, async () => stuckStopping({ version: 6 }));
    const result = await stopTimerOnServer(localRunning, { fallbackDescription: 'x', now: STOP });
    expect(calls).toEqual(['getState']);
    expect(mockClient.timerSync.claimForStop.mutate).not.toHaveBeenCalled();
    expect(mockClient.time.create.mutate).not.toHaveBeenCalled();
    expect(mockClient.timerSync.confirmStop.mutate).not.toHaveBeenCalled();
    expect(result).toEqual({ kind: 'claim_failed', reason: 'already_stopping' });
  });
});

describe('rescueParkedStop', () => {
  const STOP = new Date(T0.getTime() + 3_600_000);

  /** Cronen har lagt rækken til side: ikke kørende, men med tiden i baseSeconds. */
  const parked: ServerTimerState = {
    ...idle,
    isRunning: false,
    elapsedSeconds: 3_600,
    baseSeconds: 3_600,
    version: 6,
  };

  it('genopretter den tabte post fra journalen og rydder den parkerede række', async () => {
    track('getState', mockClient.timerSync.getStateWithVersion.query, async () => parked);
    track('clear', mockClient.timerSync.clear.mutate, async () => ({ success: true, version: 7 }));
    const result = await rescueParkedStop(localRunning, {
      fallbackDescription: 'Tidsregistrering',
      now: STOP,
      expectedVersion: parked.version,
    });
    await Promise.resolve();
    expect(calls).toEqual(['list', 'prepaid', 'create', 'getState', 'clear']);
    expect(mockClient.time.create.mutate).toHaveBeenCalledWith(expect.objectContaining({
      hours: 1,
      startTime: T0.toISOString(),
      endTime: STOP.toISOString(),
      fromTimer: true,
    }));
    expect(result).toEqual({ kind: 'saved', hours: 1, complianceWarnings: ['Advarsel'], alreadySaved: false });
  });

  it('laver ALDRIG posten igen, når den findes fra det afbrudte stop', async () => {
    track('getState', mockClient.timerSync.getStateWithVersion.query, async () => parked);
    track('clear', mockClient.timerSync.clear.mutate, async () => ({ success: true, version: 7 }));
    track('list', mockClient.time.list.query, async () => ({
      entries: [{ id: 'e1', startTime: new Date(T0), endTime: new Date(STOP) }],
      hasMore: false,
    }));
    const result = await rescueParkedStop(localRunning, { fallbackDescription: 'x', now: STOP, expectedVersion: parked.version });
    expect(mockClient.time.create.mutate).not.toHaveBeenCalled();
    expect(calls).toEqual(['list', 'getState', 'clear']);
    expect(result).toEqual({ kind: 'saved', hours: 1, complianceWarnings: [], alreadySaved: true });
  });

  it('rydder ikke rækken, hvis en ny timer er startet i mellemtiden', async () => {
    track('getState', mockClient.timerSync.getStateWithVersion.query, async () => ({ ...runningOnServer, version: 9 }));
    track('clear', mockClient.timerSync.clear.mutate, async () => ({ success: true, version: 10 }));
    const result = await rescueParkedStop(localRunning, { fallbackDescription: 'x', now: STOP });
    expect(mockClient.timerSync.clear.mutate).not.toHaveBeenCalled();
    expect(calls).toEqual(['list', 'prepaid', 'create', 'getState']);
    expect(result.kind).toBe('saved');
  });

  it('rydder ikke en parkeret række, der stadig bærer en anden klients claim', async () => {
    // Cronen parkerer et stopping-intent som pause og lader claimet blive
    // stående. Rækken må så ikke ryddes under fødderne på den klient, der
    // stadig holder sit claim — den ville få `no_timer` i bekræftelsen.
    track('getState', mockClient.timerSync.getStateWithVersion.query, async () => ({
      ...parked,
      intent: 'stopping',
      intentFrom: 'extension',
      intentAt: '2026-09-06T09:00:00.000Z',
    }));
    const result = await rescueParkedStop(localRunning, { fallbackDescription: 'x', now: STOP });
    expect(mockClient.timerSync.clear.mutate).not.toHaveBeenCalled();
    expect(result.kind).toBe('saved');
  });

  it('melder save_failed når posten ikke kan oprettes, så journalen bliver liggende', async () => {
    track('getState', mockClient.timerSync.getStateWithVersion.query, async () => parked);
    track('create', mockClient.time.create.mutate, async () => {
      throw new Error('Afvist');
    });
    const result = await rescueParkedStop(localRunning, { fallbackDescription: 'x', now: STOP });
    expect(result.kind).toBe('save_failed');
    expect(mockClient.timerSync.clear.mutate).not.toHaveBeenCalled();
  });
});

/**
 * Rydningen af den parkerede rest kræver den version, vi så, da vi besluttede
 * at redde rækken.
 *
 * En pause på web har IDENTISK form som den parkerede rest: ikke kørende,
 * intet claim, tid i `baseSeconds`. `isRunning`/`intent` kan altså ikke skelne,
 * så `timerSync.clear` ville nulstille brugerens pause — og den tid, de lige
 * har registreret. Serverens versions-tæller er beviset på, at rækken stadig
 * er den, vi redder; samme greb som web's cron bruger i sin egen race-guard.
 */
describe('rydning af den parkerede rest kræver den version, vi reddede', () => {
  const STOP = new Date(T0.getTime() + 3_600_000);
  const parked: ServerTimerState = { ...idle, elapsedSeconds: 3_600, baseSeconds: 3_600, version: 6 };

  it('rydder den række, der stadig er den vi redde', async () => {
    track('getState', mockClient.timerSync.getStateWithVersion.query, async () => parked);
    track('clear', mockClient.timerSync.clear.mutate, async () => ({ success: true, version: 7 }));
    const result = await rescueParkedStop(localRunning, {
      fallbackDescription: 'x',
      now: STOP,
      expectedVersion: parked.version,
    });
    expect(mockClient.timerSync.clear.mutate).toHaveBeenCalledWith({ source: 'web' });
    expect(result.kind).toBe('saved');
  });

  it('rydder ikke når serverens version har flyttet sig siden vi læste rækken', async () => {
    track('getState', mockClient.timerSync.getStateWithVersion.query, async () => ({ ...parked, version: 7 }));
    track('clear', mockClient.timerSync.clear.mutate, async () => ({ success: true, version: 8 }));
    const result = await rescueParkedStop(localRunning, {
      fallbackDescription: 'x',
      now: STOP,
      expectedVersion: parked.version,
    });
    expect(mockClient.timerSync.clear.mutate).not.toHaveBeenCalled();
    expect(result.kind).toBe('saved');
  });

  it('rydder intet når versionen ikke er kendt — en pause er bedre end tabt tid', async () => {
    track('getState', mockClient.timerSync.getStateWithVersion.query, async () => parked);
    track('clear', mockClient.timerSync.clear.mutate, async () => ({ success: true, version: 7 }));
    const result = await rescueParkedStop(localRunning, { fallbackDescription: 'x', now: STOP });
    expect(mockClient.timerSync.clear.mutate).not.toHaveBeenCalled();
    expect(result.kind).toBe('saved');
  });
});

describe('startTimerOnServer', () => {
  it('adopterer serverens kørende timer i stedet for at starte en ny', async () => {
    const result = await startTimerOnServer({ ...EMPTY_TIMER, projectId: 'p2' }, T0);
    expect(result.kind).toBe('adopted');
    expect(mockClient.timerSync.sync.mutate).not.toHaveBeenCalled();
    if (result.kind === 'adopted')
      expect(result.state).toMatchObject({ projectId: 'p1', projectName: 'Website', version: 5 });
  });

  it('starter frisk når serveren er tom og gemmer versionen', async () => {
    track('getState', mockClient.timerSync.getStateWithVersion.query, async () => idle);
    const result = await startTimerOnServer({ ...EMPTY_TIMER, projectId: 'p2', clientId: 'c2', description: 'Ny' }, T0);
    expect(mockClient.timerSync.sync.mutate).toHaveBeenCalledWith(
      expect.objectContaining({ isFreshStart: true, projectId: 'p2', source: 'web' }),
    );
    expect(result).toEqual({
      kind: 'started',
      state: expect.objectContaining({ startTime: T0.toISOString(), projectId: 'p2', version: 1, baseSeconds: 0 }),
    });
  });

  it('melder blokeret når serveren afviser', async () => {
    track('getState', mockClient.timerSync.getStateWithVersion.query, async () => idle);
    track('sync', mockClient.timerSync.sync.mutate, async () => ({ success: false, reason: 'stopping_in_progress', version: 2 }));
    const result = await startTimerOnServer(EMPTY_TIMER, T0);
    expect(result).toEqual({ kind: 'blocked', reason: 'stopping_in_progress' });
  });

  it('overtager ALDRIG en session, serveren står med at stoppe', async () => {
    // Ellers ville brugeren adoptere en timer, der allerede er gemt som
    // post, og stoppe den igen — det samme tidsrum ville blive faktureret to
    // gange. Recovery færdiggør i stedet det afbrudte stop.
    track('getState', mockClient.timerSync.getStateWithVersion.query, async () => stuckStopping());
    const result = await startTimerOnServer(EMPTY_TIMER, T0);
    expect(result).toEqual({ kind: 'blocked', reason: 'stopping_in_progress' });
    expect(mockClient.timerSync.sync.mutate).not.toHaveBeenCalled();
  });
});

describe('reconcileTimer', () => {
  it('rydder den lokale timer når serveren er stoppet', async () => {
    track('getState', mockClient.timerSync.getStateWithVersion.query, async () => ({ ...idle, version: 3 }));
    const next = await reconcileTimer(localRunning);
    expect(next).toEqual({ ...EMPTY_TIMER, version: 3 });
  });

  it('overtager serverens kørende timer', async () => {
    const next = await reconcileTimer({ ...EMPTY_TIMER, taskId: 't1', projectId: 'p1', clientId: 'c1' });
    expect(next).toMatchObject({ startTime: T0.toISOString(), taskId: 't1', projectName: 'Website', version: 5 });
  });

  it('taber ikke en lokalt startet session, selv om serveren er helt tom', async () => {
    track('getState', mockClient.timerSync.getStateWithVersion.query, async () => ({ ...idle, version: 3 }));
    const local = startLocal({ ...EMPTY_TIMER, projectId: 'p1', description: 'Offline' }, T0, 3);
    expect(await reconcileTimer(local)).toEqual(local);
  });
});

describe('saveLocalOnlyTimer', () => {
  const local = startLocal({ ...EMPTY_TIMER, projectId: 'p1', clientId: 'c1', description: 'Offline' }, T0);

  it('gemmer posten direkte uden at claime eller rydde serverens session', async () => {
    const result = await saveLocalOnlyTimer(local, {
      fallbackDescription: 'Tidsregistrering',
      now: new Date(T0.getTime() + 1_800_000),
    });
    await Promise.resolve();
    expect(calls).toEqual(['prepaid', 'create']);
    expect(mockClient.timerSync.claimForStop.mutate).not.toHaveBeenCalled();
    expect(mockClient.timerSync.clear.mutate).not.toHaveBeenCalled();
    expect(result).toEqual({ kind: 'saved', hours: 0.5, complianceWarnings: ['Advarsel'] });
  });

  it('sender start- og sluttidspunktet med, så posten får den rigtige varighed', async () => {
    await saveLocalOnlyTimer(local, { fallbackDescription: 'x', now: new Date(T0.getTime() + 3_600_000) });
    expect(mockClient.time.create.mutate).toHaveBeenCalledWith(expect.objectContaining({
      startTime: T0.toISOString(),
      endTime: new Date(T0.getTime() + 3_600_000).toISOString(),
      fromTimer: true,
    }));
  });
});

describe('sessions-tjek: en forældet lokal timer rører aldrig en anden session', () => {
  // Telefonen tror session 09:00 kører. På web er den stoppet, og en ny er
  // startet 10:05 — den må hverken claimes, gemmes oveni eller ryddes.
  const OTHER = new Date(T0.getTime() + 65 * 60_000).toISOString();
  const otherSession = { ...runningOnServer, startTime: OTHER, projectId: 'p2', clientId: 'c2', version: 9 };

  it('stop: serveren kører en anden start → session_changed uden claim, post eller bekræftelse', async () => {
    track('getState', mockClient.timerSync.getStateWithVersion.query, async () => otherSession);
    const result = await stopTimerOnServer(localRunning, { fallbackDescription: 'x', now: new Date(T0.getTime() + 3 * 3_600_000) });
    expect(result).toEqual({ kind: 'session_changed' });
    expect(calls).toEqual(['getState']);
  });

  it('stop: en pause lagt på web (ikke kørende, tid i baseSeconds) claimes ikke', async () => {
    track('getState', mockClient.timerSync.getStateWithVersion.query, async () => ({ ...idle, baseSeconds: 1800, version: 9 }));
    const result = await stopTimerOnServer(localRunning, { fallbackDescription: 'x' });
    expect(result).toEqual({ kind: 'session_changed' });
    expect(calls).toEqual(['getState']);
  });

  it('stop: serverens sessions-afvisning (no_timer/session_mismatch) er endelig, ikke en claim-fejl', async () => {
    for (const reason of ['no_timer', 'session_mismatch']) {
      track('claim', mockClient.timerSync.claimForStop.mutate, async () => ({ success: false, reason }));
      const result = await stopTimerOnServer(localRunning, { fallbackDescription: 'x' });
      expect(result).toEqual({ kind: 'session_changed' });
    }
    expect(mockClient.time.create.mutate).not.toHaveBeenCalled();
  });

  it('stop: samme session inden for et sekunds afrunding stoppes som normalt', async () => {
    track('getState', mockClient.timerSync.getStateWithVersion.query, async () => ({ ...runningOnServer, startTime: new Date(T0.getTime() + 400).toISOString() }));
    const result = await stopTimerOnServer(localRunning, { fallbackDescription: 'x', now: new Date(T0.getTime() + 3_600_000) });
    expect(result.kind).toBe('saved');
  });

  it('kassér: rydder ikke en anden session', async () => {
    track('getState', mockClient.timerSync.getStateWithVersion.query, async () => otherSession);
    expect(await discardTimerOnServer(localRunning)).toEqual({ kind: 'session_changed' });
    expect(mockClient.timerSync.clear.mutate).not.toHaveBeenCalled();
  });

  it('kassér: rydder vores egen session med sessions-tjekket', async () => {
    expect(await discardTimerOnServer(localRunning)).toEqual({ kind: 'discarded' });
    expect(mockClient.timerSync.clear.mutate).toHaveBeenCalledWith({ source: 'web', expectedVersion: 5, expectedStartTime: T0.getTime() });
  });

  it('kassér: en allerede ryddet række kræver intet kald', async () => {
    track('getState', mockClient.timerSync.getStateWithVersion.query, async () => ({ ...idle, version: 4 }));
    expect(await discardTimerOnServer(localRunning)).toEqual({ kind: 'discarded' });
    expect(mockClient.timerSync.clear.mutate).not.toHaveBeenCalled();
  });

  it('kassér: serverens session_mismatch-svar respekteres', async () => {
    track('clear', mockClient.timerSync.clear.mutate, async () => ({ success: false, reason: 'session_mismatch' }));
    expect(await discardTimerOnServer(localRunning)).toEqual({ kind: 'session_changed' });
  });

  it('skift: skriver ikke den gamle start og kunde ind over en ny session', async () => {
    track('getState', mockClient.timerSync.getStateWithVersion.query, async () => otherSession);
    expect(await updateTimerOnServer({ ...localRunning, projectId: 'p3' })).toBeNull();
    expect(mockClient.timerSync.sync.mutate).not.toHaveBeenCalled();
  });

  it('skift: samme session sender heartbeat med sessions-tjekket', async () => {
    const next = await updateTimerOnServer({ ...localRunning, projectId: 'p3' });
    expect(next).toMatchObject({ projectId: 'p3', version: 1 });
    expect(mockClient.timerSync.sync.mutate).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'p3',
      isFreshStart: false,
      expectedVersion: 5,
      expectedStartTime: T0.getTime(),
    }));
  });
});

describe('stale start', () => {
  it('not_running + staleStart på en frisk start er en endelig afvisning', async () => {
    track('getState', mockClient.timerSync.getStateWithVersion.query, async () => idle);
    track('sync', mockClient.timerSync.sync.mutate, async () => ({ success: false, reason: 'not_running', staleStart: true, version: 3 }));
    expect(await startTimerOnServer(EMPTY_TIMER, T0)).toEqual({ kind: 'blocked', reason: 'stale_start' });
  });
});

describe('klippekort ved timer-stop', () => {
  const card = (id: string, extra: Record<string, unknown> = {}) => ({ id, name: id, remainingHours: 5, hourlyRate: 0, expiryDate: null, clipSizeMinutes: null, autoDeduct: true, ...extra });
  const STOP = new Date(T0.getTime() + 3_600_000);

  it('trækker på kundens auto-træk-kort (det der udløber først)', async () => {
    track('prepaid', mockClient.prepaid.getActiveForClient.query, async () => [
      card('uden-udloeb'),
      card('udloeber-snart', { expiryDate: '2026-09-30T00:00:00.000Z' }),
    ]);
    const result = await stopTimerOnServer(localRunning, { fallbackDescription: 'x', now: STOP });
    expect(mockClient.prepaid.getActiveForClient.query).toHaveBeenCalledWith({ clientId: 'c1' });
    expect(mockClient.time.create.mutate).toHaveBeenCalledWith(expect.objectContaining({ prepaidPackageId: 'udloeber-snart' }));
    expect(result).toMatchObject({ kind: 'saved', hours: 1 });
  });

  it('afvises kortet, gemmes tiden uden kort — og brugeren får det at vide', async () => {
    track('prepaid', mockClient.prepaid.getActiveForClient.query, async () => [card('k1')]);
    mockClient.time.create.mutate
      .mockImplementationOnce(async () => {
        throw new Error('Klippekortet er udløbet');
      })
      .mockImplementationOnce(async () => ({ id: 'e1', complianceWarnings: [] }));
    const result = await stopTimerOnServer(localRunning, { fallbackDescription: 'x', now: STOP });
    expect(mockClient.time.create.mutate).toHaveBeenCalledTimes(2);
    expect(mockClient.time.create.mutate.mock.calls[1][0]).not.toHaveProperty('prepaidPackageId');
    expect(result).toMatchObject({ kind: 'saved', prepaidSkipped: true });
  });

  it('en anden fejl end kortet prøves IKKE igen uden kort (claimet frigives)', async () => {
    track('prepaid', mockClient.prepaid.getActiveForClient.query, async () => [card('k1')]);
    mockClient.time.create.mutate.mockImplementationOnce(async () => {
      throw afvisning('Projektet er lukket');
    });
    const result = await stopTimerOnServer(localRunning, { fallbackDescription: 'x', now: STOP });
    expect(mockClient.time.create.mutate).toHaveBeenCalledTimes(1);
    expect(result.kind).toBe('save_failed');
  });

  it('slår ikke kortet op, når klippekort-modulet er slået fra', async () => {
    await stopTimerOnServer(localRunning, { fallbackDescription: 'x', now: STOP, autoPrepaid: false });
    expect(mockClient.prepaid.getActiveForClient.query).not.toHaveBeenCalled();
    expect(mockClient.time.create.mutate.mock.calls[0][0]).not.toHaveProperty('prepaidPackageId');
  });

  it('et fejlet kort-opslag vælter aldrig stoppet', async () => {
    track('prepaid', mockClient.prepaid.getActiveForClient.query, async () => {
      throw new Error('net');
    });
    const result = await stopTimerOnServer(localRunning, { fallbackDescription: 'x', now: STOP });
    expect(result.kind).toBe('saved');
    expect(mockClient.time.create.mutate.mock.calls[0][0]).not.toHaveProperty('prepaidPackageId');
  });
});

const SID = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';

describe('server-udstedte sessioner: stop (fase 2)', () => {
  const STOP = new Date(T0.getTime() + 3_600_000);
  const local = { ...localRunning, sessionId: SID, projectName: 'Website', clientName: 'Acme' };

  beforeEach(() => {
    track('getState', mockClient.timerSync.getStateWithVersion.query, async () => ({ ...runningOnServer, sessionId: SID }));
    track('claim', mockClient.timerSync.claimForStop.mutate, async () => ({
      success: true,
      version: 6,
      sessionId: SID,
      session: { id: SID, projectId: 'p1', clientId: 'c1', taskId: null, description: '', startedAt: T0.toISOString() },
    }));
  });

  it('sender sessionId på claim, time.create (timerSessionId) og confirm', async () => {
    const result = await stopTimerOnServer(local, { fallbackDescription: 'x', now: STOP });
    expect(result.kind).toBe('saved');
    expect(mockClient.timerSync.claimForStop.mutate).toHaveBeenCalledWith(expect.objectContaining({ sessionId: SID, expectedStartTime: T0.getTime() }));
    expect(mockClient.time.create.mutate).toHaveBeenCalledWith(expect.objectContaining({ timerSessionId: SID }));
    expect(mockClient.timerSync.confirmStop.mutate).toHaveBeenCalledWith({ version: 6, source: 'web', sessionId: SID });
  });

  it('lærer id fra serveren, når den lokale kopi er fra før feltet fandtes', async () => {
    await stopTimerOnServer({ ...localRunning, sessionId: null }, { fallbackDescription: 'x', now: STOP });
    expect(mockClient.timerSync.claimForStop.mutate).toHaveBeenCalledWith(expect.objectContaining({ sessionId: SID }));
    expect(mockClient.time.create.mutate).toHaveBeenCalledWith(expect.objectContaining({ timerSessionId: SID }));
  });

  it('k3 (#785): posten gemmes på sessionens projekt fra claimet, ikke telefonens forældede', async () => {
    track('getState', mockClient.timerSync.getStateWithVersion.query, async () => ({
      ...runningOnServer,
      sessionId: SID,
      projectId: 'p2',
      clientId: 'c2',
      project: { id: 'p2', name: 'Shop', clientId: 'c2' },
      client: { id: 'c2', name: 'Beta' },
    }));
    track('claim', mockClient.timerSync.claimForStop.mutate, async () => ({
      success: true,
      version: 6,
      sessionId: SID,
      session: { id: SID, projectId: 'p2', clientId: 'c2', taskId: null, description: '', startedAt: T0.toISOString() },
    }));
    await stopTimerOnServer(local, { fallbackDescription: 'x', now: STOP });
    expect(mockClient.time.create.mutate).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: 'p2', clientId: 'c2', description: 'Shop', timerSessionId: SID }),
    );
  });

  it('k1 (#783): tabt svar på time.create frigiver IKKE claimet', async () => {
    track('create', mockClient.time.create.mutate, async () => {
      throw netfejl();
    });
    const result = await stopTimerOnServer(local, { fallbackDescription: 'x', now: STOP });
    expect(result).toMatchObject({ kind: 'save_failed', claimKept: true });
    expect(mockClient.timerSync.cancelStop.mutate).not.toHaveBeenCalled();
    expect(mockClient.timerSync.confirmStop.mutate).not.toHaveBeenCalled();
  });

  it('k1: genkaldet fra journalen genbruger claimet og gemmer med samme sessionId', async () => {
    track('getState', mockClient.timerSync.getStateWithVersion.query, async () => stuckStopping({ sessionId: SID, version: 6 }));
    track('create', mockClient.time.create.mutate, async () => ({ id: 'e1', deduplicated: true, complianceWarnings: [] }));
    const result = await stopTimerOnServer(local, { fallbackDescription: 'x', now: STOP, ownClaim: true });
    expect(calls).not.toContain('claim');
    expect(mockClient.time.create.mutate).toHaveBeenCalledWith(expect.objectContaining({ timerSessionId: SID }));
    expect(mockClient.timerSync.confirmStop.mutate).toHaveBeenCalledWith({ version: 6, source: 'web', sessionId: SID });
    expect(result.kind).toBe('saved');
  });

  it('endelig afvisning: cancelStop bærer sessionId, og already_saved betyder at stoppet er gennemført', async () => {
    track('create', mockClient.time.create.mutate, async () => {
      throw afvisning('Projektet er lukket');
    });
    track('cancel', mockClient.timerSync.cancelStop.mutate, async () => ({ success: false, reason: 'already_saved', version: 8, sessionId: SID }));
    const result = await stopTimerOnServer(local, { fallbackDescription: 'x', now: STOP });
    expect(mockClient.timerSync.cancelStop.mutate).toHaveBeenCalledWith({ version: 6, source: 'web', sessionId: SID });
    expect(result).toMatchObject({ kind: 'saved', alreadySaved: true });
    // Intet genforsøg: hverken ny post eller confirm.
    expect(mockClient.time.create.mutate).toHaveBeenCalledTimes(1);
    expect(mockClient.timerSync.confirmStop.mutate).not.toHaveBeenCalled();
  });

  it('en anden session på serveren (samme start, andet id) stoppes ikke', async () => {
    track('getState', mockClient.timerSync.getStateWithVersion.query, async () => ({ ...runningOnServer, sessionId: OTHER }));
    const result = await stopTimerOnServer(local, { fallbackDescription: 'x', now: STOP });
    expect(result).toEqual({ kind: 'session_changed' });
    expect(calls).toEqual(['getState']);
  });

  it('claimets session_mismatch er session_changed — intet gemmes, intet genopstår', async () => {
    track('claim', mockClient.timerSync.claimForStop.mutate, async () => ({ success: false, reason: 'session_mismatch', version: 9, sessionId: OTHER }));
    const result = await stopTimerOnServer(local, { fallbackDescription: 'x', now: STOP });
    expect(result).toEqual({ kind: 'session_changed' });
    expect(mockClient.time.create.mutate).not.toHaveBeenCalled();
  });
});

describe('server-udstedte sessioner: genoptaget claim (fase 2)', () => {
  const STOP = new Date(T0.getTime() + 3_600_000);
  const local = { ...localRunning, sessionId: SID };

  it('et genoptaget claim gemmes med rækkens projekt, opgave og (også tom) beskrivelse', async () => {
    track('getState', mockClient.timerSync.getStateWithVersion.query, async () => stuckStopping({
      sessionId: SID,
      version: 6,
      projectId: 'p2',
      clientId: 'c2',
      description: '',
      project: { id: 'p2', name: 'Shop', clientId: 'c2' },
      client: { id: 'c2', name: 'Beta' },
    }));
    mockClient.timerSync.getState.query.mockResolvedValueOnce({ taskId: 't9' });
    await stopTimerOnServer({ ...local, taskId: 't1', description: 'Gammel' }, { fallbackDescription: 'x', now: STOP, ownClaim: true });
    expect(mockClient.time.create.mutate).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: 'p2', clientId: 'c2', taskId: 't9', description: 'Shop' }),
    );
  });
});

describe('server-udstedte sessioner: start, skift, kassér, afstemning (fase 2)', () => {
  const local = { ...localRunning, sessionId: SID };

  beforeEach(() => {
    track('getState', mockClient.timerSync.getStateWithVersion.query, async () => ({ ...runningOnServer, sessionId: SID }));
  });

  it('start gemmer serverens sessionId', async () => {
    track('getState', mockClient.timerSync.getStateWithVersion.query, async () => idle);
    track('sync', mockClient.timerSync.sync.mutate, async () => ({ success: true, version: 1, syncedAt: '', sessionId: SID }));
    const result = await startTimerOnServer({ projectId: 'p1', clientId: 'c1', taskId: null, description: '', projectName: null, clientName: null }, T0);
    expect(result).toMatchObject({ kind: 'started', state: { sessionId: SID } });
  });

  it('adoption tager serverens sessionId med', async () => {
    const result = await startTimerOnServer({ projectId: null, clientId: null, taskId: null, description: '', projectName: null, clientName: null }, T0);
    expect(result).toMatchObject({ kind: 'adopted', state: { sessionId: SID } });
  });

  it('heartbeat/skift sender sessionId, og session_mismatch giver afstemning', async () => {
    track('sync', mockClient.timerSync.sync.mutate, async () => ({ success: false, reason: 'session_mismatch', sessionId: OTHER, isRunning: true, version: 9 }));
    const result = await updateTimerOnServer(local);
    expect(mockClient.timerSync.sync.mutate).toHaveBeenCalledWith(expect.objectContaining({ sessionId: SID }));
    expect(result).toBeNull();
  });

  it('kassér sender sessionId, og en anden session ryddes ikke', async () => {
    await discardTimerOnServer(local);
    expect(mockClient.timerSync.clear.mutate).toHaveBeenCalledWith(expect.objectContaining({ sessionId: SID }));
    track('getState', mockClient.timerSync.getStateWithVersion.query, async () => ({ ...runningOnServer, sessionId: OTHER }));
    mockClient.timerSync.clear.mutate.mockClear();
    expect(await discardTimerOnServer(local)).toEqual({ kind: 'session_changed' });
    expect(mockClient.timerSync.clear.mutate).not.toHaveBeenCalled();
  });

  it('afstemning adopterer serverens sessionId', async () => {
    const next = await reconcileTimer({ ...localRunning, sessionId: null });
    expect(next.sessionId).toBe(SID);
  });
});
