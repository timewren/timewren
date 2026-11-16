const mockQueue = { items: [] as unknown[] };
jest.mock('~/features/offline/queue-store', () => ({ offlineQueue: () => mockQueue }));
const mockTimer = { current: { startTime: null as string | null } };
jest.mock('~/features/timer/timer-store', () => ({ getTimerState: () => mockTimer.current }));
const mockJournal = { current: false };
jest.mock('~/features/timer/timer-recovery', () => ({ getPendingStop: () => (mockJournal.current ? { stoppedAt: 'x' } : null) }));

// eslint-disable-next-line import/first
import { antalDaLogUdsletter, uafsluttetTidNu } from './logout-guard';

beforeEach(() => {
  mockQueue.items = [];
  mockTimer.current = { startTime: null };
  mockJournal.current = false;
});

describe('antalDaLogUdsletter', () => {
  it('tæller hver usendt registrering i køen', () => {
    expect(antalDaLogUdsletter({ iKoen: 3, koeendeTimer: false, afbrudtStop: false })).toBe(3);
  });

  it('tæller en kørende timer som én — log ud smider den forløbne tid', () => {
    expect(antalDaLogUdsletter({ iKoen: 0, koeendeTimer: true, afbrudtStop: false })).toBe(1);
  });

  it('tæller et afbrudt stop, hvis stop-øjeblikket ikke nåede serveren', () => {
    expect(antalDaLogUdsletter({ iKoen: 1, koeendeTimer: false, afbrudtStop: true })).toBe(2);
  });

  it('er nul, når alt er sendt', () => {
    expect(antalDaLogUdsletter({ iKoen: 0, koeendeTimer: false, afbrudtStop: false })).toBe(0);
  });
});

describe('uafsluttetTidNu', () => {
  it('ser kø, kørende timer og afbrudt stop', () => {
    mockQueue.items = [{}, {}, {}];
    mockTimer.current = { startTime: '2026-09-30T08:00:00.000Z' };
    mockJournal.current = true;

    expect(uafsluttetTidNu()).toEqual({ iKoen: 3, koeendeTimer: true, afbrudtStop: true });
  });

  it('meldet intet, når appen er helt synkroniseret og intet kører', () => {
    expect(uafsluttetTidNu()).toEqual({ iKoen: 0, koeendeTimer: false, afbrudtStop: false });
  });
});
