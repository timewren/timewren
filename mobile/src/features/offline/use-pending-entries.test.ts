import type { QueueItem } from './queue-logic';
import { applyPendingUpdates, pendingEntriesOn } from './use-pending-entries';

function create(id: string, date: string, opts: { hours: number; failed?: boolean; isBillable?: boolean }): QueueItem {
  return {
    id,
    type: 'time.create',
    payload: { description: `d-${id}`, hours: opts.hours, date, isBillable: opts.isBillable ?? true, projectId: 'p1' },
    createdAt: 'x',
    attempts: 0,
    lastError: null,
    failed: opts.failed ?? false,
    nextAttemptAt: 0,
  };
}

describe('pendingEntriesOn', () => {
  it('returnerer kun oprettelser for dagen, i rækkefølge, med fejl-flag', () => {
    const items: QueueItem[] = [
      create('1', '2026-09-06', { hours: 1 }),
      { id: 'd', type: 'time.delete', payload: { id: 'e1' }, createdAt: 'x', attempts: 0, lastError: null, failed: false, nextAttemptAt: 0 },
      create('2', '2026-09-05', { hours: 2 }),
      create('3', '2026-09-06', { hours: 0.5, failed: true }),
    ];
    const result = pendingEntriesOn(items, '2026-09-06');
    expect(result.map(e => e.id)).toEqual(['1', '3']);
    expect(result[0]).toMatchObject({ description: 'd-1', hours: 1, projectId: 'p1', clientId: null, pending: true, failed: false });
    expect(result[1]!.failed).toBe(true);
  });

  it('bærer fakturerbarheden med, så filteret på Tid-skærmen kan finde en ventende intern post', () => {
    const result = pendingEntriesOn([create('4', '2026-09-06', { hours: 1, isBillable: false })], '2026-09-06');
    expect(result[0]).toMatchObject({ isBillable: false });
  });

  it('malker en ventende post som ikke-faktureret, så «Kun ikke-fakturerede» ikke skjuler den', () => {
    // Uden feltet var den `undefined`, og `matchesBilled` tæller kun `false`
    // som ikke-faktureret — så en post brugeren lige har lavet ville være
    // usynlig under sit eget filter.
    const result = pendingEntriesOn([create('5', '2026-09-06', { hours: 1 })], '2026-09-06');
    expect(result[0]).toMatchObject({ isBilled: false });
  });
});

function update(id: string, data: Record<string, unknown>): QueueItem {
  return { id, type: 'time.update', payload: { id, data }, createdAt: 'x', attempts: 0, lastError: null, failed: false, nextAttemptAt: 0 } as QueueItem;
}

const entries = [
  { id: 'e1', date: '2026-09-29', hours: 2, description: 'Web', projectId: 'p1', isBillable: true },
  { id: 'e2', date: '2026-09-29', hours: 1, description: 'Kontor', isBillable: true },
];

describe('applyPendingUpdates', () => {
  it('lægger den ventende rettelse ovenpå og markerer rækken', () => {
    const result = applyPendingUpdates(entries, [update('e1', { hours: 3.5, description: 'Web ny' })]);
    expect(result[0]).toMatchObject({ hours: 3.5, description: 'Web ny', pendingSync: true });
    expect(result[1]).toEqual(entries[1]);
  });

  it('undefined i payloadet betyder "uændret" — det må ikke slå felter til null', () => {
    const result = applyPendingUpdates(entries, [update('e1', { hours: 3.5, projectId: undefined })]);
    expect(result[0]).toMatchObject({ hours: 3.5, projectId: 'p1' });
  });

  it('seneste rettelse på samme post vinder', () => {
    const result = applyPendingUpdates(entries, [
      update('e1', { hours: 3.5 }),
      update('e1', { hours: 4 }),
    ]);
    expect(result[0]).toMatchObject({ hours: 4 });
  });

  it('gør ingenting når køen er tom', () => {
    expect(applyPendingUpdates(entries, [])).toEqual(entries);
  });

  it('en ventende sletning rammer ikke posterne (kun oprettelser og rettelser)', () => {
    const del: QueueItem = { id: 'd', type: 'time.delete', payload: { id: 'e1' }, createdAt: 'x', attempts: 0, lastError: null, failed: false, nextAttemptAt: 0 };
    expect(applyPendingUpdates(entries, [del])).toEqual(entries);
  });

  it('et ventende toggleBillable viser den nye værdi med "venter"-badge', () => {
    const toggle: QueueItem = { id: 't', type: 'time.toggleBillable', payload: { id: 'e1', isBillable: false }, createdAt: 'x', attempts: 0, lastError: null, failed: false, nextAttemptAt: 0 };
    const result = applyPendingUpdates(entries, [toggle]);
    expect(result[0]).toMatchObject({ isBillable: false, pendingSync: true, hours: 2 });
    expect(result[1]).toEqual(entries[1]);
  });

  it('seneste toggle på samme post vinder, uanset rækkefølgen i køen', () => {
    const off: QueueItem = { id: 't1', type: 'time.toggleBillable', payload: { id: 'e1', isBillable: false }, createdAt: 'x', attempts: 0, lastError: null, failed: false, nextAttemptAt: 0 };
    const on: QueueItem = { id: 't2', type: 'time.toggleBillable', payload: { id: 'e1', isBillable: true }, createdAt: 'x', attempts: 0, lastError: null, failed: false, nextAttemptAt: 0 };
    expect(applyPendingUpdates(entries, [off, on])[0]).toMatchObject({ isBillable: true });
    expect(applyPendingUpdates(entries, [on, off])[0]).toMatchObject({ isBillable: false });
  });
});
