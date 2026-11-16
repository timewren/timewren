import { localStore } from '~/features/local/local-store';

export type ServerChange = {
  current: string;
  next: string;
  blocked: () => boolean;
  probe: (url: string) => Promise<string>;
  signOut: () => Promise<void>;
  save: (url: string) => Promise<void>;
  restart: () => Promise<void>;
};

export async function changeServer(deps: ServerChange): Promise<void> {
  if (deps.current === deps.next) {
    await deps.probe(deps.next);
    return;
  }
  if (deps.blocked() || Object.keys(localStore().remoteIds).length > 0)
    throw new Error('pending');
  const url = await deps.probe(deps.next);
  if (deps.blocked() || Object.keys(localStore().remoteIds).length > 0)
    throw new Error('pending');
  try {
    await deps.signOut();
    await deps.save(url);
  }
  catch {
    throw new Error('storage');
  }
  try {
    await deps.restart();
  }
  catch {
    throw new Error('restart');
  }
}
