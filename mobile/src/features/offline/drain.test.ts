import type { CreateMeta, QueueItem, UpdateMeta } from './queue-logic';
import type { OfflineQueueStore } from './queue-store';
import { TRPCClientError } from '@trpc/client';
import { armCreateForSend, drainQueue, executeItem } from './drain';
import { afterFailure, resetForRetry } from './queue-logic';

const mockMutate = jest.fn(async () => ({}));
const mockClear = jest.fn(async () => ({}));
const mockToggle = jest.fn(async () => ({}));
const mockUpdate = jest.fn(async () => ({}));
const mockList = jest.fn(async () => ({ entries: [] as unknown[] }));
const mockSetTags = jest.fn(async () => ({ success: true }));
const mockGetTimerState = jest.fn(async () => serverTimer('2026-09-29T08:00:00.000Z'));

function serverTimer(startTime: string | null, sessionId: string | null = null) {
  return { isRunning: startTime !== null, startTime, baseSeconds: 0, elapsedSeconds: 0, version: 1, intent: null, sessionId };
}

jest.mock('~/lib/api/trpc', () => {
  const { TRPCClientError: Actual } = jest.requireActual('@trpc/client');
  return {
    trpcClient: {
      time: {
        create: { mutate: (...args: unknown[]) => mockMutate(...(args as [])) },
        list: { query: (...args: unknown[]) => mockList(...(args as [])) },
        toggleBillable: { mutate: (...args: unknown[]) => mockToggle(...(args as [])) },
        update: { mutate: (...args: unknown[]) => mockUpdate(...(args as [])) },
      },
      timerSync: {
        clear: { mutate: (...args: unknown[]) => mockClear(...(args as [])) },
        getStateWithVersion: { query: (...args: unknown[]) => mockGetTimerState(...(args as [])) },
      },
      tags: {
        setForEntry: { mutate: (...args: unknown[]) => mockSetTags(...(args as [])) },
      },
    },
    isTRPCClientError: (e: unknown) => e instanceof Actual,
  };
});

function item(id: string, type: QueueItem['type'] = 'time.delete', extra: Partial<QueueItem> = {}): QueueItem {
  return { id, type, payload: { id }, createdAt: 'x', attempts: 0, lastError: null, failed: false, nextAttemptAt: 0, ...extra } as QueueItem;
}

/** Minimal in-memory store med samme actions som zustand-storen. */
function fakeStore(initial: QueueItem[]) {
  const state = { items: initial, isOnline: true, isSyncing: false, activeOrgId: null as string | null | undefined, ownerUserId: undefined as string | undefined };
  const store = (): OfflineQueueStore => ({
    ...state,
    enqueue: () => null,
    clearAll: () => {
      state.items = [];
    },
    adoptOwner: (userId) => {
      if (state.ownerUserId && state.ownerUserId !== userId)
        state.items = [];
      state.ownerUserId = userId;
    },
    remove: (id) => {
      state.items = state.items.filter(i => i.id !== id);
    },
    markFailure: (id, error, now = 0) => {
      state.items = state.items.map(i => (i.id === id ? afterFailure(i, error, now) : i));
    },
    retry: (id) => {
      state.items = state.items.map(i => (i.id === id ? resetForRetry(i) : i));
    },
    retryAll: () => {},
    replace: (next: QueueItem) => {
      state.items = state.items.map(i => (i.id === next.id ? next : i));
    },
    patchItems: (fn) => {
      state.items = fn(state.items);
    },
    setOnline: (v) => {
      state.isOnline = v;
    },
    setSyncing: (v) => {
      state.isSyncing = v;
    },
    setActiveOrgId: (v) => {
      state.activeOrgId = v;
    },
  });
  return { store, state };
}

function forbidden() {
  return TRPCClientError.from({ error: { message: 'FORBIDDEN', code: -32003, data: { code: 'FORBIDDEN', httpStatus: 403, path: 'time.delete' } } } as never);
}

describe('drainQueue', () => {
  it('kører elementer i rækkefølge og fjerner dem ved succes', async () => {
    const { store, state } = fakeStore([item('a'), item('b'), item('c')]);
    const order: string[] = [];
    const record = async (i: QueueItem) => {
      order.push(i.id);
    };
    const result = await drainQueue({ store, execute: record, now: () => 0 });
    expect(order).toEqual(['a', 'b', 'c']);
    expect(state.items).toHaveLength(0);
    expect(result).toEqual({ succeeded: 3, failed: 0, stopped: false, timerConflicts: 0 });
    expect(state.isSyncing).toBe(false);
  });

  it('stopper ved første forbigående fejl og giver elementet backoff', async () => {
    const { store, state } = fakeStore([item('a'), item('b')]);
    const execute = jest.fn(async (i: QueueItem) => {
      if (i.id === 'a')
        throw new Error('Network request failed');
    });

    const result = await drainQueue({ store, execute, now: () => 1_000 });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ succeeded: 0, failed: 1, stopped: true, timerConflicts: 0 });
    expect(state.items[0]).toMatchObject({ id: 'a', attempts: 1, failed: false, nextAttemptAt: 3_000 });
    expect(state.items[1]).toMatchObject({ id: 'b', attempts: 0 });
  });

  it('lader et element i backoff blokere resten — køen er strengt ordnet (#703)', async () => {
    const { store } = fakeStore([{ ...item('a'), nextAttemptAt: 10_000 }, item('b')]);
    const order: string[] = [];
    const record = async (i: QueueItem) => {
      order.push(i.id);
    };
    // `b` må ikke overhale `a`: et stop (posten) må aldrig lande før sin start.
    await drainQueue({ store, execute: record, now: () => 5_000 });
    expect(order).toEqual([]);
    await drainQueue({ store, execute: record, now: () => 10_000 });
    expect(order).toEqual(['a', 'b']);
  });

  it('permanent fejl markeres som fejlet og blokerer ikke resten', async () => {
    const { store, state } = fakeStore([item('a'), item('b')]);
    const execute = jest.fn(async (i: QueueItem) => {
      if (i.id === 'a')
        throw forbidden();
    });
    const result = await drainQueue({ store, execute, now: () => 0 });
    expect(execute).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ succeeded: 1, failed: 1, stopped: false, timerConflicts: 0 });
    expect(state.items).toHaveLength(1);
    expect(state.items[0]).toMatchObject({ id: 'a', failed: true, lastError: 'FORBIDDEN' });
  });

  it('kører ikke mens en dræning allerede er i gang', async () => {
    const { store, state } = fakeStore([item('a')]);
    state.isSyncing = true;
    const execute = jest.fn(async () => {});
    await drainQueue({ store, execute });
    expect(execute).not.toHaveBeenCalled();
  });
});

// En post, der lægges i køen UDEN at være kaldt (rent offline-stop, eller en
// skærm der var offline ved tryk), sendes FØRSTE gang af dræningen. Dør appen
// i det netværkskald, kommer der ingen afvisning tilbage — processen er bare
// væk — så intet markerer posten som ubekræftet, og næste forsøg opretter den
// igen. Dobbeltfaktureret. Derfor skal markeringen ske FØR kallet, ikke
// først når det fejler.
describe('armCreateForSend', () => {
  const create = { description: 'Web', hours: 1.5, date: '2026-09-29', isBillable: true };

  function createItem(meta?: CreateMeta): QueueItem & { type: 'time.create' } {
    return { id: 'a', type: 'time.create', payload: create, createdAt: 'x', attempts: 0, lastError: null, failed: false, nextAttemptAt: 0, meta } as QueueItem & { type: 'time.create' };
  }

  it('markerer en endnu usendt create som ubekræftet FØR den sendes', async () => {
    const { store, state } = fakeStore([createItem({ clearTimer: true })]);
    let metaVedKald: unknown;
    await drainQueue({
      store,
      now: () => 0,
      execute: async () => {
        // Læses fra STOREN, ikke fra det afsendte element: pointen er præcis
        // at markeringen er skrevet FØR kaldet, så et dræb ikke kan rulle den
        // tilbage.
        metaVedKald = (state.items[0] as QueueItem & { type: 'time.create' } | undefined)?.meta;
      },
    });

    expect(metaVedKald).toMatchObject({ unconfirmed: true, firstAttemptAt: new Date(0).toISOString() });
  });

  it('beholder en allerede ubekræftet posts første-forsøgs-tidspunkt', () => {
    // `firstAttemptAt` skal stå fast fra FØRSTE forsøg. Hvis dræningen
    // skriver et nyt tidspunkt ved hvert forsøg, strammer tidsvinduet en
    // smule for hver gentagelse, og en ægte post fra samme dag kan
    // efterhånden se ud som vores egen.
    const armed = armCreateForSend(createItem({ unconfirmed: true, firstAttemptAt: '2026-09-29T08:00:00.000Z' }), 1_000);
    expect(armed.meta?.firstAttemptAt).toBe('2026-09-29T08:00:00.000Z');
  });

  it('lader et tidligere markeret element være markeret', () => {
    const armed = armCreateForSend(createItem({ unconfirmed: true, firstAttemptAt: '2026-09-29T08:00:00.000Z' }), 99_000);
    expect(armed.meta?.firstAttemptAt).toBe('2026-09-29T08:00:00.000Z');
  });

  it('lader et element uden create-type urørt', () => {
    const update = item('a', 'time.delete');
    expect(armCreateForSend(update, 0)).toBe(update);
  });
});

describe('drainQueue — org-scoping', () => {
  const record = (order: string[]) => async (i: QueueItem) => {
    order.push(i.id);
  };

  it('dræner IKKE elementer markeret med en anden organisation', async () => {
    const { store, state } = fakeStore([
      item('a', 'time.delete', { orgId: 'org-b' }),
      item('b', 'time.delete', { orgId: 'org-a' }),
    ]);
    const order: string[] = [];
    const result = await drainQueue({ store, execute: record(order), now: () => 0, activeOrgId: 'org-a' });
    expect(order).toEqual(['b']);
    // Det holdte element bliver liggende — tiden må ikke forsvinde.
    expect(state.items.map(i => i.id)).toEqual(['a']);
    expect(result.succeeded).toBe(1);
  });

  it('en fejl i den aktive org stopper ikke dem, der hører til en anden', async () => {
    const { store } = fakeStore([
      item('a', 'time.delete', { orgId: 'org-b' }),
      item('b', 'time.delete', { orgId: 'org-a' }),
    ]);
    const order: string[] = [];
    await drainQueue({ store, execute: record(order), now: () => 0, activeOrgId: 'org-a' });
    expect(order).toEqual(['b']);
  });

  it('elementer uden orgId drænes stadig (aldrig strandre tid fra før markeringen)', async () => {
    const { store } = fakeStore([item('legacy')]);
    const execute = jest.fn(async () => {});
    await drainQueue({ store, execute, now: () => 0, activeOrgId: 'org-a' });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('ukendt org (undefined) filtrerer ikke', async () => {
    const { store } = fakeStore([item('a', 'time.delete', { orgId: 'org-b' })]);
    const execute = jest.fn(async () => {});
    await drainQueue({ store, execute, now: () => 0, activeOrgId: undefined });
    expect(execute).toHaveBeenCalledTimes(1);
  });
});

describe('executeItem — ubekræftet create', () => {
  const create = { description: 'Web', hours: 1.5, date: '2026-09-29', isBillable: true };

  function createItem(meta: CreateMeta) {
    return { id: 'a', type: 'time.create', payload: create, createdAt: 'x', attempts: 0, lastError: null, failed: false, nextAttemptAt: 0, meta } as QueueItem;
  }

  beforeEach(() => {
    mockMutate.mockReset();
  });

  it('springer oprettelsen over når serveren allerede har posten (dobbeltfakturering undgås)', async () => {
    const exists = jest.fn(async () => true);
    await executeItem(createItem({ unconfirmed: true, firstAttemptAt: '2026-09-29T14:00:00.000Z' }), { alreadyCreated: exists });
    expect(exists).toHaveBeenCalledWith(create, { firstAttemptAt: '2026-09-29T14:00:00.000Z' });
    expect(mockMutate).not.toHaveBeenCalled();
  });

  it('sender idempotensnøglen med hvert genforsøg, så serveren kan kende vores post', async () => {
    await executeItem(createItem({ unconfirmed: true, firstAttemptAt: '2026-09-29T14:00:00.000Z', clientEntryId: 'key-1' }), { alreadyCreated: async () => false });
    expect(mockMutate).toHaveBeenCalledWith({ ...create, clientEntryId: 'key-1' });
  });

  it('sender ingen nøgle, hvis elementet ikke har fået en', async () => {
    await executeItem(createItem({ unconfirmed: true }), { alreadyCreated: async () => false });
    expect(mockMutate).toHaveBeenCalledWith(create);
  });

  it('opretter alligevel når serveren ikke har den', async () => {
    const exists = jest.fn(async () => false);
    await executeItem(createItem({ unconfirmed: true }), { alreadyCreated: exists });
    expect(mockMutate).toHaveBeenCalledWith(create);
  });

  it('kontrollerer IKKE en create, der aldrig har været sendt (rent offline-stop)', async () => {
    const exists = jest.fn(async () => true);
    await executeItem(createItem({ clearTimer: true }), { alreadyCreated: exists });
    expect(exists).not.toHaveBeenCalled();
    expect(mockMutate).toHaveBeenCalledWith(create);
  });
});

/**
 * `clearTimer` rydder serverens kørende session, fordi posten nu er gemt
 * lokalt i stedet. Rækken er per bruger, så et kald uden tjek rammer ALTID den
 * session der ligger der nu — også en der startede, mens posten lå i køen.
 */
describe('executeItem — rydning af serverens session', () => {
  const timerCreate = {
    description: 'Support',
    hours: 2,
    date: '2026-09-29',
    startTime: '2026-09-29T08:00:00.000Z',
    endTime: '2026-09-29T10:00:00.000Z',
  };

  function stopItem(meta: CreateMeta): QueueItem {
    return {
      id: 'a',
      type: 'time.create',
      payload: timerCreate,
      createdAt: 'x',
      attempts: 0,
      lastError: null,
      failed: false,
      nextAttemptAt: 0,
      meta,
    } as QueueItem;
  }

  beforeEach(() => {
    mockMutate.mockReset();
    mockMutate.mockResolvedValue({});
    mockClear.mockReset();
    mockClear.mockResolvedValue({});
    mockGetTimerState.mockReset();
  });

  it('rydder den session, der stadig er vores', async () => {
    mockGetTimerState.mockResolvedValue(serverTimer('2026-09-29T08:00:00.000Z'));
    await executeItem(stopItem({ clearTimer: true }), { alreadyCreated: async () => false });
    expect(mockClear).toHaveBeenCalledTimes(1);
  });

  it('rydningen bærer sessions-id, så den kun rammer netop den session', async () => {
    mockGetTimerState.mockResolvedValue(serverTimer('2026-09-29T08:00:00.000Z', 's-1'));
    await executeItem(stopItem({ clearTimer: true }), { alreadyCreated: async () => false });
    expect(mockClear).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 's-1' }));
  });

  it('rydder IKKE en nyere session, der startede mens posten lå i køen', async () => {
    // Brugeren stoppede offline kl. 10, og startede en ny session kl. 11 fra
    // web. Uden tjekket dræner `clear` den nye session — tiden går tabt, og
    // web-appen viser en timer, der aldrig blev startet.
    mockGetTimerState.mockResolvedValue(serverTimer('2026-09-29T11:00:00.000Z'));
    await executeItem(stopItem({ clearTimer: true }), { alreadyCreated: async () => false });
    expect(mockClear).not.toHaveBeenCalled();
  });

  it('rydder IKKE når serveren slet ikke kører noget', async () => {
    mockGetTimerState.mockResolvedValue(serverTimer(null));
    await executeItem(stopItem({ clearTimer: true }), { alreadyCreated: async () => false });
    expect(mockClear).not.toHaveBeenCalled();
  });

  it('rydder stadig vores session, når posten allerede lå på serveren', async () => {
    // Genforsøg efter et tabt svar: opslaget fandt posten, så oprettelsen
    // springes over. Sessionen ligger stadig og kører, så den skal ryddes —
    // ellers står brugeren med en kørende timer, der ingen steder stopper.
    mockGetTimerState.mockResolvedValue(serverTimer('2026-09-29T08:00:00.000Z'));
    await executeItem(stopItem({ clearTimer: true, unconfirmed: true }), { alreadyCreated: async () => true });
    expect(mockMutate).not.toHaveBeenCalled();
    expect(mockClear).toHaveBeenCalledTimes(1);
  });

  it('lader posten fejle, hvis sessionen ikke kan slås op', async () => {
    // Ukendt session må ikke behandles som "ikke vores": så rydder vi
    // ingenting, og serveren beholder en kørende session for en post, der
    // allerede er gemt. Genforsøget tager sig af det, når nettet er tilbage.
    mockGetTimerState.mockRejectedValue(new TypeError('Network request failed'));
    await expect(executeItem(stopItem({ clearTimer: true }), { alreadyCreated: async () => false }))
      .rejects
      .toThrow('Network request failed');
    expect(mockClear).not.toHaveBeenCalled();
  });

  it('genopretter IKKE posten, når kun rydningen af sessionen fejlede', async () => {
    // Oprettelsen lykkedes, rydningen døde. Uden `unconfirmed`-markeringen
    // fra `afterFailure` ville genforsøget oprette samme time igen.
    mockGetTimerState.mockRejectedValueOnce(new TypeError('Network request failed'));
    const { store } = fakeStore([stopItem({ clearTimer: true })]);

    const first = await drainQueue({ store, now: () => 0 });
    expect(first).toMatchObject({ succeeded: 0, failed: 1 });

    mockList.mockResolvedValue({ entries: [{ ...timerCreate, hours: '2', startTime: timerCreate.startTime, endTime: timerCreate.endTime }] });
    mockGetTimerState.mockResolvedValue(serverTimer('2026-09-29T08:00:00.000Z'));
    const second = await drainQueue({ store, now: () => 60_000 });

    expect(mockMutate).toHaveBeenCalledTimes(1);
    expect(second).toMatchObject({ succeeded: 1, failed: 0 });
  });
});

describe('drainQueue — tabt svar under dræningen', () => {
  const create = { description: 'Web', hours: 1.5, date: '2026-09-29', isBillable: true };
  const savedEntry = { date: '2026-09-29', hours: '1.5', description: 'Web', startTime: null, endTime: null };

  function createItem(): QueueItem {
    return { id: 'a', type: 'time.create', payload: create, createdAt: 'x', attempts: 0, lastError: null, failed: false, nextAttemptAt: 0 } as QueueItem;
  }

  beforeEach(() => {
    mockMutate.mockReset();
    // `mockReset` fjerner også standard-svaret, så dagen skal svære TOM ved
    // starten af hvert forsøg: ellers svarer opslaget `undefined`, og
    // dræningen kan ikke skelne vores post fra en ægte.
    mockList.mockReset();
    mockList.mockResolvedValue({ entries: [] });
  });

  it('genopretter ikke en post, hvis svaret gik tabt første gang den blev sendt', async () => {
    // Første forsøg: serveren opretter posten, men svaret forsvinder.
    mockMutate.mockRejectedValueOnce(new TypeError('Network request failed'));
    const { store, state } = fakeStore([createItem()]);

    const first = await drainQueue({ store, now: () => 0 });
    expect(first).toMatchObject({ succeeded: 0, failed: 1, stopped: true });

    // Andet forsøg: serveren HAR posten — opslaget skal fange den.
    mockList.mockResolvedValue({ entries: [savedEntry] });
    const second = await drainQueue({ store, now: () => 60_000 });

    expect(mockList).toHaveBeenCalled();
    expect(mockMutate).toHaveBeenCalledTimes(1);
    expect(second).toMatchObject({ succeeded: 1, failed: 0 });
    expect(state.items).toHaveLength(0);
  });

  it('sender den dog videre, når opslaget viser at posten ikke findes', async () => {
    mockMutate.mockRejectedValueOnce(new TypeError('Network request failed'));
    const { store } = fakeStore([createItem()]);
    await drainQueue({ store, now: () => 0 });

    mockList.mockResolvedValue({ entries: [] });
    await drainQueue({ store, now: () => 60_000 });

    expect(mockList).toHaveBeenCalled();
    expect(mockMutate).toHaveBeenCalledTimes(2);
  });
});

describe('executeItem — toggleBillable', () => {
  beforeEach(() => {
    mockToggle.mockReset();
  });

  it('sender skiftet med præcis id og værdi', async () => {
    await executeItem({ id: 'a', type: 'time.toggleBillable', payload: { id: 'e1', isBillable: false }, createdAt: 'x', attempts: 0, lastError: null, failed: false, nextAttemptAt: 0 });
    expect(mockToggle).toHaveBeenCalledWith({ id: 'e1', isBillable: false });
  });

  it('kræver ingen forudgående opslag — det er en idempotent felt-sætning', async () => {
    const exists = jest.fn(async () => true);
    await executeItem({ id: 'a', type: 'time.toggleBillable', payload: { id: 'e1', isBillable: true }, createdAt: 'x', attempts: 0, lastError: null, failed: false, nextAttemptAt: 0 }, { alreadyCreated: exists });
    expect(exists).not.toHaveBeenCalled();
  });
});

describe('executeItem — tags på en køet oprettelse', () => {
  const create = (meta?: CreateMeta): QueueItem =>
    ({ id: 'a', type: 'time.create', payload: { description: 'Support', hours: 1, date: '2026-09-29' }, meta, createdAt: 'x', attempts: 0, lastError: null, failed: false, nextAttemptAt: 0 }) as QueueItem;

  beforeEach(() => {
    mockMutate.mockReset();
    mockSetTags.mockReset();
    mockMutate.mockResolvedValue({ id: 'ny-post' });
    mockSetTags.mockResolvedValue({ success: true });
  });

  it('sætter de valgte tags på den nyoprettede post', async () => {
    await executeItem(create({ tagIds: ['t1', 't2'] }));
    expect(mockSetTags).toHaveBeenCalledWith({ entryId: 'ny-post', tagIds: ['t1', 't2'] });
  });

  it('kalder intet, når der ikke blev valgt tags', async () => {
    await executeItem(create());
    expect(mockSetTags).not.toHaveBeenCalled();
  });

  it('kalder intet, når serveren allerede havde posten fra et tabt svar', async () => {
    // Uden id fra en oprettelse ville vi ramme `undefined` som entryId — og
    // serveren ville svare "Time entry not found" på hvert eneste forsøg.
    const exists = jest.fn(async () => true);
    await executeItem(create({ tagIds: ['t1'], unconfirmed: true }), { alreadyCreated: exists });
    expect(mockMutate).not.toHaveBeenCalled();
    expect(mockSetTags).not.toHaveBeenCalled();
  });

  it('lader et mislykket tag-kald stå, så tiden ikke oprettes to gange', async () => {
    mockSetTags.mockRejectedValue(new Error('net væk'));
    await expect(executeItem(create({ tagIds: ['t1'] }))).resolves.toBeUndefined();
    expect(mockMutate).toHaveBeenCalledTimes(1);
  });

  it('en dræning tæller den som synkroniseret, selv når tag-kallet fejlede', async () => {
    mockSetTags.mockRejectedValue(new Error('net væk'));
    const { store, state } = fakeStore([create({ tagIds: ['t1'] })]);
    const result = await drainQueue({ store, now: () => 0 });
    expect(result).toEqual({ succeeded: 1, failed: 0, stopped: false, timerConflicts: 0 });
    expect(state.items).toEqual([]);
  });
});

describe('executeItem — tags på en køet rettelse', () => {
  const update = (meta?: UpdateMeta): QueueItem =>
    ({ id: 'a', type: 'time.update', payload: { id: 'e1', data: { description: 'Support' } }, meta, createdAt: 'x', attempts: 0, lastError: null, failed: false, nextAttemptAt: 0 }) as QueueItem;

  beforeEach(() => {
    mockMutate.mockReset();
    mockSetTags.mockReset();
    mockUpdate.mockReset();
    mockMutate.mockResolvedValue({ id: 'ny-post' });
    mockSetTags.mockResolvedValue({ success: true });
    mockUpdate.mockResolvedValue({ success: true });
  });

  it('sætter de valgte tags på den rettede post', async () => {
    await executeItem(update({ tagIds: ['t1', 't2'] }));
    expect(mockSetTags).toHaveBeenCalledWith({ entryId: 'e1', tagIds: ['t1', 't2'] });
  });

  it('rydder alle tags, når brugeren fjernede dem alle', async () => {
    // Tom liste er her en ændring, ikke "intet at gøre" — ellers beholder
    // posten de tags brugeren netop tog af.
    await executeItem(update({ tagIds: [] }));
    expect(mockSetTags).toHaveBeenCalledWith({ entryId: 'e1', tagIds: [] });
  });

  it('kalder intet, når rettelsen ikke rørte tags', async () => {
    await executeItem(update());
    expect(mockSetTags).not.toHaveBeenCalled();
  });

  it('lader et mislykket tag-kald stå, så køen fortsætter', async () => {
    mockSetTags.mockRejectedValue(new Error('net væk'));
    await expect(executeItem(update({ tagIds: ['t1'] }))).resolves.toBeUndefined();
    expect(mockUpdate).toHaveBeenCalledTimes(1);
  });

  it('en dræning tæller rettelsen som synkroniseret, selv når tag-kallet fejlede', async () => {
    mockSetTags.mockRejectedValue(new Error('net væk'));
    const { store, state } = fakeStore([update({ tagIds: ['t1'] })]);
    const result = await drainQueue({ store, now: () => 0 });
    expect(result).toEqual({ succeeded: 1, failed: 0, stopped: false, timerConflicts: 0 });
    expect(state.items).toEqual([]);
  });
});
