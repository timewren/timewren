import * as React from 'react';
import { queryClient } from '~/lib/api/provider';
import { trpcClient } from '~/lib/api/trpc';
import { matchByName, toTimeCreateInput } from './local-logic';
import { localStore } from './local-store';

type Progress = { done: number; total: number };

/**
 * Overfører lokale data til den loggede konto: tags → kunder → projekter → poster.
 * Genbruger eksisterende server-objekter med samme navn og husker server-id'er
 * undervejs, så et afbrudt forløb (fx netværksfejl) kan genoptages uden dubletter.
 */
export async function runImport(onProgress: (p: Progress) => void) {
  const s = localStore();
  // En kørende timer gemmes som post først, så den kommer med.
  if (s.timer)
    s.stopTimer();

  const data = localStore();
  const total = data.tags.length + data.clients.length + data.projects.length + data.entries.length;
  let done = 0;
  const step = () => onProgress({ done: ++done, total });
  onProgress({ done, total });

  const [remoteTags, remoteClients, remoteProjects] = await Promise.all([
    trpcClient.tags.list.query(),
    trpcClient.clients.list.query({ includeArchived: true }),
    trpcClient.projects.list.query(),
  ]);

  for (const tag of data.tags) {
    if (!localStore().remoteIds[tag.id]) {
      const id = matchByName(remoteTags, tag.name) ?? (await trpcClient.tags.create.mutate({ name: tag.name, color: tag.color })).id;
      localStore().setRemoteId(tag.id, id);
    }
    step();
  }

  for (const client of data.clients) {
    if (!localStore().remoteIds[client.id]) {
      const id = matchByName(remoteClients, client.name) ?? (await trpcClient.clients.create.mutate({ name: client.name })).id;
      localStore().setRemoteId(client.id, id);
    }
    step();
  }

  for (const project of data.projects) {
    if (!localStore().remoteIds[project.id]) {
      const clientId = project.clientId ? localStore().remoteIds[project.clientId] ?? null : null;
      const sameClient = remoteProjects.filter(p => (p.clientId ?? null) === clientId);
      const id = matchByName(sameClient, project.name)
        ?? (await trpcClient.projects.create.mutate({ name: project.name, clientId })).id;
      localStore().setRemoteId(project.id, id);
    }
    step();
  }

  // Ældste først, så rækkefølgen i kontoen matcher registreringen.
  const entries = [...data.entries].sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt));
  for (const entry of entries) {
    const ids = localStore().remoteIds;
    let remoteId = ids[entry.id];
    if (!remoteId) {
      remoteId = (await trpcClient.time.create.mutate(toTimeCreateInput(entry, ids))).id;
      localStore().setRemoteId(entry.id, remoteId);
    }
    // Tags er sit eget genoptagelige trin: fejler de efter oprettelsen, prøves de igen næste gang.
    const tagIds = entry.tagIds.map(t => ids[t]).filter((t): t is string => !!t);
    const tagsKey = `${entry.id}#tags`;
    if (tagIds.length && !localStore().remoteIds[tagsKey]) {
      await trpcClient.tags.setForEntry.mutate({ entryId: remoteId, tagIds });
      localStore().setRemoteId(tagsKey, 'done');
    }
    step();
  }

  localStore().clearAll();
  await queryClient.invalidateQueries();
}

export function useLocalImport() {
  const [progress, setProgress] = React.useState<Progress | null>(null);
  const [error, setError] = React.useState<unknown>(null);
  const [running, setRunning] = React.useState(false);

  const start = React.useCallback(async () => {
    setRunning(true);
    setError(null);
    try {
      await runImport(setProgress);
      return true;
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
