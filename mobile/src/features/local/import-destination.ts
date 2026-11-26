import type { ImportDestination } from './local-store';
import { randomUUID } from 'expo-crypto';
import { getApiUrl } from '~/features/server/server-config';
import { createSessionTRPCClient, isTRPCClientError } from '~/lib/api/trpc';
import { getSessionCookie } from '~/lib/auth/client';
import { translate } from '~/lib/i18n';
import { localStore } from './local-store';

export function destinationChanged() {
  return new Error(translate('local.import.destination_changed'));
}

function sameDestination(a: ImportDestination, b: ImportDestination) {
  return a.server === b.server && a.userId === b.userId && a.orgId === b.orgId;
}

async function verifyOrgOverride(cookie: string) {
  // A server that ignores the header resolves this read in the active org.
  // A compatible server rejects it because the user has no such membership.
  try {
    await createSessionTRPCClient(cookie, randomUUID()).mobile.getCapabilities.query();
  }
  catch (error) {
    if (isTRPCClientError(error) && error.data?.code === 'FORBIDDEN')
      return;
    throw error;
  }
  throw new Error(translate('local.import.unsupported_server'));
}

export async function openImportDestination() {
  const { importDestination: saved, remoteIds } = localStore();
  if (!saved && Object.keys(remoteIds).length)
    throw new Error(translate('local.import.legacy_journal'));

  const server = getApiUrl();
  if (saved && saved.server !== server)
    throw destinationChanged();

  const cookie = await getSessionCookie();
  if (!cookie)
    throw destinationChanged();

  // Resolve the effective organization using the same middleware as the import.
  const active = createSessionTRPCClient(cookie);
  const [profile, caps] = await Promise.all([
    active.user.getProfile.query(),
    active.mobile.getCapabilities.query(),
  ]);
  if (!profile?.id || !caps.org?.id || cookie !== await getSessionCookie())
    throw destinationChanged();

  const destination = { server, userId: profile.id, orgId: caps.org.id };
  if (localStore().importDestination !== saved || (saved && !sameDestination(saved, destination)))
    throw destinationChanged();
  await verifyOrgOverride(cookie);
  if (cookie !== await getSessionCookie() || getApiUrl() !== server || localStore().importDestination !== saved)
    throw destinationChanged();
  if (!saved)
    localStore().bindImport(destination);

  const client = createSessionTRPCClient(cookie, destination.orgId);
  async function checkSession() {
    const currentCookie = await getSessionCookie();
    if (currentCookie !== cookie || getApiUrl() !== server || localStore().importDestination !== (saved ?? destination))
      throw destinationChanged();
  }

  async function check() {
    await checkSession();
    const current = await active.mobile.getCapabilities.query();
    if (current.org?.id !== destination.orgId)
      throw destinationChanged();
    await checkSession();
  }

  // The scoped client pins in-flight requests even if the active org changes
  // after the check. Verify again before recording the result or clearing data.
  async function call<T>(request: () => Promise<T>) {
    await check();
    const result = await request();
    await check();
    return result;
  }

  return { client, call, check, orgId: destination.orgId };
}
