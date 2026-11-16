const mockMemory = new Map<string, string>();

jest.mock('~/lib/storage', () => ({
  storage: {
    getString: (k: string) => mockMemory.get(k),
    set: (k: string, v: string) => mockMemory.set(k, v),
    remove: (k: string) => mockMemory.delete(k),
  },
}));

const mockCounter = { n: 0 };
jest.mock('expo-crypto', () => ({
  randomUUID: () => `uuid-${++mockCounter.n}`,
}));

// eslint-disable-next-line import/first
import type { QueueItem } from './queue-logic';
// eslint-disable-next-line import/first
import { inActiveOrg } from './queue-logic';
// eslint-disable-next-line import/first
import { OFFLINE_QUEUE_STORAGE_KEY, offlineQueue, useOfflineQueue } from './queue-store';

const createPayload = { description: 'Web', hours: 1.5, date: '2026-09-06', isBillable: true };

describe('offline queue store', () => {
  beforeEach(() => {
    mockMemory.clear();
    useOfflineQueue.setState({ items: [], isOnline: true, isSyncing: false, ownerUserId: undefined });
  });

  it('persisterer køen og dens ejer — ikke online/sync-flag', () => {
    const added = offlineQueue().enqueue({ type: 'time.create', payload: createPayload }, new Date('2026-09-06T10:00:00Z'));
    expect(added).not.toBeNull();
    offlineQueue().adoptOwner('bruger-1');
    const raw = mockMemory.get(OFFLINE_QUEUE_STORAGE_KEY);
    expect(raw).toBeDefined();
    const parsed = JSON.parse(raw!);
    expect(Object.keys(parsed.state).sort()).toEqual(['items', 'ownerUserId']);
    expect(parsed.state.ownerUserId).toBe('bruger-1');
    expect(parsed.state.items).toHaveLength(1);
    expect(parsed.state.items[0]).toMatchObject({
      id: expect.stringMatching(/^uuid-/),
      type: 'time.create',
      payload: createPayload,
      createdAt: '2026-09-06T10:00:00.000Z',
      attempts: 0,
      lastError: null,
      failed: false,
    });
  });

  it('dobbelt-enqueue giver null og én post', () => {
    expect(offlineQueue().enqueue({ type: 'time.delete', payload: { id: 'e1' } })).not.toBeNull();
    expect(offlineQueue().enqueue({ type: 'time.delete', payload: { id: 'e1' } })).toBeNull();
    expect(offlineQueue().items).toHaveLength(1);
  });

  it('giver hver create sin egen idempotensnøgle', () => {
    const first = offlineQueue().enqueue({ type: 'time.create', payload: createPayload })!;
    const second = offlineQueue().enqueue({ type: 'time.create', payload: { ...createPayload, hours: 2 } })!;
    const keyOf = (i: QueueItem) => (i as QueueItem & { type: 'time.create' }).meta?.clientEntryId;
    expect(keyOf(first)).toMatch(/^uuid-/);
    expect(keyOf(second)).not.toBe(keyOf(first));
  });

  it('beholder nøglen på et element, der allerede har en', () => {
    const added = offlineQueue().enqueue({ type: 'time.create', payload: createPayload, meta: { clientEntryId: 'fast-1' } })!;
    expect((added as QueueItem & { type: 'time.create' }).meta?.clientEntryId).toBe('fast-1');
  });

  it('lader update/delete uden nøgle', () => {
    const added = offlineQueue().enqueue({ type: 'time.delete', payload: { id: 'e1' } })!;
    expect('meta' in added).toBe(false);
  });

  it('lader to identiske creates dedupe som før — nøglen ligger i meta, ikke i payload', () => {
    expect(offlineQueue().enqueue({ type: 'time.create', payload: createPayload })).not.toBeNull();
    expect(offlineQueue().enqueue({ type: 'time.create', payload: createPayload })).toBeNull();
    expect(offlineQueue().items).toHaveLength(1);
  });

  it('markFailure / retry / remove', () => {
    const added = offlineQueue().enqueue({ type: 'time.create', payload: createPayload })!;
    offlineQueue().markFailure(added.id, new Error('net'), 100);
    expect(offlineQueue().items[0]).toMatchObject({ attempts: 1, lastError: 'net', failed: false, nextAttemptAt: 2_100 });
    offlineQueue().retry(added.id);
    expect(offlineQueue().items[0]).toMatchObject({ attempts: 0, lastError: null, nextAttemptAt: 0 });
    offlineQueue().remove(added.id);
    expect(offlineQueue().items).toHaveLength(0);
  });
});

describe('clearAll', () => {
  it('tømmer køen helt', () => {
    offlineQueue().enqueue({ type: 'time.delete', payload: { id: 'x-1' } } as never);
    expect(offlineQueue().items.length).toBeGreaterThan(0);
    offlineQueue().clearAll();
    expect(offlineQueue().items).toEqual([]);
  });
});

describe('ejerskab i køen', () => {
  beforeEach(() => {
    mockMemory.clear();
    useOfflineQueue.setState({ items: [], isOnline: true, isSyncing: false, ownerUserId: undefined });
  });

  it('giver SAMME bruger sin usendte tid tilbage efter en udløbet session', () => {
    offlineQueue().adoptOwner('bruger-1');
    offlineQueue().enqueue({ type: 'time.create', payload: createPayload });

    useOfflineQueue.setState({ ownerUserId: 'bruger-1' });
    offlineQueue().adoptOwner('bruger-1');

    expect(offlineQueue().items).toHaveLength(1);
  });

  it('tømmer køen, når en ANDEN konto logger ind på enheden', () => {
    offlineQueue().adoptOwner('bruger-1');
    offlineQueue().enqueue({ type: 'time.create', payload: createPayload });
    // A's session udløber: køen overlever, fordi brugeren ikke valgte log ud.
    useOfflineQueue.setState({ ownerUserId: 'bruger-1' });

    offlineQueue().adoptOwner('bruger-2');

    expect(offlineQueue().items).toEqual([]);
    expect(offlineQueue().ownerUserId).toBe('bruger-2');
  });

  it('sender poster, en ældre appversion fik afvist som for gammel, når ejeren er bekræftet', () => {
    offlineQueue().adoptOwner('bruger-1');
    const item = offlineQueue().enqueue({ type: 'time.create', payload: createPayload })!;
    offlineQueue().replace({ ...item, updateBlockedOn: 'mobile/0.9.0+1', nextAttemptAt: 99_999_999 });

    offlineQueue().adoptOwner('bruger-1');

    expect(offlineQueue().items[0]).toMatchObject({ nextAttemptAt: 0, attempts: 0 });
    expect(offlineQueue().items[0].updateBlockedOn).toBeUndefined();
  });

  it('overtager en kø uden kendt ejer uden at tømme den', () => {
    // Før ejerskab blev stemplet, eller en kø skrevet før en opdatering:
    // tømmer vi her, taber den bruger tid, der aldrig blev sendt.
    offlineQueue().enqueue({ type: 'time.create', payload: createPayload });

    offlineQueue().adoptOwner('bruger-1');

    expect(offlineQueue().items).toHaveLength(1);
  });
});

describe('org-stempling i køen', () => {
  beforeEach(() => {
    mockMemory.clear();
    useOfflineQueue.setState({ items: [], isOnline: true, isSyncing: false, activeOrgId: undefined });
  });

  it('stempler ikke med null, når brugeren ingen organisation har', () => {
    // `inActiveOrg` kan ikke holde et `null`-element, når brugeren senere
    // kommer i en organisation — posten ville ligge i køen for evigt.
    offlineQueue().setActiveOrgId(null);
    const added = offlineQueue().enqueue({ type: 'time.create', payload: createPayload })!;
    expect(added.orgId).toBeUndefined();
  });

  it('stempler med den aktive organisation', () => {
    offlineQueue().setActiveOrgId('org-a');
    const added = offlineQueue().enqueue({ type: 'time.create', payload: createPayload })!;
    expect(added.orgId).toBe('org-a');
  });

  it('migrerer elementer, der fik orgId: null før rettelsen', () => {
    offlineQueue().setActiveOrgId(null);
    offlineQueue().enqueue({ type: 'time.create', payload: createPayload });
    useOfflineQueue.setState({
      items: offlineQueue().items.map(i => ({ ...i, orgId: null })),
    });
    offlineQueue().setActiveOrgId('org-a');
    expect(inActiveOrg(offlineQueue().items, 'org-a')).toHaveLength(1);
  });
});
