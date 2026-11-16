const mockMemory = new Map<string, string>();

jest.mock('~/lib/storage', () => ({
  getItem: <T>(key: string): T | null => {
    const raw = mockMemory.get(key);
    return raw === undefined ? null : JSON.parse(raw);
  },
  setItem: (key: string, value: unknown) => {
    mockMemory.set(key, JSON.stringify(value));
    return Promise.resolve();
  },
  removeItem: (key: string) => {
    mockMemory.delete(key);
    return Promise.resolve();
  },
}));

// eslint-disable-next-line import/first
import type { QuickStartSelection, RecentTask } from './quick-start';

// eslint-disable-next-line import/first
import {
  forgetQuickStart,
  isQuickStartable,
  QUICK_START_KEY,
  quickStartLabel,
  readQuickStart,
  rememberQuickStart,
  toQuickStart,
} from './quick-start';

function task(patch: Partial<RecentTask> = {}): RecentTask {
  return {
    entryId: 'e1',
    projectId: 'p1',
    clientId: 'c1',
    taskId: null,
    description: 'Web',
    projectName: 'Website',
    clientName: 'Acme',
    hours: '2.5',
    lastUsed: new Date('2026-09-29T08:00:00.000Z'),
    ...patch,
  };
}

function selection(patch: Partial<QuickStartSelection> = {}) {
  return { ...toQuickStart(task()), ...patch };
}

describe('quick-start', () => {
  beforeEach(() => {
    mockMemory.clear();
  });

  it('tager de felter `start` bruger med fra en post', () => {
    expect(toQuickStart(task({ taskId: null }))).toEqual({
      clientId: 'c1',
      projectId: 'p1',
      taskId: null,
      description: 'Web',
      clientName: 'Acme',
      projectName: 'Website',
    });
  });

  it('kræver kunde eller projekt — en tom start ville blive en anonym intern post', () => {
    expect(isQuickStartable(selection())).toBe(true);
    expect(isQuickStartable(selection({ projectId: null }))).toBe(true);
    expect(isQuickStartable(selection({ projectId: null, clientId: null }))).toBe(false);
    expect(isQuickStartable(null)).toBe(false);
  });

  it('viser kunde · projekt og bruger beskrivelsen som sidste udløbsvej', () => {
    expect(quickStartLabel(selection(), 'fallback')).toBe('Acme · Website');
    expect(quickStartLabel(selection({ projectName: null }), 'fallback')).toBe('Acme');
    expect(quickStartLabel(selection({ clientName: null, projectName: null }), 'fallback')).toBe('Web');
    expect(quickStartLabel(selection({ clientName: null, projectName: null, description: '' }), 'fallback')).toBe('fallback');
  });

  it('husker den seneste post, så start også virker uden net', () => {
    rememberQuickStart(task({ entryId: 'e9', clientName: 'Nyeste' }));
    expect(readQuickStart()).toEqual(selection({ clientName: 'Nyeste' }));
    expect(mockMemory.get(QUICK_START_KEY)).toContain('Nyeste');
  });

  it('overskriver med en nyere post', () => {
    rememberQuickStart(task({ clientName: 'Første' }));
    rememberQuickStart(task({ entryId: 'e2', clientName: 'Anden' }));
    expect(readQuickStart()?.clientName).toBe('Anden');
  });

  it('læser intet som en start, når der ikke er gemt noget eller formatet er ukendt', () => {
    expect(readQuickStart()).toBeNull();
    mockMemory.set(QUICK_START_KEY, JSON.stringify({ projectId: null, clientId: null }));
    expect(readQuickStart()).toBeNull();
    mockMemory.set(QUICK_START_KEY, '"defekt"');
    expect(readQuickStart()).toBeNull();
  });

  it('glemmer valget, når det ikke længere kan bruges', () => {
    rememberQuickStart(task());
    forgetQuickStart();
    expect(mockMemory.has(QUICK_START_KEY)).toBe(false);
    expect(readQuickStart()).toBeNull();
  });
});
