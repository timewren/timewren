import type { RouterInputs, RouterOutputs } from '~/api/app-router';

type PeriodInput = Exclude<RouterInputs['time']['list'], void>;

type Entry = RouterOutputs['time']['list']['entries'][number];
type Client = RouterOutputs['clients']['list'][number];
type Project = RouterOutputs['projects']['list'][number];

export type ReadKey
  = readonly ['time.list', PeriodInput]
    | readonly ['clients.list', { includeArchived: false }]
    | readonly ['projects.list'];

export function readKey(path: string, input: unknown): ReadKey | undefined {
  if (path === 'projects.list' && input === undefined)
    return ['projects.list'];
  if (path === 'clients.list' && input && typeof input === 'object' && Object.keys(input).every(k => k === 'includeArchived') && !('includeArchived' in input && input.includeArchived))
    return ['clients.list', { includeArchived: false }];
  if (path === 'time.list' && isOwnPeriod(input))
    return ['time.list', input];
}

function isOwnPeriod(input: unknown): input is PeriodInput {
  if (!input || typeof input !== 'object')
    return false;
  const { onlyOwn, startDate, endDate, limit } = input as PeriodInput;
  const date = /^\d{4}-\d{2}-\d{2}$/;
  return onlyOwn === true && typeof startDate === 'string' && typeof endDate === 'string'
    && date.test(startDate) && date.test(endDate) && limit === 1000
    && Object.keys(input).every(k => ['onlyOwn', 'startDate', 'endDate', 'limit', 'projectId'].includes(k));
}

function named(value: { name: string } | null | undefined) {
  return value ? { name: value.name } : null;
}

function projectEntry(entry: Entry) {
  return {
    id: entry.id,
    date: entry.date,
    hours: entry.hours,
    description: entry.description,
    isBillable: entry.isBillable,
    isBilled: entry.isBilled,
    isPrepaid: entry.isPrepaid,
    projectId: entry.projectId,
    client: named(entry.client),
    project: entry.project ? { name: entry.project.name, client: named(entry.project.client) } : null,
    tags: entry.tags.map(tag => ({ name: tag.name })),
  };
}

function projectClient(client: Client) {
  return { id: client.id, name: client.name };
}

function projectProject(project: Project) {
  return { id: project.id, name: project.name, clientId: project.clientId, status: project.status, client: named(project.client) };
}

export type CachedEntry = ReturnType<typeof projectEntry>;
export type CachedClient = ReturnType<typeof projectClient> & Partial<Pick<Client, 'company' | 'color'>>;
export type CachedProject = ReturnType<typeof projectProject> & Partial<Pick<Project, 'description'>>;

export function projectRead(key: ReadKey, data: unknown) {
  switch (key[0]) {
    case 'time.list':
      return { entries: (data as RouterOutputs['time']['list']).entries.map(projectEntry) };
    case 'clients.list':
      return (data as Client[]).map(projectClient);
    case 'projects.list':
      return (data as Project[]).map(projectProject);
  }
}
