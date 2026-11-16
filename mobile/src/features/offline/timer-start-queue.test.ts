import type { ExecuteOutcome } from './drain';
import type { CreateInput, QueueItem, StartInput } from './queue-logic';
import type { OfflineQueueStore } from './queue-store';
import { drainQueue } from './drain';
import {
  afterFailure,
  afterTimerStartApplied,
  afterTimerStartConflict,
  dedupKey,
  enqueueItem,
  runnableItems,
} from './queue-logic';

/**
 * Køet timerstart (#703): rækkefølge, idempotens og konflikt.
 * Serverkaldet injiceres (`execute`), så dræningens regler testes alene.
 */

const T0 = Date.UTC(2026, 9, 1, 8, 0, 0);
const MIN = 60_000;
const SESSION = new Date(T0).toISOString();

function startItem(id = 'start', startMs = T0): QueueItem {
  const payload: StartInput = {
    isRunning: true,
    startTime: startMs,
    sessionStartTime: startMs,
    elapsedSeconds: 0,
    baseSeconds: 0,
    projectId: null,
    clientId: null,
    taskId: null,
    description: 'Support',
    source: 'web',
    isFreshStart: true,
    isAdoption: false,
    clientOpId: '11111111-1111-4111-8111-111111111111',
  };
  return { id, type: 'timer.start', payload, createdAt: 'x', attempts: 0, lastError: null, failed: false, nextAttemptAt: 0 };
}

function stopCreate(id = 'stop', minutes = 60, clearTimer = false): QueueItem {
  const payload: CreateInput = {
    description: 'Support',
    date: '2026-10-01',
    hours: minutes / 60,
    startTime: SESSION,
    endTime: new Date(T0 + minutes * MIN).toISOString(),
    fromTimer: true,
  };
  return { id, type: 'time.create', payload, meta: { clearTimer }, createdAt: 'x', attempts: 0, lastError: null, failed: false, nextAttemptAt: 0 };
}

function fakeStore(initial: QueueItem[]) {
  const state = { items: initial, isOnline: true, isSyncing: false, activeOrgId: undefined as string | null | undefined, ownerUserId: undefined as string | undefined };
  const store = (): OfflineQueueStore => ({
    ...state,
    enqueue: () => null,
    clearAll: () => {},
    adoptOwner: () => {},
    remove: (id) => {
      state.items = state.items.filter(i => i.id !== id);
    },
    markFailure: (id, error, now = 0) => {
      state.items = state.items.map(i => (i.id === id ? afterFailure(i, error, now) : i));
    },
    retry: () => {},
    retryAll: () => {},
    replace: (next) => {
      state.items = state.items.map(i => (i.id === next.id ? next : i));
    },
    patchItems: (fn) => {
      state.items = fn(state.items);
    },
    setOnline: () => {},
    setSyncing: (v) => {
      state.isSyncing = v;
    },
    setActiveOrgId: () => {},
  });
  return { store, state };
}

describe('køet timerstart: rækkefølge', () => {
  it('et stop af en session, hvis start stadig venter, fjerner starten (ingen spøgelsestimer)', () => {
    const { items } = enqueueItem([startItem()], stopCreate());
    expect(items.map(i => i.id)).toEqual(['stop']);
  });

  it('lader en start i backoff blokere posten bag den', () => {
    const start = afterFailure(startItem(), new Error('Network request failed'), T0);
    expect(runnableItems([start, stopCreate()], T0 + 1)).toEqual([]);
    expect(runnableItems([start, stopCreate()], T0 + 2_000).map(i => i.id)).toEqual(['start', 'stop']);
  });

  it('afspiller start før posten, og posten rydder serverens session bagefter', async () => {
    // Stoppet kom i køen, mens starten var undervejs → ingen komprimering.
    const { store, state } = fakeStore([startItem(), stopCreate()]);
    const order: string[] = [];
    const seenClearTimer: Array<boolean | undefined> = [];
    const execute = async (item: QueueItem): Promise<ExecuteOutcome | void> => {
      order.push(item.id);
      if (item.type === 'time.create')
        seenClearTimer.push(item.meta?.clearTimer);
      if (item.type === 'timer.start')
        return { kind: 'timer_started', version: 7 };
    };
    const onTimerStart = jest.fn();

    const result = await drainQueue({ store, execute, onTimerStart, now: () => T0 });

    expect(order).toEqual(['start', 'stop']);
    expect(seenClearTimer).toEqual([true]);
    expect(onTimerStart).toHaveBeenCalledWith(expect.objectContaining({ id: 'start' }), { kind: 'timer_started', version: 7 }, 0);
    expect(result).toMatchObject({ succeeded: 2, timerConflicts: 0 });
    expect(state.items).toEqual([]);
  });
});

describe('køet timerstart: idempotens', () => {
  it('samme start lagt i køen to gange giver ét element', () => {
    const once = enqueueItem([], startItem('a'));
    const twice = enqueueItem(once.items, { ...startItem('b') });
    expect(dedupKey(startItem('a'))).toBe(dedupKey(startItem('b')));
    expect(twice.added).toBe(false);
    expect(twice.items).toHaveLength(1);
  });

  it('afterTimerStartApplied ændrer kun poster fra samme session', () => {
    const other = { ...stopCreate('other'), payload: { ...(stopCreate().payload as CreateInput), startTime: new Date(T0 + 5 * MIN).toISOString() } } as QueueItem;
    const patched = afterTimerStartApplied([stopCreate(), other], startItem() as QueueItem & { type: 'timer.start' });
    expect(patched[0]).toMatchObject({ meta: { clearTimer: true } });
    expect(patched[1]).toMatchObject({ meta: { clearTimer: false } });
  });
});

describe('køet timerstart: konflikt (timer startet på anden enhed imens)', () => {
  it('klipper posten til det øjeblik, den anden timer startede', async () => {
    const { store, state } = fakeStore([startItem(), stopCreate()]);
    const sent: QueueItem[] = [];
    const execute = async (item: QueueItem): Promise<ExecuteOutcome | void> => {
      if (item.type === 'timer.start')
        return { kind: 'timer_conflict', otherStart: T0 + 20 * MIN };
      sent.push(item);
    };

    const result = await drainQueue({ store, execute, onTimerStart: () => {}, now: () => T0 });

    expect(result.timerConflicts).toBe(1);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      meta: { clearTimer: false },
      payload: { hours: 0.33, endTime: new Date(T0 + 20 * MIN).toISOString() },
    });
    expect(state.items).toEqual([]);
  });

  it('fjerner posten, når den anden timer kørte hele tiden', () => {
    const { items, dropped } = afterTimerStartConflict(
      [startItem(), stopCreate()],
      startItem() as QueueItem & { type: 'timer.start' },
      T0 - 10 * MIN,
    );
    expect(items).toEqual([]);
    expect(dropped).toBe(1);
  });
});

describe('køet timerstart: afsluttede sessioner efterlader ingen spøgelsestimer (#703)', () => {
  it('beholder en start, der KAN være sendt (attempts > 0), når posten gemmes', () => {
    const sent = { ...startItem(), attempts: 1 };
    const { items } = enqueueItem([sent], stopCreate());
    // Starten kan være landet — den skal blive, så dræningen rydder sessionen.
    expect(items.map(i => i.type).sort()).toEqual(['time.create', 'timer.start']);
  });

  it('beholder starten, hvis stoppet kommer midt i en dræning', () => {
    const fresh = startItem();
    const { items } = enqueueItem([fresh], stopCreate(), { draining: true });
    expect(items.map(i => i.type).sort()).toEqual(['time.create', 'timer.start']);
  });

  it('fjerner KUN en helt usendt start uden for en dræning', () => {
    const { items } = enqueueItem([startItem()], stopCreate());
    expect(items.map(i => i.type)).toEqual(['time.create']);
  });
});

describe('forældet start (stale_start) i køen', () => {
  it('er endelig: starten fjernes uden backoff, og posten beholdes hel uden at rydde serveren', async () => {
    const { store, state } = fakeStore([startItem(), stopCreate('stop', 60, false)]);
    const outcomes: ExecuteOutcome[] = [];
    const execute = jest.fn(async (i: QueueItem) => (i.type === 'timer.start' ? { kind: 'timer_stale' } as ExecuteOutcome : undefined));
    const result = await drainQueue({ store, execute, onTimerStart: (_i, outcome) => outcomes.push(outcome) });
    expect(outcomes).toEqual([{ kind: 'timer_stale' }]);
    expect(result).toMatchObject({ succeeded: 2, failed: 0, timerConflicts: 0 });
    expect(state.items).toEqual([]);
    const created = execute.mock.calls.map(([i]) => i).find(i => i.type === 'time.create');
    expect(created).toMatchObject({ payload: { hours: 1 }, meta: { clearTimer: false } });
  });
});
