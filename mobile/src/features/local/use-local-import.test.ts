import { changeServer } from '~/features/server/change-server';
import { storage } from '~/lib/storage';
import { localStore, useLocalStore } from './local-store';
import { runImport } from './use-local-import';

jest.mock('expo-crypto', () => {
  let n = 0;
  return { randomUUID: () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}` };
});
jest.mock('~/lib/api/provider', () => ({ queryClient: { invalidateQueries: jest.fn() } }));

jest.mock('~/lib/storage', () => {
  let snapshot: string | undefined;
  return {
    storage: {
      getString: () => snapshot,
      set: (_key: string, value: string) => { snapshot = value; },
    },
  };
});
jest.mock('~/features/server/server-config', () => ({ getApiUrl: () => 'https://server-a.example' }));
jest.mock('~/lib/auth/client', () => ({ getSessionCookie: async () => mockCookie }));
jest.mock('~/lib/i18n', () => ({ translate: (key: string) => key }));

let mockCookie = 'cookie-a';
const mockScope = jest.fn();

const mockApi = {
  profile: jest.fn(),
  capabilities: jest.fn(),
  tagsList: jest.fn(),
  tagsCreate: jest.fn(),
  clientsList: jest.fn(),
  clientsCreate: jest.fn(),
  projectsList: jest.fn(),
  projectsCreate: jest.fn(),
  timeCreate: jest.fn(),
  timeGet: jest.fn(),
  setForEntry: jest.fn(),
};
jest.mock('~/lib/api/trpc', () => ({
  isTRPCClientError: (error: { data?: unknown }) => !!error.data,
  createSessionTRPCClient: (cookie: string, orgId?: string) => {
    mockScope(cookie, orgId);
    if (orgId?.startsWith('00000000-0000-4000-8000-')) {
      return { mobile: { getCapabilities: { query: async () => {
        throw Object.assign(new Error('Forbidden'), { data: { code: 'FORBIDDEN' } });
      } } } };
    }
    return {
      user: { getProfile: { query: () => mockApi.profile() } },
      mobile: { getCapabilities: { query: () => mockApi.capabilities() } },
      tags: { list: { query: () => mockApi.tagsList() }, create: { mutate: (i: unknown) => mockApi.tagsCreate(i) }, setForEntry: { mutate: (i: unknown) => mockApi.setForEntry(i) } },
      clients: { list: { query: () => mockApi.clientsList() }, create: { mutate: (i: unknown) => mockApi.clientsCreate(i) } },
      projects: { list: { query: () => mockApi.projectsList() }, create: { mutate: (i: unknown) => mockApi.projectsCreate(i) } },
      time: { create: { mutate: (i: unknown) => mockApi.timeCreate(i) }, getById: { query: (i: unknown) => mockApi.timeGet(i) } },
    };
  },
}));

async function restart() {
  const saved = storage.getString('local-mode')!;
  localStore().clearAll();
  storage.set('local-mode', saved);
  await useLocalStore.persist.rehydrate();
}

function seed() {
  const s = localStore();
  s.clearAll();
  const clientId = s.addClient('Acme');
  const projectId = s.addProject('Web', clientId);
  const tagId = s.addTag('Møde');
  s.addEntry({ description: 'Kode', projectId, clientId, tagIds: [tagId], startedAt: new Date(2026, 8, 24, 9).toISOString(), endedAt: new Date(2026, 8, 24, 10).toISOString() });
}

function serverEntry() {
  const entry = localStore().entries.at(-1)!;
  return {
    id: 'srv-entry',
    organizationId: 'org-a',
    description: entry.description,
    hours: '1.00',
    date: new Date('2026-09-24'),
    startTime: new Date(entry.startedAt),
    endTime: new Date(entry.endedAt),
    projectId: 'srv-web',
    clientId: 'srv-acme',
    tags: [],
  };
}

beforeEach(() => {
  jest.resetAllMocks();
  mockCookie = 'cookie-a';
  mockApi.profile.mockResolvedValue({ id: 'user-a' });
  mockApi.capabilities.mockResolvedValue({ org: { id: 'org-a' } });
  mockApi.tagsList.mockResolvedValue([]);
  mockApi.clientsList.mockResolvedValue([{ id: 'srv-acme', name: 'acme' }]);
  mockApi.projectsList.mockResolvedValue([]);
  mockApi.tagsCreate.mockResolvedValue({ id: 'srv-tag' });
  mockApi.projectsCreate.mockResolvedValue({ id: 'srv-web' });
  mockApi.timeCreate.mockResolvedValue({ id: 'srv-entry', organizationId: 'org-a' });
  mockApi.setForEntry.mockResolvedValue({ success: true });
  seed();
  mockApi.timeGet.mockResolvedValue(serverEntry());
});

describe('runImport', () => {
  it('genbruger eksisterende kunde, opretter resten og rydder lokalt', async () => {
    await runImport(() => {});
    expect(mockApi.clientsCreate).not.toHaveBeenCalled();
    expect(mockApi.capabilities).toHaveBeenCalledTimes(13);
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

  it('bevarer en redigeret post efter tabt kvittering og genstart', async () => {
    const entry = localStore().entries[0]!;
    const endedAt = new Date(Date.parse(entry.endedAt) + 3600000).toISOString();
    mockApi.timeCreate.mockRejectedValueOnce(new Error('tabt kvittering'));
    await expect(runImport(() => {})).rejects.toThrow('tabt kvittering');
    localStore().deferImport();
    localStore().updateEntry(entry.id, { endedAt });
    await restart();

    mockApi.timeCreate.mockResolvedValueOnce({
      id: 'srv-entry',
      organizationId: 'org-a',
      deduplicated: true,
      description: entry.description,
      hours: '1.00',
      date: new Date('2026-09-24'),
      startTime: new Date(entry.startedAt),
      endTime: new Date(entry.endedAt),
      projectId: 'srv-web',
      clientId: 'srv-acme',
    });
    await expect(runImport(() => {})).rejects.toThrow('entry_conflict');
    expect(mockApi.timeCreate).toHaveBeenLastCalledWith(expect.objectContaining({ clientEntryId: entry.id, hours: 2 }));
    expect(mockApi.setForEntry).not.toHaveBeenCalled();
    expect(localStore().remoteIds[entry.id]).toBeUndefined();
    expect(localStore().entries[0]?.endedAt).toBe(endedAt);
  });

  it('bevarer en redigeret post, hvis server-id allerede er journalført', async () => {
    mockApi.setForEntry.mockRejectedValueOnce(new Error('netværk'));
    await expect(runImport(() => {})).rejects.toThrow('netværk');
    const entry = localStore().entries[0]!;
    localStore().updateEntry(entry.id, { description: 'Rettet' });

    await expect(runImport(() => {})).rejects.toThrow('entry_conflict');
    expect(mockApi.timeCreate).toHaveBeenCalledTimes(1);
    expect(mockApi.setForEntry).toHaveBeenCalledTimes(1);
    expect(localStore().entries[0]?.description).toBe('Rettet');
  });

  it('genbruger den lokale UUID efter tabt kvittering og genstart', async () => {
    const rows = new Map<string, ReturnType<typeof serverEntry>>();
    const entryId = localStore().entries[0]!.id;
    mockApi.timeCreate.mockImplementation(async ({ clientEntryId }: { clientEntryId: string }) => {
      const existing = rows.get(clientEntryId);
      if (existing)
        return { ...existing, deduplicated: true };
      const row = serverEntry();
      rows.set(clientEntryId, row);
      throw new Error('tabt kvittering');
    });

    await expect(runImport(() => {})).rejects.toThrow('tabt kvittering');
    expect(localStore().remoteIds[entryId]).toBeUndefined();
    await restart();
    await runImport(() => {});
    expect([...rows.keys()]).toEqual([entryId]);
    expect(mockApi.timeCreate).toHaveBeenCalledTimes(2);
    expect(mockScope).toHaveBeenCalledWith('cookie-a', 'org-a');
    expect(mockApi.setForEntry).toHaveBeenCalledWith({ entryId: 'srv-entry', tagIds: ['srv-tag'] });
    expect(localStore().entries).toHaveLength(0);
  });
});

describe('genoptagelse af journalførte poster', () => {
  it('fjerner manuelle tags efter tabt kvittering og lokal fjernelse af sidste tag', async () => {
    const remote = { ...serverEntry(), tags: [{ id: 'srv-inherited', inherited: true }] };
    mockApi.timeGet.mockResolvedValue(remote);
    mockApi.setForEntry.mockImplementationOnce(async () => {
      remote.tags.push({ id: 'srv-tag', inherited: false });
      throw new Error('tabt kvittering');
    });
    await expect(runImport(() => {})).rejects.toThrow('tabt kvittering');
    const entry = localStore().entries[0]!;
    expect(localStore().remoteIds[`${entry.id}#tags`]).toBe('pending');
    localStore().deferImport();
    localStore().updateEntry(entry.id, { tagIds: [] });
    await restart();

    mockApi.setForEntry.mockImplementationOnce(async () => {
      remote.tags = remote.tags.filter(tag => tag.inherited);
      return { success: true };
    });
    await runImport(() => {});
    expect(mockApi.setForEntry).toHaveBeenLastCalledWith({ entryId: 'srv-entry', tagIds: [] });
    expect(remote.tags).toEqual([{ id: 'srv-inherited', inherited: true }]);
    expect(mockApi.timeCreate).toHaveBeenCalledTimes(1);
    expect(localStore().entries).toHaveLength(0);
  });

  it('bevarer manuelle webtags på en post uden påbegyndt tagtrin', async () => {
    const entry = localStore().entries[0]!;
    localStore().updateEntry(entry.id, { tagIds: [] });
    const remote = serverEntry();
    localStore().addEntry({ ...entry, tagIds: [], startedAt: new Date(2026, 8, 25, 9).toISOString(), endedAt: new Date(2026, 8, 25, 10).toISOString() });
    mockApi.timeCreate
      .mockResolvedValueOnce({ id: 'srv-entry', organizationId: 'org-a' })
      .mockRejectedValueOnce(new Error('netværk'));
    await expect(runImport(() => {})).rejects.toThrow('netværk');
    await restart();

    mockApi.timeGet.mockResolvedValueOnce({ ...remote, tags: [{ id: 'web-tag', inherited: false }] });
    await expect(runImport(() => {})).resolves.toBe(true);
    expect(mockApi.setForEntry).not.toHaveBeenCalled();
    expect(localStore().entries).toHaveLength(0);
  });

  it.each([false, true])('genskaber en slettet post og bevarer resten af journalen (tags: %s)', async (withTags) => {
    const entry = localStore().entries[0]!;
    const remote = serverEntry();
    if (!withTags)
      localStore().updateEntry(entry.id, { tagIds: [] });
    localStore().addEntry({ ...entry, startedAt: new Date(Date.parse(entry.startedAt) + 86400000).toISOString(), endedAt: new Date(Date.parse(entry.endedAt) + 86400000).toISOString() });
    mockApi.timeCreate
      .mockResolvedValueOnce({ id: 'srv-entry', organizationId: 'org-a' })
      .mockRejectedValueOnce(new Error('netværk'));
    await expect(runImport(() => {})).rejects.toThrow('netværk');
    await restart();

    mockApi.timeGet.mockRejectedValueOnce(Object.assign(new Error('Tidsregistrering ikke fundet'), { data: { code: 'NOT_FOUND' } }));
    mockApi.timeCreate
      .mockResolvedValueOnce({ id: 'srv-recreated', organizationId: 'org-a' })
      .mockResolvedValueOnce({ id: 'srv-later', organizationId: 'org-a' });
    if (withTags) {
      mockApi.setForEntry.mockRejectedValueOnce(new Error('tagkald afbrudt'));
      await expect(runImport(() => {})).rejects.toThrow('tagkald afbrudt');
      await restart();
      expect(localStore().remoteIds[entry.id]).toBe('srv-recreated');
      expect(localStore().remoteIds[`${entry.id}#tags`]).toBe('pending');
      mockApi.timeGet.mockResolvedValueOnce({ ...remote, id: 'srv-recreated' });
    }
    await runImport(() => {});
    expect(mockApi.timeCreate).toHaveBeenCalledTimes(4);
    expect(mockApi.timeCreate).toHaveBeenNthCalledWith(3, expect.objectContaining({ clientEntryId: entry.id }));
    expect(mockApi.tagsCreate).toHaveBeenCalledTimes(1);
    expect(mockApi.projectsCreate).toHaveBeenCalledTimes(1);
    if (withTags)
      expect(mockApi.setForEntry).toHaveBeenCalledWith({ entryId: 'srv-recreated', tagIds: ['srv-tag'] });
    expect(localStore().entries).toHaveLength(0);
  });

  it.each([
    ['INTERNAL_SERVER_ERROR', 'Serverfejl'],
    ['NOT_FOUND', 'No procedure found on path "time.getById"'],
  ])('bevarer journal og lokal kopi ved opslag med %s (%s)', async (code, message) => {
    mockApi.setForEntry.mockRejectedValueOnce(new Error('netværk'));
    await expect(runImport(() => {})).rejects.toThrow('netværk');
    const journal = localStore().remoteIds;
    mockApi.timeGet.mockRejectedValueOnce(Object.assign(new Error(message), { data: { code } }));

    await expect(runImport(() => {})).rejects.toThrow(message);
    expect(mockApi.timeCreate).toHaveBeenCalledTimes(1);
    expect(localStore().remoteIds).toBe(journal);
    expect(localStore().entries).toHaveLength(1);
  });
});

describe('importdestination', () => {
  it.each(['konto', 'organisation'])('bevarer delvis import ved skift af %s efter Senere', async (kind) => {
    mockApi.setForEntry.mockRejectedValueOnce(new Error('netværk'));
    await expect(runImport(() => {})).rejects.toThrow('netværk');
    localStore().deferImport();
    const journal = localStore().remoteIds;
    const destination = localStore().importDestination;
    if (kind === 'konto')
      mockApi.profile.mockResolvedValueOnce({ id: 'user-b' });
    else
      mockApi.capabilities.mockResolvedValueOnce({ org: { id: 'org-b' } });

    await expect(runImport(() => {})).rejects.toThrow('destination_changed');
    expect(mockApi.tagsList).toHaveBeenCalledTimes(1);
    expect(mockApi.setForEntry).toHaveBeenCalledTimes(1);
    expect(localStore().remoteIds).toBe(journal);
    expect(localStore().importDestination).toBe(destination);
    expect(localStore().entries).toHaveLength(1);

    await runImport(() => {});
    expect(mockApi.timeCreate).toHaveBeenCalledTimes(1);
    expect(mockApi.setForEntry).toHaveBeenCalledTimes(2);
    expect(localStore().entries).toHaveLength(0);
  });

  it('stopper før fjernkald ved genstart med en gammel journal', async () => {
    localStore().setRemoteId('old-entry#tags', 'done');
    const stored = JSON.parse(storage.getString('local-mode')!);
    delete stored.state.importDestination;
    storage.set('local-mode', JSON.stringify(stored));

    await restart();
    await expect(runImport(() => {})).rejects.toThrow('legacy_journal');
    expect(mockScope).not.toHaveBeenCalled();
    expect(localStore().remoteIds).toEqual({ 'old-entry#tags': 'done' });
    expect(localStore().entries).toHaveLength(1);
  });

  it('afslutter ikke tagtrinnet og rydder ikke efter org-skift under kaldet', async () => {
    mockApi.setForEntry.mockImplementationOnce(async () => {
      mockApi.capabilities.mockResolvedValue({ org: { id: 'org-b' } });
      return { success: true };
    });
    await expect(runImport(() => {})).rejects.toThrow('destination_changed');
    const entryId = localStore().entries[0]!.id;
    expect(localStore().remoteIds[entryId]).toBe('srv-entry');
    expect(localStore().remoteIds[`${entryId}#tags`]).toBe('pending');

    mockApi.capabilities.mockResolvedValue({ org: { id: 'org-a' } });
    await runImport(() => {});
    expect(mockApi.timeCreate).toHaveBeenCalledTimes(1);
    expect(mockApi.setForEntry).toHaveBeenCalledTimes(2);
  });

  it('bevarer kopien ved kontoskift lige før oprydning', async () => {
    await expect(runImport(({ done, total }) => {
      if (done === total)
        mockCookie = 'cookie-b';
    })).rejects.toThrow('destination_changed');

    expect(localStore().entries).toHaveLength(1);
    expect(localStore().importDestination?.userId).toBe('user-a');
  });

  it('starter kun én import ved samtidige tryk', async () => {
    const first = runImport(() => {});
    await expect(runImport(() => {})).resolves.toBe(false);
    await expect(first).resolves.toBe(true);
    expect(mockApi.timeCreate).toHaveBeenCalledTimes(1);
  });
});

describe('samtidige handlinger', () => {
  it('blokerer serverskift efter delvis import og Senere indtil importen er færdig', async () => {
    localStore().addEntry({ description: 'Anden post', projectId: null, clientId: null, tagIds: [], startedAt: new Date(2026, 8, 25, 9).toISOString(), endedAt: new Date(2026, 8, 25, 10).toISOString() });
    mockApi.timeCreate.mockResolvedValueOnce({ id: 'server-a-entry', organizationId: 'org-a' }).mockRejectedValueOnce(new Error('netværk'));
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

    mockApi.timeGet.mockResolvedValue({ ...serverEntry(), id: 'server-a-entry', tags: [{ id: 'srv-tag', inherited: false }] });
    await runImport(() => {});
    expect(mockApi.timeCreate).toHaveBeenCalledTimes(3);
    await changeServer(deps);
    expect(deps.save).toHaveBeenCalledWith(deps.next);
  });
});
