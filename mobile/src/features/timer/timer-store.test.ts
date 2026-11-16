const mockMemory = new Map<string, string>();

jest.mock('~/lib/storage', () => ({
  storage: {
    getString: (k: string) => mockMemory.get(k),
    set: (k: string, v: string) => mockMemory.set(k, v),
    remove: (k: string) => mockMemory.delete(k),
  },
}));

// eslint-disable-next-line import/first
import { getTimerState, pickPersisted, TIMER_STORAGE_KEY, timerActions, useTimerStore } from './timer-store';

describe('timer-store', () => {
  beforeEach(() => {
    mockMemory.clear();
    timerActions().reset(0);
  });

  it('persisterer kun starttidspunkt og valg — aldrig forløbet tid eller funktioner', () => {
    timerActions().replace({
      startTime: '2026-09-06T08:00:00.000Z',
      baseSeconds: 0,
      version: 3,
      sessionId: null,
      pendingSync: false,
      projectId: 'p1',
      clientId: 'c1',
      taskId: null,
      description: 'Web',
      projectName: 'Website',
      clientName: 'Acme',
    });
    const raw = mockMemory.get(TIMER_STORAGE_KEY);
    expect(raw).toBeDefined();
    const parsed = JSON.parse(raw!);
    expect(Object.keys(parsed.state).sort()).toEqual([
      'baseSeconds',
      'clientId',
      'clientName',
      'description',
      'pendingSync',
      'projectId',
      'projectName',
      'sessionId',
      'startTime',
      'taskId',
      'version',
    ]);
    expect(parsed.state).not.toHaveProperty('elapsedSeconds');
    expect(parsed.state.startTime).toBe('2026-09-06T08:00:00.000Z');
  });

  it('pickPersisted fjerner alt der ikke er tilstand', () => {
    const picked = pickPersisted({ ...useTimerStore.getState(), extra: 1 } as never);
    expect(picked).not.toHaveProperty('replace');
    expect(picked).not.toHaveProperty('extra');
  });

  it('reset beholder serverens version', () => {
    timerActions().replace({ ...getTimerState(), startTime: '2026-09-06T08:00:00.000Z', version: 7 });
    timerActions().reset();
    expect(getTimerState().startTime).toBeNull();
    expect(getTimerState().version).toBe(7);
    timerActions().reset(9);
    expect(getTimerState().version).toBe(9);
  });

  it('setSelection opdaterer kun de givne felter', () => {
    timerActions().setSelection({ description: 'Ny' });
    expect(getTimerState().description).toBe('Ny');
    expect(getTimerState().projectId).toBeNull();
  });
});
