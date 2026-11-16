import type { QueuedMutation } from './queue-logic';
import { TRPCClientError } from '@trpc/client';
import { runOrQueue } from './run-or-queue';

jest.mock('~/lib/api/trpc', () => {
  const { TRPCClientError: Actual } = jest.requireActual('@trpc/client');
  return { trpcClient: {}, isTRPCClientError: (e: unknown) => e instanceof Actual };
});
jest.mock('./enqueue', () => ({ enqueueOffline: jest.fn(), isOffline: () => false }));

const createMutation: QueuedMutation = {
  type: 'time.create',
  payload: { description: 'Web', hours: 1.5, date: '2026-09-29', isBillable: true },
};

function networkError() {
  return TRPCClientError.from({ error: { message: 'Network request failed', code: -32000, data: { code: 'INTERNAL_SERVER_ERROR', httpStatus: 500, path: 'time.create' } } } as never);
}

function serverError(code: string) {
  return TRPCClientError.from({ error: { message: code, code: -32000, data: { code, httpStatus: 400, path: 'time.create' } } } as never);
}

function deps(online: boolean) {
  const queued: QueuedMutation[] = [];
  return { queued, d: { online: () => online, enqueue: (m: QueuedMutation) => queued.push(m), now: () => '2026-09-29T14:00:00.000Z' } };
}

describe('runOrQueue', () => {
  it('sender mutationen og melder "sent" når der er net og kaldet lykkes', async () => {
    const { queued, d } = deps(true);
    const run = jest.fn(async () => ({ id: 'e1' }));
    await expect(runOrQueue(createMutation, run, d)).resolves.toEqual({ kind: 'sent' });
    expect(run).toHaveBeenCalledTimes(1);
    expect(queued).toHaveLength(0);
  });

  it('lægger den i køen uden at kalde serveren når vi ved vi er offline', async () => {
    const { queued, d } = deps(false);
    const run = jest.fn(async () => ({}));
    await expect(runOrQueue(createMutation, run, d)).resolves.toEqual({ kind: 'queued' });
    expect(run).not.toHaveBeenCalled();
    expect(queued[0]).toMatchObject({ type: 'time.create' });
  });

  it('lægger den i køen når kaldet dør med tabt forbindelse — tiden må ikke tabes', async () => {
    const { queued, d } = deps(true);
    const run = jest.fn(async () => {
      throw networkError();
    });
    await expect(runOrQueue(createMutation, run, d)).resolves.toEqual({ kind: 'queued' });
    expect(queued[0]).toMatchObject({ type: 'time.create', meta: { unconfirmed: true } });
  });

  it('stempler tidspunktet for det døde kald, så opslaget kan kende posten fra en ægte samme dag', async () => {
    const { queued, d } = deps(true);
    await runOrQueue(createMutation, async () => {
      throw networkError();
    }, d);
    expect(queued[0]).toMatchObject({ meta: { firstAttemptAt: '2026-09-29T14:00:00.000Z' } });
  });

  it('stempler IKKE ved en ren offline-enqueue — intet er sendt, så intet skal slås op', async () => {
    const { queued, d } = deps(false);
    await runOrQueue(createMutation, jest.fn(async () => ({})), d);
    expect('meta' in (queued[0] ?? {})).toBe(false);
  });

  it('kaster videre ved permanent afvisning — brugeren skal se den', async () => {
    const { queued, d } = deps(true);
    const run = jest.fn(async () => {
      throw serverError('FORBIDDEN');
    });
    await expect(runOrQueue(createMutation, run, d)).rejects.toBeDefined();
    expect(queued).toHaveLength(0);
  });

  it('kaster videre ved 5xx: serverens svar kom, så intet er ukendt — og alt kan være gemt', async () => {
    const { queued, d } = deps(true);
    const run = jest.fn(async () => {
      throw serverError('INTERNAL_SERVER_ERROR');
    });
    await expect(runOrQueue(createMutation, run, d)).rejects.toBeDefined();
    expect(queued).toHaveLength(0);
  });

  it('markerer kun en create som ubekræftet, ikke en update eller delete', async () => {
    const { queued, d } = deps(true);
    const failing = async () => {
      throw networkError();
    };
    await runOrQueue({ type: 'time.update', payload: { id: 'e1', data: { description: 'Web', hours: 2, date: '2026-09-29' } } }, failing, d);
    await runOrQueue({ type: 'time.delete', payload: { id: 'e1' } }, failing, d);
    expect(queued[0]).not.toHaveProperty('meta');
    expect(queued[1]).not.toHaveProperty('meta');
  });

  it('bevarer clearTimer på en ubekræftet timer-post', async () => {
    const { queued, d } = deps(true);
    const mutation: QueuedMutation = { type: 'time.create', payload: { description: 'T', hours: 1, date: '2026-09-29', isBillable: true }, meta: { clearTimer: true } };
    await runOrQueue(mutation, async () => {
      throw networkError();
    }, d);
    expect(queued[0]).toMatchObject({ meta: { clearTimer: true, unconfirmed: true } });
  });

  it('lægger en skrivning, serveren afviste som for gammel app, i køen — uden unconfirmed', async () => {
    const { queued, d } = deps(true);
    const tooOld = TRPCClientError.from({ error: { message: 'for gammel', code: -32000, data: { code: 'PRECONDITION_FAILED', httpStatus: 412, path: 'time.create', appCode: 'CLIENT_TOO_OLD' } } } as never);
    await expect(runOrQueue(createMutation, async () => {
      throw tooOld;
    }, d)).resolves.toEqual({ kind: 'queued' });
    expect(queued[0]).toEqual(createMutation);
  });
});
