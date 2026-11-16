import { changeServer } from '~/features/server/change-server';
import { localStore } from './local-store';
import { runImport } from './use-local-import';

jest.mock('expo-crypto', () => {
  let n = 0;
  return { randomUUID: () => `local-${++n}` };
});
jest.mock('~/lib/api/provider', () => ({ queryClient: { invalidateQueries: jest.fn() } }));

const mockApi = {
  tagsList: jest.fn(),
  tagsCreate: jest.fn(),
  clientsList: jest.fn(),
  clientsCreate: jest.fn(),
  projectsList: jest.fn(),
  projectsCreate: jest.fn(),
  timeCreate: jest.fn(),
  setForEntry: jest.fn(),
};
jest.mock('~/lib/api/trpc', () => ({
  trpcClient: {
    tags: { list: { query: () => mockApi.tagsList() }, create: { mutate: (i: unknown) => mockApi.tagsCreate(i) }, setForEntry: { mutate: (i: unknown) => mockApi.setForEntry(i) } },
    clients: { list: { query: () => mockApi.clientsList() }, create: { mutate: (i: unknown) => mockApi.clientsCreate(i) } },
    projects: { list: { query: () => mockApi.projectsList() }, create: { mutate: (i: unknown) => mockApi.projectsCreate(i) } },
    time: { create: { mutate: (i: unknown) => mockApi.timeCreate(i) } },
  },
}));

function seed() {
  const s = localStore();
  s.clearAll();
  const clientId = s.addClient('Acme');
  const projectId = s.addProject('Web', clientId);
  const tagId = s.addTag('Møde');
  s.addEntry({ description: 'Kode', projectId, clientId, tagIds: [tagId], startedAt: new Date(2026, 8, 24, 9).toISOString(), endedAt: new Date(2026, 8, 24, 10).toISOString() });
}

describe('runImport', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockApi.tagsList.mockResolvedValue([]);
    mockApi.clientsList.mockResolvedValue([{ id: 'srv-acme', name: 'acme' }]);
    mockApi.projectsList.mockResolvedValue([]);
    mockApi.tagsCreate.mockResolvedValue({ id: 'srv-tag' });
    mockApi.projectsCreate.mockResolvedValue({ id: 'srv-web' });
    mockApi.timeCreate.mockResolvedValue({ id: 'srv-entry' });
    mockApi.setForEntry.mockResolvedValue({ success: true });
    seed();
  });

  it('genbruger eksisterende kunde, opretter resten og rydder lokalt', async () => {
    await runImport(() => {});
    expect(mockApi.clientsCreate).not.toHaveBeenCalled();
    expect(mockApi.projectsCreate).toHaveBeenCalledWith({ name: 'Web', clientId: 'srv-acme' });
    expect(mockApi.timeCreate).toHaveBeenCalledWith(expect.objectContaining({ projectId: 'srv-web', clientId: 'srv-acme', hours: 1 }));
    expect(mockApi.setForEntry).toHaveBeenCalledWith({ entryId: 'srv-entry', tagIds: ['srv-tag'] });
    expect(localStore().entries).toHaveLength(0);
    expect(localStore().enabled).toBe(false);
  });

  it('genoptager efter fejl på tags uden at oprette posten igen', async () => {
    mockApi.setForEntry.mockRejectedValueOnce(new Error('netværk'));
    await expect(runImport(() => {})).rejects.toThrow('netværk');
    expect(localStore().entries).toHaveLength(1);

    await runImport(() => {});
    expect(mockApi.timeCreate).toHaveBeenCalledTimes(1);
    expect(mockApi.tagsCreate).toHaveBeenCalledTimes(1);
    expect(mockApi.setForEntry).toHaveBeenCalledTimes(2);
    expect(mockApi.setForEntry).toHaveBeenLastCalledWith({ entryId: 'srv-entry', tagIds: ['srv-tag'] });
    expect(localStore().entries).toHaveLength(0);
  });

  it('blokerer serverskift efter delvis import og Senere indtil importen er færdig', async () => {
    localStore().addEntry({ description: 'Anden post', projectId: null, clientId: null, tagIds: [], startedAt: new Date(2026, 8, 25, 9).toISOString(), endedAt: new Date(2026, 8, 25, 10).toISOString() });
    mockApi.timeCreate.mockResolvedValueOnce({ id: 'server-a-entry' }).mockRejectedValueOnce(new Error('netværk'));
    await expect(runImport(() => {})).rejects.toThrow('netværk');
    localStore().deferImport();
    const journal = { ...localStore().remoteIds };
    const deps = {
      current: 'https://server-a.example',
      next: 'https://server-b.example',
      blocked: () => false,
      probe: jest.fn(async (url: string) => url),
      signOut: jest.fn(async () => {}),
      save: jest.fn(async () => {}),
      restart: jest.fn(async () => {}),
    };
    await expect(changeServer(deps)).rejects.toThrow('pending');
    expect(deps.signOut).not.toHaveBeenCalled();
    expect(deps.save).not.toHaveBeenCalled();
    expect(localStore().entries).toHaveLength(2);
    expect(localStore().remoteIds).toEqual(journal);

    await runImport(() => {});
    expect(mockApi.timeCreate).toHaveBeenCalledTimes(3);
    await changeServer(deps);
    expect(deps.save).toHaveBeenCalledWith(deps.next);
  });
});
