import type { LocalData } from './local-logic';
import type { RouterOutputs } from '~/api/app-router';
import * as React from 'react';
import { queryClient } from '~/lib/api/provider';
import { isTRPCClientError } from '~/lib/api/trpc';
import { translate } from '~/lib/i18n';
import { destinationChanged, openImportDestination } from './import-destination';
import { matchByName, toTimeCreateInput } from './local-logic';
import { localStore } from './local-store';

type Progress = { done: number; total: number };

let importing = false;

/**
 * Overfører lokale data til den loggede konto: tags → kunder → projekter → poster.
 * Genbruger eksisterende server-objekter med samme navn og husker server-id'er
 * undervejs, så et afbrudt forløb (fx netværksfejl) kan genoptages uden dubletter.
 */
export async function runImport(onProgress: (p: Progress) => void) {
  if (importing)
    return false;
  importing = true;
  try {
    await importLocalData(onProgress);
    return true;
  }
  finally {
    importing = false;
  }
}

function entryConflict() {
  return new Error(translate('local.import.entry_conflict'));
}

function missingTimeEntry(error: unknown) {
  return isTRPCClientError(error) && error.data?.code === 'NOT_FOUND'
    && error.message === 'Tidsregistrering ikke fundet';
}

function verifyEntry(
  remote: RouterOutputs['time']['create'] | RouterOutputs['time']['getById'],
  input: ReturnType<typeof toTimeCreateInput>,
  orgId: string,
) {
  if (remote.organizationId !== orgId)
    throw destinationChanged();
  if (remote.description !== input.description || Number(remote.hours) !== input.hours
    || remote.date.getTime() !== Date.parse(input.date)
    || remote.startTime?.getTime() !== Date.parse(input.startTime)
    || remote.endTime?.getTime() !== Date.parse(input.endTime)
    || remote.projectId !== (input.projectId ?? null) || remote.clientId !== (input.clientId ?? null)) {
    throw entryConflict();
  }
}

function hasChanged(data: LocalData, current: LocalData) {
  return current.entries !== data.entries || current.tags !== data.tags
    || current.projects !== data.projects || current.clients !== data.clients || current.timer !== data.timer;
}

async function importLocalData(onProgress: (p: Progress) => void) {
  const { client, call, check, orgId } = await openImportDestination();
  const s = localStore();
  // En kørende timer gemmes som post først, så den kommer med.
  if (s.timer)
    s.stopTimer();

  const data = localStore();
  const total = data.tags.length + data.clients.length + data.projects.length + data.entries.length;
  let done = 0;
  const step = () => onProgress({ done: ++done, total });
  onProgress({ done, total });

  const [remoteTags, remoteClients, remoteProjects] = await call(() => Promise.all([
    client.tags.list.query(),
    client.clients.list.query({ includeArchived: true }),
    client.projects.list.query(),
  ]));

  for (const tag of data.tags) {
    if (!localStore().remoteIds[tag.id]) {
      const match = matchByName(remoteTags, tag.name);
      if (match)
        await check();
      const id = match ?? (await call(() => client.tags.create.mutate({ name: tag.name, color: tag.color }))).id;
      localStore().setRemoteId(tag.id, id);
    }
    step();
  }

  for (const customer of data.clients) {
    if (!localStore().remoteIds[customer.id]) {
      const match = matchByName(remoteClients, customer.name);
      if (match)
        await check();
      const id = match ?? (await call(() => client.clients.create.mutate({ name: customer.name }))).id;
      localStore().setRemoteId(customer.id, id);
    }
    step();
  }

  for (const project of data.projects) {
    if (!localStore().remoteIds[project.id]) {
      const clientId = project.clientId ? localStore().remoteIds[project.clientId] ?? null : null;
      const sameClient = remoteProjects.filter(p => (p.clientId ?? null) === clientId);
      const match = matchByName(sameClient, project.name);
      if (match)
        await check();
      const id = match
        ?? (await call(() => client.projects.create.mutate({ name: project.name, clientId }))).id;
      localStore().setRemoteId(project.id, id);
    }
    step();
  }

  // Ældste først, så rækkefølgen i kontoen matcher registreringen.
  const entries = [...data.entries].sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt));
  for (const entry of entries) {
    const ids = localStore().remoteIds;
    const input = toTimeCreateInput(entry, ids);
    const tagIds = entry.tagIds.map(t => ids[t]).filter((t): t is string => !!t);
    const tagsKey = `${entry.id}#tags`;
    const savedId = ids[entry.id];
    const saved = savedId
      ? await call(() => client.time.getById.query({ id: savedId }).catch((error: unknown) => {
          if (missingTimeEntry(error))
            return null;
          throw error;
        }))
      : null;
    let remoteId: string;
    if (saved) {
      verifyEntry(saved, input, orgId);
      if (ids[tagsKey] === 'done' && (tagIds.some(id => !saved.tags.some(tag => tag.id === id))
        || saved.tags.some(tag => !tag.inherited && !tagIds.includes(tag.id)))) {
        throw entryConflict();
      }
      remoteId = saved.id;
    }
    else {
      const created = await call(() => client.time.create.mutate(input));
      if (created.organizationId !== orgId)
        throw destinationChanged();
      if (created.deduplicated)
        verifyEntry(created, input, orgId);
      remoteId = created.id;
      localStore().setRemoteEntryId(entry.id, remoteId);
    }
    const tagStep = localStore().remoteIds[tagsKey];
    const needsTagWrite = tagIds.length > 0
      || (tagStep === 'pending' && saved?.tags.some(tag => !tag.inherited));
    if (tagStep !== 'done' && needsTagWrite) {
      await call(() => {
        // Gem forsøget før kaldet, så en tabt kvittering kan genoptages.
        localStore().setRemoteId(tagsKey, 'pending');
        return client.tags.setForEntry.mutate({ entryId: remoteId, tagIds });
      });
      localStore().setRemoteId(tagsKey, 'done');
    }
    step();
  }

  await check();
  if (hasChanged(data, localStore()))
    throw entryConflict();
  localStore().clearAll();
  await queryClient.invalidateQueries();
}

export function useLocalImport() {
  const [progress, setProgress] = React.useState<Progress | null>(null);
  const [error, setError] = React.useState<unknown>(null);
  const [running, setRunning] = React.useState(false);

  const start = React.useCallback(async () => {
    if (importing)
      return false;
    setRunning(true);
    setError(null);
    try {
      return await runImport(setProgress);
    }
    catch (e) {
      setError(e);
      return false;
    }
    finally {
      setRunning(false);
    }
  }, []);

  return { start, progress, error, running };
}
