import { localStore } from './local-store';

jest.mock('expo-crypto', () => {
  let n = 0;
  return { randomUUID: () => `id-${++n}` };
});

describe('local-store timer', () => {
  beforeEach(() => localStore().clearAll());

  it('beskrivelse og valg skrevet før Start følger med og gemmes ved stop', () => {
    const projectId = localStore().addProject('Hjemmeside', null);
    localStore().setDraft({ description: 'Forside-design', projectId, clientId: null, tagIds: [] });
    localStore().startTimer(new Date(2026, 8, 24, 9));
    expect(localStore().timer).toMatchObject({ description: 'Forside-design', projectId });
    expect(localStore().draft.description).toBe('');

    const entry = localStore().stopTimer(new Date(2026, 8, 24, 10));
    expect(entry).toMatchObject({ description: 'Forside-design', projectId });
    expect(localStore().entries).toHaveLength(1);
    expect(localStore().timer).toBeNull();
    // Projektet huskes til næste start, teksten gør ikke.
    expect(localStore().draft).toMatchObject({ projectId, description: '' });
  });

  it('stop under ét minut gemmer intet', () => {
    localStore().startTimer(new Date(2026, 8, 24, 9));
    expect(localStore().stopTimer(new Date(2026, 8, 24, 9, 0, 30))).toBeNull();
    expect(localStore().entries).toHaveLength(0);
  });
});
