import type { QueueItem } from './queue-logic';
import { TRPCClientError } from '@trpc/client';
import {
  adoptUnstamped,
  afterFailure,
  backoffDelay,
  classifyError,
  dedupKey,
  enqueueItem,
  failedCount,
  inActiveOrg,
  isAuthFailure,
  MAX_ATTEMPTS,
  nextWakeupAt,
  orgToStamp,
  pendingCount,
  resetForRetry,
  resumeAfterLogin,
  resumeAfterUpdate,
  runnableItems,
  stoppedSessionsInQueue,
} from './queue-logic';

function item(partial: Partial<QueueItem> & Pick<QueueItem, 'type' | 'payload'>): QueueItem {
  return {
    id: partial.id ?? Math.random().toString(36).slice(2),
    createdAt: '2026-09-06T10:00:00.000Z',
    attempts: 0,
    lastError: null,
    failed: false,
    nextAttemptAt: 0,
    ...partial,
  } as QueueItem;
}

const createPayload = { description: 'Web', hours: 1.5, date: '2026-09-06', isBillable: true };

function tooOldError() {
  return TRPCClientError.from({ error: { message: 'Din TimeTrack-app er for gammel', code: -32000, data: { code: 'PRECONDITION_FAILED', httpStatus: 412, path: 'time.create', appCode: 'CLIENT_TOO_OLD' } } } as never);
}

function trpcError(code: string) {
  return TRPCClientError.from({ error: { message: code, code: -32000, data: { code, httpStatus: 400, path: 'time.create' } } } as never);
}

describe('backoffDelay', () => {
  it('er eksponentiel med loft', () => {
    expect(backoffDelay(0)).toBe(0);
    expect(backoffDelay(1)).toBe(2_000);
    expect(backoffDelay(2)).toBe(4_000);
    expect(backoffDelay(3)).toBe(8_000);
    expect(backoffDelay(5)).toBe(32_000);
    expect(backoffDelay(20)).toBe(5 * 60_000);
  });
});

describe('classifyError', () => {
  it('zod/FORBIDDEN/NOT_FOUND er permanente', () => {
    expect(classifyError(trpcError('BAD_REQUEST'))).toBe('permanent');
    expect(classifyError(trpcError('FORBIDDEN'))).toBe('permanent');
    expect(classifyError(trpcError('NOT_FOUND'))).toBe('permanent');
  });

  it('netværk, 5xx og UNAUTHORIZED er forbigående', () => {
    expect(classifyError(new TypeError('Network request failed'))).toBe('transient');
    expect(classifyError(trpcError('INTERNAL_SERVER_ERROR'))).toBe('transient');
    expect(classifyError(trpcError('UNAUTHORIZED'))).toBe('transient');
    expect(classifyError('x')).toBe('transient');
  });

  it('en udløbet session (UNAUTHORIZED) er forbigående for KØEN — næste login sender posten videre', () => {
    // Bevidst, modsat den interaktive stop: en kø-post må netop overleve en
    // udløbet cookie. Forsøget tælles IKKE, og elementet venter på login.
    const failed = afterFailure(item({ type: 'time.create', payload: createPayload }), trpcError('UNAUTHORIZED'), 0);
    expect(failed.failed).toBe(false);
    expect(failed.attempts).toBe(0);
    expect(failed.authBlocked).toBe(true);
    expect(failed.nextAttemptAt).toBe(60_000);
  });

  it('fem 401\'er i træk gør ikke elementet fejlet', () => {
    let current = item({ type: 'time.create', payload: createPayload });
    for (let n = 0; n < MAX_ATTEMPTS + 2; n++)
      current = afterFailure(current, trpcError('UNAUTHORIZED'), n * 60_000);
    expect(current.failed).toBe(false);
    expect(current.attempts).toBe(0);
  });
});

describe('isAuthFailure', () => {
  it('kun en 401 fra serveren — ikke netfejl, ikke en afvisning', () => {
    expect(isAuthFailure(trpcError('UNAUTHORIZED'))).toBe(true);
    expect(isAuthFailure(trpcError('BAD_REQUEST'))).toBe(false);
    expect(isAuthFailure(trpcError('INTERNAL_SERVER_ERROR'))).toBe(false);
    expect(isAuthFailure(new TypeError('Network request failed'))).toBe(false);
    expect(isAuthFailure(undefined)).toBe(false);
  });
});

describe('dedupKey', () => {
  it('er uafhængig af nøglerækkefølge og undefined-felter', () => {
    const a = dedupKey({ type: 'time.create', payload: { ...createPayload, projectId: undefined } });
    const b = dedupKey({ type: 'time.create', payload: { isBillable: true, date: '2026-09-06', hours: 1.5, description: 'Web' } });
    expect(a).toBe(b);
  });

  it('skelner mellem typer og indhold', () => {
    expect(dedupKey({ type: 'time.delete', payload: { id: 'a' } })).not.toBe(dedupKey({ type: 'time.delete', payload: { id: 'b' } }));
    expect(dedupKey({ type: 'time.create', payload: createPayload })).not.toBe(dedupKey({ type: 'time.create', payload: { ...createPayload, hours: 2 } }));
  });

  it('skelner mellem to rettelser der kun adskiller sig i tags', () => {
    // Tags ligger uden for payload'en. Uden dem i nøglen ville den ventende
    // rettelse få den nyestes nøgle, og de valgte tags ville forsvinde.
    const fields = { id: 'e1', data: { description: 'Web', hours: 1, date: '2026-09-29' } };
    const withTags = dedupKey({ type: 'time.update', payload: fields, meta: { tagIds: ['t1'] } });
    const otherTags = dedupKey({ type: 'time.update', payload: fields, meta: { tagIds: ['t2'] } });
    const noTags = dedupKey({ type: 'time.update', payload: fields });
    expect(withTags).not.toBe(otherTags);
    expect(withTags).not.toBe(noTags);
  });
});

describe('enqueueItem', () => {
  it('afviser dobbelt-enqueue af samme mutation', () => {
    const first = item({ type: 'time.create', payload: createPayload });
    const once = enqueueItem([], first);
    expect(once.added).toBe(true);
    const twice = enqueueItem(once.items, item({ type: 'time.create', payload: { ...createPayload } }));
    expect(twice.added).toBe(false);
    expect(twice.items).toHaveLength(1);
  });

  it('bevarer indsættelsesrækkefølge', () => {
    let items: QueueItem[] = [];
    items = enqueueItem(items, item({ id: '1', type: 'time.create', payload: createPayload })).items;
    items = enqueueItem(items, item({ id: '2', type: 'time.update', payload: { id: 'e1', data: { ...createPayload, description: 'a' } } })).items;
    items = enqueueItem(items, item({ id: '3', type: 'time.delete', payload: { id: 'e2' } })).items;
    expect(items.map(i => i.id)).toEqual(['1', '2', '3']);
  });

  it('nyt update på samme post erstatter det ventende (beholder plads)', () => {
    let items: QueueItem[] = [];
    items = enqueueItem(items, item({ id: '1', type: 'time.update', payload: { id: 'e1', data: { ...createPayload, description: 'a' } } })).items;
    items = enqueueItem(items, item({ id: '2', type: 'time.delete', payload: { id: 'e9' } })).items;
    items = enqueueItem(items, item({ id: '3', type: 'time.update', payload: { id: 'e1', data: { ...createPayload, description: 'b' } } })).items;
    expect(items).toHaveLength(2);
    expect(items[0]!.id).toBe('1');
    expect((items[0] as { payload: { data: { description?: string } } }).payload.data.description).toBe('b');
  });

  it('delete fjerner ventende updates på samme post', () => {
    let items: QueueItem[] = [];
    items = enqueueItem(items, item({ id: '1', type: 'time.update', payload: { id: 'e1', data: { ...createPayload, description: 'a' } } })).items;
    items = enqueueItem(items, item({ id: '2', type: 'time.delete', payload: { id: 'e1' } })).items;
    expect(items.map(i => i.type)).toEqual(['time.delete']);
  });
});

describe('afterFailure: loftet for forsøg', () => {
  const base = item({ type: 'time.create', payload: createPayload });

  it('opgiver stadig en post efter MAX_ATTEMPTS fejl, der ikke er tabt net', () => {
    // drain.ts kaster almindelige Error'er på et serversvar (ukendt `reason`),
    // og en kodefejl giver en TypeError uden net-ord. Bliver de ved at blokere,
    // sendes intet af det, der ligger efter dem i den strengt ordnede kø.
    for (const error of [new Error('timer.start: something_new'), new TypeError('Cannot read properties of undefined')]) {
      let current = base;
      for (let i = 0; i < MAX_ATTEMPTS; i++)
        current = afterFailure(current, error, 0);
      expect(current.failed).toBe(true);
    }
  });

  it('en gift-post blokerer ikke den gyldige post efter sig for evigt', () => {
    let poison = item({ id: 'p', type: 'timer.start', payload: { startTime: '2026-09-06T08:00:00.000Z' } as never });
    const valid = item({ id: 'v', type: 'time.create', payload: createPayload });
    let now = 0;
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      expect(runnableItems([poison, valid], now).map(x => x.id)[0]).toBe('p');
      poison = afterFailure(poison, new Error('timer.start: something_new'), now);
      now = poison.nextAttemptAt === Number.MAX_SAFE_INTEGER ? now : poison.nextAttemptAt;
    }
    expect(runnableItems([poison, valid], now).map(x => x.id)).toEqual(['v']);
  });

  it('opgiver ikke en post, når en proxy svarer uden JSON under en deploy', () => {
    const badGateway = TRPCClientError.from(new SyntaxError('JSON Parse error: Unexpected character: <'));
    let current = base;
    for (let i = 0; i < MAX_ATTEMPTS + 3; i++)
      current = afterFailure(current, badGateway, 0);
    expect(current.failed).toBe(false);
  });
});

describe('afterFailure / runnableItems', () => {
  const base = item({ type: 'time.create', payload: createPayload });

  it('forbigående fejl giver backoff og tæller forsøg', () => {
    const now = 1_000_000;
    const once = afterFailure(base, new Error('Network request failed'), now);
    expect(once.attempts).toBe(1);
    expect(once.failed).toBe(false);
    expect(once.lastError).toBe('Network request failed');
    expect(once.nextAttemptAt).toBe(now + 2_000);
    expect(runnableItems([once], now + 1_000)).toHaveLength(0);
    expect(runnableItems([once], now + 2_000)).toHaveLength(1);
  });

  it('permanent fejl markerer som fejlet med det samme', () => {
    const failed = afterFailure(base, trpcError('FORBIDDEN'), 0);
    expect(failed.failed).toBe(true);
    expect(failed.attempts).toBe(1);
    expect(runnableItems([failed], Number.MAX_SAFE_INTEGER)).toHaveLength(0);
    expect(pendingCount([failed])).toBe(0);
    expect(failedCount([failed])).toBe(1);
  });

  it('markerer som fejlet efter MAX_ATTEMPTS serverfejl', () => {
    let current = base;
    for (let i = 0; i < MAX_ATTEMPTS - 1; i++) {
      current = afterFailure(current, trpcError('INTERNAL_SERVER_ERROR'), 0);
      expect(current.failed).toBe(false);
    }
    current = afterFailure(current, trpcError('INTERNAL_SERVER_ERROR'), 0);
    expect(current.failed).toBe(true);
    expect(current.attempts).toBe(MAX_ATTEMPTS);
  });

  it('opgiver aldrig en post, fordi serveren ikke kunne nås', () => {
    // Svagt net, captive portal eller en deploy: telefonen tror den er online,
    // men intet svar kom. Det er ikke postens skyld, så den må ikke blive rød
    // og vente på et tryk på "Prøv igen" — den prøves igen med backoff-loftet.
    let current = base;
    for (let i = 0; i < MAX_ATTEMPTS + 3; i++)
      current = afterFailure(current, new TypeError('Network request failed'), 0);
    expect(current.failed).toBe(false);
    expect(current.nextAttemptAt).toBe(backoffDelay(current.attempts));
    const noResponse = TRPCClientError.from(new TypeError('Network request failed'));
    for (let i = 0; i < MAX_ATTEMPTS + 3; i++)
      current = afterFailure(current, noResponse, 0);
    expect(current.failed).toBe(false);
  });

  it('markerer en forbigående create som ubekræftet, så næste forsøg slår den op', () => {
    const once = afterFailure(base, new TypeError('Network request failed'), 0);
    expect(once).toMatchObject({ meta: { unconfirmed: true } });
  });

  it('stempler tidspunktet for det kald, der døde — opslaget skal kunne sammenligne det med serverens createdAt', () => {
    const once = afterFailure(base, new TypeError('Network request failed'), Date.parse('2026-09-29T14:00:00.000Z'));
    expect(once).toMatchObject({ meta: { firstAttemptAt: '2026-09-29T14:00:00.000Z' } });
  });

  it('beholder FØRSTE forsøgstidspunkt, så vinduet ikke strammer for hvert genforsøg', () => {
    const first = afterFailure(base, new TypeError('Network request failed'), Date.parse('2026-09-29T14:00:00.000Z'));
    const second = afterFailure(first, new TypeError('Network request failed'), Date.parse('2026-09-29T18:00:00.000Z'));
    expect(second).toMatchObject({ meta: { firstAttemptAt: '2026-09-29T14:00:00.000Z' } });
  });

  it('markerer IKKE ved permanent afvisning — serveren gemte den aldrig', () => {
    const failed = afterFailure(base, trpcError('BAD_REQUEST'), 0);
    expect(failed).not.toMatchObject({ meta: { unconfirmed: true } });
  });

  it('bevarer clearTimer, når en offline-timerstop markeres ubekræftet', () => {
    const stopped = item({ type: 'time.create', payload: createPayload, meta: { clearTimer: true } });
    const once = afterFailure(stopped, new TypeError('Network request failed'), 0);
    expect(once).toMatchObject({ meta: { clearTimer: true, unconfirmed: true } });
  });

  it('lader andre mutationstyper være urørt', () => {
    const del = item({ type: 'time.delete', payload: { id: 'e1' } });
    expect(afterFailure(del, new Error('net'), 0)).toMatchObject({ id: del.id, type: 'time.delete' });
  });

  it('resetForRetry nulstiller og gør elementet kørbart igen', () => {
    const failed = afterFailure(base, trpcError('BAD_REQUEST'), 0);
    const reset = resetForRetry(failed);
    expect(reset.failed).toBe(false);
    expect(reset.attempts).toBe(0);
    expect(reset.lastError).toBeNull();
    expect(runnableItems([reset], 0)).toHaveLength(1);
  });
});

describe('nextWakeupAt', () => {
  const base = item({ type: 'time.create', payload: createPayload });

  it('vågner når det FORRESTE element bliver klar — køen er strengt ordnet (#703)', () => {
    const early = afterFailure(base, new Error('net'), 1_000); // 3_000
    const late = afterFailure(item({ type: 'time.delete', payload: { id: 'b' } }), new Error('net'), 1_000); // 3_000
    late.nextAttemptAt = 9_000;
    // `early` står bag `late` og må ikke køre før den, så 3_000 er ikke et
    // tidspunkt, hvor noget kan ske.
    expect(nextWakeupAt([late, early], 1_000)).toBe(9_000);
    expect(nextWakeupAt([early, late], 1_000)).toBe(3_000);
  });

  it('returnerer null når intet venter på et forsøg', () => {
    expect(nextWakeupAt([], 0)).toBeNull();
    expect(nextWakeupAt([base], 0)).toBeNull();
    expect(nextWakeupAt([afterFailure(base, new Error('net'), 0)], 5_000)).toBeNull();
  });

  it('ignorerer fejlede elementer — de venter på brugerens valg, ikke på tid', () => {
    const failed = afterFailure(base, trpcError('FORBIDDEN'), 0);
    expect(failed.nextAttemptAt).toBe(Number.MAX_SAFE_INTEGER);
    expect(nextWakeupAt([failed], 0)).toBeNull();
  });

  it('ignorerer elementer fra en anden organisation', () => {
    const held = afterFailure(item({ type: 'time.create', payload: createPayload, orgId: 'org-a' }), new Error('net'), 0);
    expect(nextWakeupAt([held], 0, 'org-b')).toBeNull();
    expect(nextWakeupAt([held], 0, 'org-a')).toBe(held.nextAttemptAt);
  });
});

describe('org-stempling der aldrig strandrer tid', () => {
  const stranded = item({ type: 'time.create', payload: createPayload, orgId: null });
  const mine = item({ type: 'time.create', payload: createPayload, orgId: 'org-a' });
  const legacy = item({ type: 'time.create', payload: { ...createPayload, hours: 3 } });

  it('lader ALDRIG en post få orgId: null, som inActiveOrg filtrerer fra for evigt', () => {
    // `inActiveOrg` holder kun elementer UDEN orgId og elementer i den aktive
    // org. Et element stemplet med `null` hørte til hverken, så det blev
    // liggende i køen for evigt — brugeren venter på en post, der aldrig gemmes.
    expect(inActiveOrg([stranded], 'org-a')).toEqual([]);
    expect(orgToStamp(null)).toBeUndefined();
    expect(orgToStamp(undefined)).toBeUndefined();
    expect(orgToStamp('org-a')).toBe('org-a');
  });

  it('flytter eksisterende null-elementer over på den org, der viser sig', () => {
    const migrated = adoptUnstamped([stranded], 'org-a');
    expect(migrated[0].orgId).toBe('org-a');
    expect(inActiveOrg(migrated, 'org-a')).toHaveLength(1);
  });

  it('beholder elementer, der allerede har en org, og gør intet uden en org', () => {
    expect(adoptUnstamped([mine, legacy], 'org-a')).toEqual([mine, legacy]);
    // Uden en kendt org røres intet: elementerne er gamle nok til at blive
    // taget med, når org'en engang er kendt.
    expect(adoptUnstamped([stranded], null)).toEqual([stranded]);
  });
});

describe('inActiveOrg', () => {
  const mine = item({ type: 'time.create', payload: createPayload, orgId: 'org-a' });
  const theirs = item({ type: 'time.create', payload: { ...createPayload, hours: 2 }, orgId: 'org-b' });
  const legacy = item({ type: 'time.create', payload: { ...createPayload, hours: 3 } });

  it('holder elementer fra en anden org tilbage, så intet drænes mod forkert data', () => {
    expect(inActiveOrg([mine, theirs, legacy], 'org-a')).toEqual([mine, legacy]);
  });

  it('regner elementer uden orgId som hørende til den aktive org (aldrig strandre tid)', () => {
    expect(inActiveOrg([legacy], 'org-a')).toEqual([legacy]);
    expect(inActiveOrg([legacy], null)).toEqual([legacy]);
  });

  it('solo (null) holder kun elementer uden orgId', () => {
    expect(inActiveOrg([mine, legacy], null)).toEqual([legacy]);
  });

  it('runnableItems springer en anden orgs elementer over', () => {
    expect(runnableItems([mine, theirs], 0, 'org-a').map(i => i.orgId)).toEqual(['org-a']);
  });
});

describe('stoppedSessionsInQueue', () => {
  const T0 = '2026-09-06T08:00:00.000Z';
  const stopped = item({
    type: 'time.create',
    payload: { ...createPayload, startTime: T0, endTime: '2026-09-06T10:00:00.000Z' },
    meta: { clearTimer: true },
  });
  const locallyStarted = item({
    type: 'time.create',
    payload: { ...createPayload, startTime: '2026-09-06T06:00:00.000Z' },
    meta: { clearTimer: false },
  });
  const manual = item({ type: 'time.create', payload: createPayload, meta: { unconfirmed: true } });

  it('kender de sessioner, der er stoppet uden net og venter i køen', () => {
    expect(stoppedSessionsInQueue([stopped])).toEqual([T0]);
  });

  it('lader en lokalt startet timer ude — serveren har ingen session at genoplusse', () => {
    // `clearTimer: false` betyder: serveren har aldrig set denne session.
    // Den skal ikke stå i listen, for ellers ville en helt anden kørende
    // session med et tilfældigt matchende øjeblik blive skjult.
    expect(stoppedSessionsInQueue([locallyStarted])).toEqual([]);
  });

  it('lader en manuel registrering ude (den er ikke et timer-stop)', () => {
    expect(stoppedSessionsInQueue([manual])).toEqual([]);
  });

  it('lader et element uden startTime ude', () => {
    expect(stoppedSessionsInQueue([item({ type: 'time.create', payload: createPayload, meta: { clearTimer: true } })])).toEqual([]);
  });

  it('giver alle ventende stop, så ét forkert ikke skjuler de andre', () => {
    const two = item({
      type: 'time.create',
      payload: { ...createPayload, startTime: '2026-09-06T12:00:00.000Z' },
      meta: { clearTimer: true },
    });
    expect(stoppedSessionsInQueue([stopped, two]).sort()).toEqual([T0, '2026-09-06T12:00:00.000Z'].sort());
  });
});

describe('toggleBillable i køen', () => {
  const toggle = (id: string, isBillable: boolean) => item({ type: 'time.toggleBillable', payload: { id, isBillable } });

  it('erstatter et ventende toggle på samme post (seneste vinder)', () => {
    const first = enqueueItem([], toggle('e1', false));
    const second = enqueueItem(first.items, toggle('e1', true));
    expect(second.added).toBe(true);
    expect(second.items).toHaveLength(1);
    expect(second.items[0]!.payload).toMatchObject({ id: 'e1', isBillable: true });
  });

  it('lader et toggle på en anden post stå', () => {
    let items = enqueueItem([], toggle('e1', false)).items;
    items = enqueueItem(items, toggle('e2', true)).items;
    expect(items).toHaveLength(2);
  });

  it('en delete fjerner et ventende toggle på samme post', () => {
    let items = enqueueItem([], toggle('e1', false)).items;
    items = enqueueItem(items, item({ type: 'time.delete', payload: { id: 'e1' } })).items;
    expect(items.map(i => i.type)).toEqual(['time.delete']);
  });

  it('er idempotent: samme toggle to gange i køen tæller som én', () => {
    const first = enqueueItem([], toggle('e1', false));
    const second = enqueueItem(first.items, toggle('e1', false));
    expect(second.added).toBe(false);
  });
});

describe('resumeAfterLogin', () => {
  it('vækker elementer, der kun ventede på login', () => {
    const waiting = afterFailure(item({ id: 'a', type: 'time.create', payload: createPayload }), trpcError('UNAUTHORIZED'), 0);
    const [resumed] = resumeAfterLogin([waiting]);
    expect(resumed).toMatchObject({ failed: false, attempts: 0, nextAttemptAt: 0, lastError: null });
    expect(resumed.authBlocked).toBeUndefined();
  });

  it('vækker også elementer, en ældre version opgav efter fem 401\'er', () => {
    const legacy = item({ id: 'b', type: 'time.create', payload: createPayload, failed: true, attempts: 5, lastError: 'UNAUTHORIZED', nextAttemptAt: Number.MAX_SAFE_INTEGER });
    expect(resumeAfterLogin([legacy])[0]).toMatchObject({ failed: false, attempts: 0, nextAttemptAt: 0 });
  });

  it('rører ikke elementer, der fejlede på indholdet', () => {
    const rejected = afterFailure(item({ id: 'c', type: 'time.create', payload: createPayload }), trpcError('BAD_REQUEST'), 0);
    expect(resumeAfterLogin([rejected])[0]).toBe(rejected);
  });
});

describe('for gammel app (CLIENT_TOO_OLD)', () => {
  it('beholder posten uden at tælle forsøget og opgiver den aldrig', () => {
    let current = item({ type: 'time.create', payload: createPayload });
    for (let n = 0; n < MAX_ATTEMPTS + 2; n++)
      current = afterFailure(current, tooOldError(), n * 60_000);
    expect(current.failed).toBe(false);
    expect(current.attempts).toBe(0);
    expect(current.updateBlockedOn).toMatch(/^mobile\//);
    expect((current as { meta?: unknown }).meta).toBeUndefined();
  });

  it('venter 10 minutter før næste forsøg', () => {
    const failed = afterFailure(item({ type: 'time.create', payload: createPayload }), tooOldError(), 1_000);
    expect(failed.nextAttemptAt).toBe(1_000 + 10 * 60_000);
    expect(runnableItems([failed], 2_000)).toHaveLength(0);
  });

  it('en opdateret app sender ventende poster med det samme', () => {
    const blocked = item({ id: 'a', type: 'time.create', payload: createPayload, updateBlockedOn: 'mobile/1.0.0+4', nextAttemptAt: 99_999 });
    const [resumed] = resumeAfterUpdate([blocked], 'mobile/1.0.0+5');
    expect(resumed).toMatchObject({ nextAttemptAt: 0, attempts: 0, failed: false });
    expect(resumed.updateBlockedOn).toBeUndefined();
  });

  it('samme version venter fortsat', () => {
    const blocked = item({ id: 'a', type: 'time.create', payload: createPayload, updateBlockedOn: 'mobile/1.0.0+4', nextAttemptAt: 99_999 });
    expect(resumeAfterUpdate([blocked], 'mobile/1.0.0+4')[0]).toBe(blocked);
  });
});
