import { authClient } from '~/lib/auth/client';

type OrgMember = { id: string; userId: string; role: string };
export type OrgWithMembers = { id: string; name: string; members: OrgMember[] };

/**
 * Hvad der sker med en organisation, brugeren deler med andre, når kontoen slettes:
 * - remove-members: brugeren er eneste ejer. Serveren afviser at slette eneste ejer af et team
 *   (owner_must_transfer), så appen fjerner de øvrige medlemmer, og serveren sletter derefter
 *   organisationen sammen med kontoen.
 * - leave: brugeren er medlem, admin eller en af flere ejere. Serveren forlader selv teamet og
 *   anonymiserer brugeren, så teamets registreringer bevares uden navn (web #918). Appen gør
 *   intet; forlad ikke organisationen selv først.
 */
export type OrgStep
  = | { kind: 'remove-members'; orgId: string; name: string; memberIds: string[] }
    | { kind: 'leave'; orgId: string; name: string };

const isOwner = (m: OrgMember) => m.role.split(',').map(r => r.trim()).includes('owner');

export function planOrgSteps(userId: string, orgs: OrgWithMembers[]): OrgStep[] {
  const steps: OrgStep[] = [];
  for (const org of orgs) {
    const me = org.members.find(m => m.userId === userId);
    const others = org.members.filter(m => m.userId !== userId);
    if (!me || others.length === 0)
      continue;
    if (isOwner(me) && !others.some(isOwner))
      steps.push({ kind: 'remove-members', orgId: org.id, name: org.name, memberIds: others.map(m => m.id) });
    else
      steps.push({ kind: 'leave', orgId: org.id, name: org.name });
  }
  return steps;
}

// better-auth's organization-klient er ikke typet i appen (se organization-screen.tsx), så
// endpoints kaldes direkte via $fetch, samme ruter som web.
async function call<T>(path: string, init?: { method: 'POST'; body: Record<string, unknown> } | { query: Record<string, string> }): Promise<T> {
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

/** Fjerner de øvrige medlemmer, hvor brugeren er eneste ejer. leave-trin klarer serveren. */
export async function runOrgSteps(steps: OrgStep[]): Promise<void> {
  for (const step of steps) {
    if (step.kind !== 'remove-members')
      continue;
    for (const memberId of step.memberIds)
      await call('/organization/remove-member', { method: 'POST', body: { memberIdOrEmail: memberId, organizationId: step.orgId } });
  }
}
