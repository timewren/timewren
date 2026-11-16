import type { TimerPersisted } from './timer-logic';
import type { StartOptions } from './use-timer-commands';
import { renderHook } from '@testing-library/react-native';
import { isOffline } from '~/features/offline/enqueue';
import { offlineQueue } from '~/features/offline/queue-store';
import { announce, showMessage } from '~/lib/notify';
import { getPendingStop, recoverPendingStop } from './timer-recovery';
import { startTimerOnServer } from './timer-service';
import { getTimerState, timerActions } from './timer-store';
import { useTimerCommands } from './use-timer-commands';

jest.mock('~/features/offline/enqueue', () => ({ isOffline: jest.fn(() => false) }));
jest.mock('expo-crypto', () => {
  let n = 0;
  return { randomUUID: () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}` };
});
jest.mock('~/lib/notify', () => ({ announce: jest.fn(), showMessage: jest.fn() }));
jest.mock('~/lib/api', () => ({ errorMessage: (e: unknown) => (e as Error)?.message ?? 'fejl' }));
jest.mock('~/lib/api/provider', () => ({ queryClient: { invalidateQueries: jest.fn() } }));
jest.mock('~/lib/i18n', () => ({
  translate: (key: string, vars?: Record<string, string>) => (vars ? `${key}(${vars.name})` : key),
}));
jest.mock('./timer-service', () => ({
  discardTimerOnServer: jest.fn(),
  startTimerOnServer: jest.fn(),
  updateTimerOnServer: jest.fn(),
}));
jest.mock('./timer-recovery', () => ({
  getPendingStop: jest.fn(() => null),
  recoverPendingStop: jest.fn(async () => ({ kind: 'none' as const })),
}));

const serverStart = startTimerOnServer as jest.Mock;
const readJournal = getPendingStop as jest.MockedFunction<typeof getPendingStop>;
const recover = recoverPendingStop as jest.MockedFunction<typeof recoverPendingStop>;

const selection: StartOptions = {
  clientId: 'c1',
  projectId: 'p1',
  clientName: 'Acme Support',
  projectName: 'Drift',
  description: '',
};

const START = '2026-09-30T08:00:00.000Z';
const STOPPED_AT = '2026-09-30T09:30:00.000Z';

function running(): TimerPersisted {
  return { ...getTimerState(), startTime: START, baseSeconds: 0 };
}

function commands() {
  const deps = {
    reconcile: jest.fn(async () => {}),
    setBusy: jest.fn(),
    utils: { timerSync: { invalidate: jest.fn() } },
  } as unknown as Parameters<typeof useTimerCommands>[0];
  return renderHook(() => useTimerCommands(deps));
}

beforeEach(() => {
  jest.clearAllMocks();
  (isOffline as jest.Mock).mockReturnValue(false);
  readJournal.mockReturnValue(null);
  recover.mockResolvedValue({ kind: 'none' });
  timerActions().reset();
});

describe('start melder til skærmlæseren', () => {
  it('siger, at timeren kører, og nævner hvad for', async () => {
    serverStart.mockResolvedValue({ kind: 'started', state: running() });
    const { result } = commands();
    await result.current.start(selection);
    expect(announce).toHaveBeenCalledWith('timer.started_for(Acme Support · Drift)');
  });

  it('sager det uden navn, når intet er valgt', async () => {
    serverStart.mockResolvedValue({ kind: 'started', state: running() });
    const { result } = commands();
    await result.current.start({ description: 'intern' });
    expect(announce).toHaveBeenCalledWith('timer.started');
  });

  it('siger intet, når starten blev afvist — blokeringen er allerede meldt', async () => {
    serverStart.mockResolvedValue({ kind: 'blocked', reason: 'stopping_in_progress' });
    const { result } = commands();
    await expect(result.current.start(selection)).resolves.toBe(false);
    expect(announce).not.toHaveBeenCalled();
    expect(showMessage).toHaveBeenCalledWith({ message: 'timer.blocked', type: 'danger' });
  });

  it('siger intet, når timeren allerede kørte fra en anden enhed — den har sin egen melding', async () => {
    serverStart.mockResolvedValue({ kind: 'adopted', state: running() });
    const { result } = commands();
    await result.current.start(selection);
    expect(announce).not.toHaveBeenCalled();
    expect(showMessage).toHaveBeenCalledWith({ message: 'timer.adopted', type: 'info' });
  });

  it('siger intet uden net — offline-toasten bliver læst i stedet', async () => {
    (isOffline as jest.Mock).mockReturnValue(true);
    const { result } = commands();
    await result.current.start(selection);
    expect(announce).not.toHaveBeenCalled();
    expect(showMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'info' }));
  });

  it('kører slet ikke serveren, når der ikke er net', async () => {
    (isOffline as jest.Mock).mockReturnValue(true);
    const { result } = commands();
    await result.current.start(selection);
    expect(serverStart).not.toHaveBeenCalled();
    expect(getTimerState().startTime).not.toBeNull();
  });
});

/**
 * Et afbrudt stop (`saved_unconfirmed`) efterlader serverens række i
 * 'stopping', så næste start afvises med `stopping_in_progress`. Før dette kun
 * recovery ved mount og forgrund kunne fjerne blokeringen — brugeren skulle
 * lukke og åbne appen for at komme videre med tiden.
 */
describe('start efter et afbrudt stop', () => {
  const journal = { state: { ...getTimerState(), startTime: START }, stoppedAt: STOPPED_AT };

  beforeEach(() => {
    readJournal.mockReturnValue(journal as ReturnType<typeof getPendingStop>);
    recover.mockResolvedValue({ kind: 'resumed', saved: true });
  });

  it('færdiggør eget afbrudt stop og prøver igen — tiden kan fortsætte med det samme', async () => {
    serverStart.mockResolvedValueOnce({ kind: 'blocked', reason: 'stopping_in_progress' });
    serverStart.mockResolvedValueOnce({ kind: 'started', state: running() });
    const { result } = commands();
    await expect(result.current.start(selection)).resolves.toBe(true);
    expect(recover).toHaveBeenCalledTimes(1);
    expect(serverStart).toHaveBeenCalledTimes(2);
    expect(announce).toHaveBeenCalledWith('timer.started_for(Acme Support · Drift)');
    expect(showMessage).not.toHaveBeenCalledWith({ message: 'timer.blocked', type: 'danger' });
  });

  it('melder blokeringen, hvis genkaldet stadig bliver afvist', async () => {
    serverStart.mockResolvedValue({ kind: 'blocked', reason: 'stopping_in_progress' });
    const { result } = commands();
    await expect(result.current.start(selection)).resolves.toBe(false);
    expect(serverStart).toHaveBeenCalledTimes(2);
    expect(showMessage).toHaveBeenCalledWith({ message: 'timer.blocked', type: 'danger' });
  });

  it('lader være at færdiggøre et stop, der ikke er vores', async () => {
    readJournal.mockReturnValue(null);
    serverStart.mockResolvedValue({ kind: 'blocked', reason: 'stopping_in_progress' });
    const { result } = commands();
    await expect(result.current.start(selection)).resolves.toBe(false);
    expect(recover).not.toHaveBeenCalled();
    expect(serverStart).toHaveBeenCalledTimes(1);
  });

  it('genprøver kun en blokering, der handler om et stop i gang', async () => {
    serverStart.mockResolvedValue({ kind: 'blocked', reason: 'already_running' });
    const { result } = commands();
    await expect(result.current.start(selection)).resolves.toBe(false);
    expect(recover).not.toHaveBeenCalled();
    expect(serverStart).toHaveBeenCalledTimes(1);
  });

  it('lader en fejlet redning give besked i stedet for at starde oven på den', async () => {
    recover.mockRejectedValue(new Error('net døde'));
    serverStart.mockResolvedValue({ kind: 'blocked', reason: 'stopping_in_progress' });
    const { result } = commands();
    await expect(result.current.start(selection)).resolves.toBe(false);
    expect(serverStart).toHaveBeenCalledTimes(1);
    expect(showMessage).toHaveBeenCalledWith({ message: 'net døde', type: 'danger' });
  });
});

/**
 * Projektvælgeren (`timer-card.tsx` `onPicked`) kan ramme to gange under
 * bundarkets dismiss-animation. To `timerSync.sync`-kald med samme kilde
 * passerer begge `otherOwnerGuard` på serveren, så det er ikke en blokering
 * der redder os — den bageste start får bare et senere `startTime`, og den
 * foregående tid forsvinder. Det andet kald deler derfor det førstes svar i
 * stedet for at sende sit eget.
 */
describe('start låser et dobbelttryk', () => {
  it('sender kun ét start-kald, selv om der trykkes to gange', async () => {
    serverStart.mockResolvedValue({ kind: 'started', state: running() });
    const { result } = commands();
    await Promise.all([result.current.start(selection), result.current.start(selection)]);
    expect(serverStart).toHaveBeenCalledTimes(1);
  });

  it('melder starten til skærmlæseren én gang', async () => {
    serverStart.mockResolvedValue({ kind: 'started', state: running() });
    const { result } = commands();
    await Promise.all([result.current.start(selection), result.current.start(selection)]);
    expect(announce).toHaveBeenCalledTimes(1);
  });

  it('lader en ny start køre, når den første er færdig', async () => {
    serverStart.mockResolvedValue({ kind: 'started', state: running() });
    const { result } = commands();
    await result.current.start(selection);
    await result.current.start(selection);
    expect(serverStart).toHaveBeenCalledTimes(2);
  });

  it('låser op igen når starten fejlede', async () => {
    serverStart.mockRejectedValueOnce(new Error('net'));
    const { result } = commands();
    await expect(result.current.start(selection)).resolves.toBe(false);
    serverStart.mockResolvedValue({ kind: 'started', state: running() });
    await expect(result.current.start(selection)).resolves.toBe(true);
    expect(serverStart).toHaveBeenCalledTimes(2);
  });
});

/**
 * Køet timerstart (#703): en start uden net bliver ikke ved med at være lokal —
 * den lægges i offline-køen, så serveren og de andre enheder får sessionen,
 * når nettet er tilbage. Sessionens øjeblik er det samme lokalt og i køen.
 */
describe('start uden net lægges i offline-køen', () => {
  beforeEach(() => {
    offlineQueue().clearAll();
  });

  it('lægger en start i køen med samme øjeblik som den lokale session', async () => {
    (isOffline as jest.Mock).mockReturnValue(true);
    const { result } = commands();
    await result.current.start(selection);
    const local = getTimerState();
    const [item] = offlineQueue().items;
    expect(local.pendingSync).toBe(true);
    expect(item).toMatchObject({ type: 'timer.start' });
    expect(item?.type === 'timer.start' && new Date(item.payload.startTime ?? 0).toISOString()).toBe(local.startTime);
    expect(item?.type === 'timer.start' && item.payload.clientOpId).toEqual(expect.any(String));
  });

  it('starter lokalt og køer, når forbindelsen dør midt i starten', async () => {
    const { TRPCClientError } = jest.requireActual('@trpc/client');
    serverStart.mockRejectedValueOnce(new TRPCClientError('Network request failed'));
    const { result } = commands();
    await expect(result.current.start(selection)).resolves.toBe(true);
    expect(getTimerState().pendingSync).toBe(true);
    expect(offlineQueue().items.map(i => i.type)).toEqual(['timer.start']);
  });

  it('køer ikke en start, serveren afviste — den fejl skal brugeren se', async () => {
    serverStart.mockRejectedValueOnce(new Error('net'));
    const { result } = commands();
    await expect(result.current.start(selection)).resolves.toBe(false);
    expect(offlineQueue().items).toEqual([]);
  });
});

describe('kassér fjerner en køet start, så sessionen ikke genopstår (#703)', () => {
  it('rydder både den lokale timer og den køede start', async () => {
    (isOffline as jest.Mock).mockReturnValue(true);
    const { result } = commands();
    await result.current.start(selection);
    expect(offlineQueue().items).toHaveLength(1);
    await result.current.discard();
    expect(getTimerState().startTime).toBeNull();
    expect(offlineQueue().items).toEqual([]);
  });
});
