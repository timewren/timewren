import type { TimerTemplate } from './template-logic';
import { startFavorite, templateToStart, toFavorites } from './template-logic';

jest.mock('~/lib/storage', () => ({
  getItem: () => null,
  setItem: () => Promise.resolve(),
  removeItem: () => Promise.resolve(),
}));

type Relations = { projectId?: string | null; clientId?: string | null };

function template(over: Relations & Record<string, unknown> = {}): TimerTemplate {
  const projectId = over.projectId === undefined ? 'p1' : over.projectId;
  const clientId = over.clientId === undefined ? 'c1' : over.clientId;
  return {
    id: 't1',
    name: 'Support',
    description: 'Telefonopkald',
    color: '#3b82f6',
    isFavorite: true,
    usageCount: 3,
    lastUsedAt: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    projectId,
    clientId,
    project: projectId ? { id: 'p1', name: 'Drift', client: { id: 'c1', name: 'Acme' } } : null,
    client: clientId && !projectId ? { id: 'c1', name: 'Acme' } : null,
    ...over,
  } as unknown as TimerTemplate;
}

describe('templateToStart', () => {
  it('tager kunden fra projektet, når skabelonen kun har et projekt', () => {
    expect(templateToStart(template({ clientId: null }))).toEqual({
      projectId: 'p1',
      clientId: 'c1',
      taskId: null,
      description: 'Telefonopkald',
      projectName: 'Drift',
      clientName: 'Acme',
    });
  });

  it('tager kunden fra skabelonen selv, når den kun har en kunde', () => {
    expect(templateToStart(template({ projectId: null }))).toMatchObject({
      projectId: null,
      clientId: 'c1',
      projectName: null,
      clientName: 'Acme',
    });
  });

  it('udfylder en manglende beskrivelse med tom streng, ikke undefined', () => {
    expect(templateToStart(template({ description: null }))?.description).toBe('');
  });

  it('tilbyder ikke en skabelon uden kunde og projekt', () => {
    // Kolonnen er `set null`, så et slettet projekt efterlader skabelonen sådan.
    // Starten ville være en anonym intern post, der er svær at rette senere.
    expect(templateToStart(template({ projectId: null, clientId: null }))).toBeNull();
  });
});

describe('toFavorites', () => {
  it('beholder serverens rækkefølge og springer ustartbare over', () => {
    const result = toFavorites([
      template({ id: 't1', name: 'Support' }),
      template({ id: 't2', name: 'Intern', projectId: null, clientId: null }),
      template({ id: 't3', name: 'Drift', projectId: 'p1', clientId: null }),
    ] as unknown as TimerTemplate[]);

    expect(result.map(f => f.name)).toEqual(['Support', 'Drift']);
    expect(result[1].label).toBe('Acme · Drift');
  });

  it('giver en tom liste ved manglende data uden at fejle', () => {
    expect(toFavorites(undefined)).toEqual([]);
  });
});

describe('startFavorite', () => {
  function deps(over: Record<string, unknown> = {}) {
    return {
      start: jest.fn().mockResolvedValue(true),
      recordUsage: jest.fn().mockResolvedValue({}),
      invalidate: jest.fn(),
      ...over,
    };
  }

  it('starter skabelonen og tæl brugen op', async () => {
    const d = deps();
    await expect(startFavorite(template(), d)).resolves.toBe(true);
    expect(d.start).toHaveBeenCalledWith(expect.objectContaining({ projectId: 'p1', clientId: 'c1' }));
  });

  it('tæler ikke op, når timeren ikke startede', async () => {
    const d = deps({ start: jest.fn().mockResolvedValue(false) });
    await expect(startFavorite(template(), d)).resolves.toBe(false);
    expect(d.recordUsage).not.toHaveBeenCalled();
  });

  it('lader en fejl i optællingen være usynlig, men ugyldigere alligevel', async () => {
    // Optællingen er kosmetik: en fejl må ikke vise en fejl-dialog oven i en
    // startet timer, men listen skal hentes på ny, så serverens rækkefølge følger
    // den skabelon, brugeren lige trykkede.
    const d = deps({ recordUsage: jest.fn().mockRejectedValue(new Error('offline')) });
    await expect(startFavorite(template(), d)).resolves.toBe(true);
    await Promise.resolve();
    expect(d.invalidate).toHaveBeenCalledTimes(1);
  });

  it('gør intet ved en skabelon uden kunde og projekt', async () => {
    const d = deps();
    await expect(startFavorite(template({ projectId: null, clientId: null }), d)).resolves.toBe(false);
    expect(d.start).not.toHaveBeenCalled();
  });
});
