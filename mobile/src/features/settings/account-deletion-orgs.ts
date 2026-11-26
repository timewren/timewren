import { authClient } from '~/lib/auth/client';

type OrgMember = { id: string; userId: string; role: string };
export type OrgWithMembers = { id: string; name: string; members: OrgMember[] };

/** Serveren håndterer medlemskaber og anonymisering som en del af kontosletningen. */
export type OrgStep = { kind: 'transfer' | 'leave'; orgId: string; name: string };

export function findSharedOrgs(userId: string, orgs: OrgWithMembers[]): OrgWithMembers[] {
  return orgs.filter(org => org.members.some(m => m.userId === userId) && org.members.some(m => m.userId !== userId));
}

// better-auth's organization-klient er ikke typet i appen (se organization-screen.tsx), så
// endpoints kaldes direkte via $fetch, samme ruter som web.
async function call<T>(path: string, init?: { query: Record<string, string> }): Promise<T> {
  const { data, error } = await authClient.$fetch<T>(path, init);
  if (error)
    throw new Error(error.message ?? path);
  return data as T;
}

export async function loadOrgsWithMembers(): Promise<OrgWithMembers[]> {
  const orgs = await call<Array<{ id: string; name: string }>>('/organization/list');
  return Promise.all((orgs ?? []).map(async (o) => {
    const full = await call<{ members?: OrgMember[] } | null>('/organization/get-full-organization', { query: { organizationId: o.id } });
    return { id: o.id, name: o.name, members: full?.members ?? [] };
  }));
}
