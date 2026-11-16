import type { QueuedMutation } from './queue-logic';

const enqueued: QueuedMutation[] = [];

jest.mock('./queue-store', () => ({
  offlineQueue: () => ({ enqueue: (mutation: QueuedMutation) => enqueued.push(mutation) }),
}));

// eslint-disable-next-line import/first
import { EMPTY_TIMER, startLocal } from '~/features/timer/timer-logic';
// eslint-disable-next-line import/first
import { queueTimerStop } from './timer-offline';

const T0 = new Date('2026-09-29T08:00:00.000Z');

function lastCreate() {
  const item = enqueued.at(-1);
  if (item?.type !== 'time.create')
    throw new Error('Forventede en time.create i køen');
  return item;
}

beforeEach(() => {
  enqueued.length = 0;
});

describe('queueTimerStop', () => {
  it('lægger tidsposten i køen med den udløbne tid', () => {
    const state = { ...EMPTY_TIMER, startTime: T0.toISOString(), projectId: 'p1' };
    const hours = queueTimerStop(state, 'Tidsregistrering', { now: new Date(T0.getTime() + 1_800_000) });

    expect(hours).toBe(0.5);
    expect(lastCreate().payload).toMatchObject({ hours: 0.5, fromTimer: true, projectId: 'p1' });
  });

  it('rydder serverens session når den faktisk har vores timer', () => {
    const state = { ...EMPTY_TIMER, startTime: T0.toISOString(), pendingSync: false };
    queueTimerStop(state, 'x', { now: T0 });
    expect(lastCreate().meta).toMatchObject({ clearTimer: true });
  });

  it('ryder IKKE serverens session for en lokalt startet timer', () => {
    // Serveren har ingen kørende session at rydde. En clear ville ramme en
    // helt anden enheds timer og slette den.
    const state = startLocal({ ...EMPTY_TIMER, projectId: 'p1' }, T0);
    queueTimerStop(state, 'x', { now: T0 });
    expect(lastCreate().meta).toMatchObject({ clearTimer: false });
  });

  it('markeres ubekræftet når time.create faktisk blev kaldt og døde', () => {
    // Serveren kan have gemt posten, før svaret forsvandt. Uden flaget ville
    // dræningen oprette samme tidsrum igen.
    queueTimerStop({ ...EMPTY_TIMER, startTime: T0.toISOString() }, 'x', { now: T0, unconfirmed: true });
    expect(lastCreate().meta).toMatchObject({ unconfirmed: true });
  });

  it('er bekræftet for et rent offline-stop, der aldrig har været sendt', () => {
    queueTimerStop({ ...EMPTY_TIMER, startTime: T0.toISOString() }, 'x', { now: T0 });
    expect(lastCreate().meta).toMatchObject({ unconfirmed: false });
  });
});
