import type { ServerTimerState, TimerPersisted } from './timer-logic';
import type { PendingStop } from './timer-recovery';

const mockMemory = new Map<string, string>();

jest.mock('~/lib/storage', () => ({
  storage: {
    getString: (k: string) => mockMemory.get(k),
    set: (k: string, v: string) => mockMemory.set(k, v),
    remove: (k: string) => mockMemory.delete(k),
  },
}));

jest.mock('./timer-service', () => ({
  fetchServerTimer: jest.fn(),
  stopTimerOnServer: jest.fn(),
  rescueParkedStop: jest.fn(),
}));

// eslint-disable-next-line import/first
import { EMPTY_TIMER } from './timer-logic';
// eslint-disable-next-line import/first
import {
  getPendingStop,
  PENDING_STOP_KEY,
  recoverPendingStop,
  resolvePendingStop,
  setPendingStop,
} from './timer-recovery';

const T0 = new Date('2026-09-29T08:00:00.000Z');
const START = T0.toISOString();
/** Stop-øjeblikket i journalen — det nøglen `findSavedEntry` matcher på. */
const STOPPED_AT = '2026-09-29T09:30:00.000Z';

function serverRunning(startTime: string, version = 4): ServerTimerState {
  return {
    ...EMPTY_SERVER,
    isRunning: true,
    startTime,
    version,
  };
}

const EMPTY_SERVER: ServerTimerState = {
  isRunning: false,
  startTime: null,
  elapsedSeconds: 0,
  baseSeconds: 0,
  projectId: null,
  clientId: null,
  description: '',
  project: null,
  client: null,
  version: 4,
  intent: null,
  intentAt: null,
  intentFrom: null,
} as unknown as ServerTimerState;

function runningLocal(): TimerPersisted {
  return { ...EMPTY_TIMER, startTime: START, projectId: 'p1', description: 'Ryggeplads' };
}

/**
 * Serverens cron (`api/cron/timer-cleanup`) parkerer et stopping-intent,
 * der har stået over 5 minutter, som en pause: rækken er ikke længere
 * kørende, men bærer den optalte tid i `baseSeconds`.
 */
function parkedOnServer(seconds = 5_400): ServerTimerState {
  return {
    ...EMPTY_SERVER,
    isRunning: false,
    startTime: null,
    elapsedSeconds: seconds,
    baseSeconds: seconds,
    version: 6,
  } as unknown as ServerTimerState;
}

function pending(): PendingStop {
  return { state: runningLocal(), stoppedAt: STOPPED_AT };
}

describe('resolvePendingStop', () => {
  it('genkører stoppet når serveren stadig kører den afbrudte session', () => {
    expect(resolvePendingStop(serverRunning(START), pending())).toEqual({ kind: 'resume_stop' });
  });

  it('genkører ikke når serveren kører en anden session med samme start (andet sessions-id)', () => {
    const journal = { ...pending(), state: { ...runningLocal(), sessionId: 's-1' } };
    expect(resolvePendingStop({ ...serverRunning(START), sessionId: 's-2' }, journal)).toEqual({ kind: 'replaced' });
    expect(resolvePendingStop({ ...serverRunning(START), sessionId: 's-1' }, journal)).toEqual({ kind: 'resume_stop' });
  });

  it('en journal fra før sessions-id fandtes genkøres stadig på starttiden', () => {
    expect(resolvePendingStop({ ...serverRunning(START), sessionId: 's-1' }, pending())).toEqual({ kind: 'resume_stop' });
  });

  it('regner et stop som gemt når serveren ikke længere kører', () => {
    expect(resolvePendingStop(EMPTY_SERVER, pending())).toEqual({ kind: 'already_saved' });
  });

  it('kører aldrig en ny post når serveren ikke kører, selv om versionen er 0', () => {
    const fresh = { ...EMPTY_SERVER, version: 0 } as ServerTimerState;
    expect(resolvePendingStop(fresh, pending())).toEqual({ kind: 'already_saved' });
  });

  it('giver op når serveren kører en annen session', () => {
    expect(resolvePendingStop(serverRunning('2026-09-29T07:00:00.000Z'), pending()))
      .toEqual({ kind: 'replaced' });
  });

  it('genkender en parkeret række, hvor gemningen aldrig kom igennem', () => {
    // Uden denne skeln går `!isRunning` for at være "posten er gemt", og
    // journalen rydes — altså taber brugeren den time, de stoppede.
    expect(resolvePendingStop(parkedOnServer(), pending())).toEqual({ kind: 'parked' });
  });

  it('regner kun en helt ryddet række som gemt', () => {
    expect(resolvePendingStop({ ...EMPTY_SERVER, elapsedSeconds: 0, baseSeconds: 0 }, pending()))
      .toEqual({ kind: 'already_saved' });
  });
});

describe('journal', () => {
  beforeEach(() => mockMemory.clear());

  it('overlever et dræb: skriv, læs, skriv igen', () => {
    setPendingStop(pending());
    expect(getPendingStop()).toEqual(pending());
  });

  it('rydes ved nulstilling', () => {
    setPendingStop(pending());
    setPendingStop(null);
    expect(getPendingStop()).toBeNull();
    expect(mockMemory.has(PENDING_STOP_KEY)).toBe(false);
  });

  it('læser en afkortet værdi som ingen journal', () => {
    mockMemory.set(PENDING_STOP_KEY, JSON.stringify({ stoppedAt: '2026-09-29T09:30:00.000Z' }));
    expect(getPendingStop()).toBeNull();
  });

  it('overlever beskadiget JSON uden at kaste', () => {
    mockMemory.set(PENDING_STOP_KEY, '{"stoppedAt":');
    expect(getPendingStop()).toBeNull();
  });
});

type StopOpts = { fallbackDescription: string; now?: Date; ownClaim?: boolean };
type StopArgs = [TimerPersisted, StopOpts];
const stopKind = (kind: string) => jest.fn((_state: TimerPersisted, _opts: StopOpts) => Promise.resolve({ kind }));

describe('recoverPendingStop', () => {
  beforeEach(() => mockMemory.clear());

  const stopOk = () => jest.fn((_state: TimerPersisted, _opts: StopOpts) => Promise.resolve({ kind: 'saved' }));
  const stopThrows = () => jest.fn((_state: TimerPersisted, _opts: StopOpts) => Promise.reject(new Error('Network request failed')));

  it('gør intet når der ikke er en journal', async () => {
    const fetchServer = jest.fn();
    const result = await recoverPendingStop({ fetchServer });
    expect(result).toEqual({ kind: 'none' });
    expect(fetchServer).not.toHaveBeenCalled();
  });

  it('beholder journalen når serveren ikke kan nås, så intet tid tabes', async () => {
    setPendingStop(pending());
    const stop = stopOk();
    const result = await recoverPendingStop({
      fetchServer: () => Promise.reject(new Error('Network request failed')),
      stop,
    });
    expect(result).toEqual({ kind: 'none' });
    expect(stop).not.toHaveBeenCalled();
    expect(getPendingStop()).toEqual(pending());
  });

  it('rydder journalen når serveren viser, at posten allerede er gemt', async () => {
    setPendingStop(pending());
    const stop = stopOk();
    const result = await recoverPendingStop({ fetchServer: () => Promise.resolve(EMPTY_SERVER), stop });
    expect(result).toEqual({ kind: 'cleared', action: 'already_saved' });
    expect(stop).not.toHaveBeenCalled();
    expect(getPendingStop()).toBeNull();
  });

  it('genkører stoppet med det oprindelige stop-tidspunkt, så timeposten er identisk', async () => {
    setPendingStop(pending());
    const stop = stopOk();
    const result = await recoverPendingStop({ fetchServer: () => Promise.resolve(serverRunning(START)), stop });

    expect(result).toEqual({ kind: 'resumed', saved: true });
    expect(stop).toHaveBeenCalledTimes(1);
    const [state, opts] = stop.mock.calls[0] as StopArgs;
    expect(state.startTime).toBe(START);
    expect(opts.now?.toISOString()).toBe('2026-09-29T09:30:00.000Z');
    expect(getPendingStop()).toBeNull();
  });

  it('gør krav på, at claimet er vores — journalen er beviset', async () => {
    // Serveren sender `source: 'web'` for både web-appen og mobilen, så
    // `intentFrom` kan ikke bevise ejerskab. Journalen kan: den findes kun,
    // fordi VI tog et claim til et stop, der aldrig blev bekræftet.
    setPendingStop(pending());
    const stop = stopOk();
    await recoverPendingStop({ fetchServer: () => Promise.resolve(serverRunning(START)), stop });
    const [, opts] = stop.mock.calls[0] as StopArgs;
    expect(opts.ownClaim).toBe(true);
  });

  it('beholder journalen når det gentagne stop ikke lykkes', async () => {
    setPendingStop(pending());
    const stop = stopKind('claim_failed');
    const result = await recoverPendingStop({ fetchServer: () => Promise.resolve(serverRunning(START)), stop });
    expect(result).toEqual({ kind: 'resumed', saved: false });
    expect(getPendingStop()).toEqual(pending());
  });

  it('beholder journalen når posten er gemt, men claimet ikke kunne bekræftes', async () => {
    setPendingStop(pending());
    const stop = stopKind('saved_unconfirmed');
    const result = await recoverPendingStop({ fetchServer: () => Promise.resolve(serverRunning(START)), stop });
    // Tiden ER gemt, så den tælles som reddet — men serveren hænger stadig
    // i 'stopping', så journalen bliver liggende til næste forsøg.
    expect(result).toEqual({ kind: 'resumed', saved: true });
    expect(getPendingStop()).toEqual(pending());
  });

  it('beholder journalen når det gentagne stop kaster (tabt net undervejs)', async () => {
    setPendingStop(pending());
    const stop = stopThrows();
    const result = await recoverPendingStop({ fetchServer: () => Promise.resolve(serverRunning(START)), stop });
    expect(result).toEqual({ kind: 'resumed', saved: false });
    expect(getPendingStop()).toEqual(pending());
  });

  it('rydder journalen når serveren kører en anden session — vi er overhalet', async () => {
    setPendingStop(pending());
    const stop = stopOk();
    const result = await recoverPendingStop({
      fetchServer: () => Promise.resolve(serverRunning('2026-09-29T07:00:00.000Z')),
      stop,
    });
    expect(result).toEqual({ kind: 'cleared', action: 'replaced' });
    expect(stop).not.toHaveBeenCalled();
    expect(getPendingStop()).toBeNull();
  });

  it('kører hvert genkald igennem, selv om de kaldes samtidig', async () => {
    setPendingStop(pending());
    const stop = stopOk();
    const fetchServer = jest.fn(() => Promise.resolve(serverRunning(START)));
    await Promise.all([recoverPendingStop({ fetchServer, stop }), recoverPendingStop({ fetchServer, stop })]);
    expect(stop).toHaveBeenCalledTimes(1);
  });
});

describe('parkeret stop (cronen har lagt rækken til side som pause)', () => {
  beforeEach(() => mockMemory.clear());

  type StopArgs = [TimerPersisted, { fallbackDescription: string; now?: Date; expectedVersion?: number }];
  const rescueResult = (kind: string) => jest.fn((_state: TimerPersisted, _opts: { fallbackDescription: string; now?: Date; expectedVersion?: number }) => Promise.resolve({ kind }));
  const rescueSaved = () => rescueResult('saved');
  const rescueFailed = () => rescueResult('save_failed');
  const rescueThrows = () => jest.fn((_state: TimerPersisted, _opts: { fallbackDescription: string; now?: Date; expectedVersion?: number }) => Promise.reject(new Error('Network request failed')));

  it('giver redningen den version, rækken havde da vi besluttede at redde den', async () => {
    // Beviset på, at rækken stadig er den vi redder. Uden det nulstiller
    // `clearParkedRow` enhver pause brugeren lagde på web imens redningen kørte.
    setPendingStop(pending());
    const rescue = rescueSaved();
    await recoverPendingStop({ fetchServer: () => Promise.resolve(parkedOnServer()), rescue });
    const [, opts] = rescue.mock.calls[0] as StopArgs;
    expect(opts.expectedVersion).toBe(6);
  });

  it('gemmer den tabte post fra journalen og rydder bagefter', async () => {
    setPendingStop(pending());
    const rescue = rescueSaved();
    const result = await recoverPendingStop({ fetchServer: () => Promise.resolve(parkedOnServer()), rescue });
    expect(result).toEqual({ kind: 'rescued', saved: true });
    const [state, opts] = rescue.mock.calls[0] as StopArgs;
    expect(state.startTime).toBe(START);
    expect(opts.now?.toISOString()).toBe('2026-09-29T09:30:00.000Z');
    expect(getPendingStop()).toBeNull();
  });

  it('beholder journalen når redningen mislykkes, så næste forsøg kan prøve igen', async () => {
    setPendingStop(pending());
    const result = await recoverPendingStop({
      fetchServer: () => Promise.resolve(parkedOnServer()),
      rescue: rescueFailed(),
    });
    expect(result).toEqual({ kind: 'rescued', saved: false });
    expect(getPendingStop()).toEqual(pending());
  });

  it('beholder journalen når redningen kaster (tabt net undervejs)', async () => {
    setPendingStop(pending());
    const result = await recoverPendingStop({
      fetchServer: () => Promise.resolve(parkedOnServer()),
      rescue: rescueThrows(),
    });
    expect(result).toEqual({ kind: 'rescued', saved: false });
    expect(getPendingStop()).toEqual(pending());
  });
});

/**
 * En `save_failed` betyder, at kallet kan have gemt posten, før det svarede
 * med en fejl. Genkaldet skal derfor bruge SAMME `stoppedAt` som det første —
 * det er den nøgle `findSavedEntry` matcher på, når kæden slår dagen op for
 * at se, om posten allerede findes. Uden den oprettede næste forsøg det
 * samme tidsrum en gang til.
 */
describe('genkøring af en stop-kæde, der døde med en fejl', () => {
  beforeEach(() => mockMemory.clear());

  it('genbruger stop-øjeblikket fra journalen', async () => {
    setPendingStop(pending());
    const stop = stopKind('save_failed');
    await recoverPendingStop({ fetchServer: () => Promise.resolve(serverRunning(START)), stop });
    const [, opts] = stop.mock.calls[0] as StopArgs;
    expect(opts.now).toEqual(new Date(STOPPED_AT));
  });

  it('gør krav på eget claim, så en kørende web-stop ikke overtages', async () => {
    setPendingStop(pending());
    const stop = stopKind('save_failed');
    await recoverPendingStop({ fetchServer: () => Promise.resolve(serverRunning(START)), stop });
    const [, opts] = stop.mock.calls[0] as StopArgs;
    expect(opts.ownClaim).toBe(true);
  });
});
