import type { OrgWithMembers } from './account-deletion-orgs';
import { planOrgSteps } from './account-deletion-orgs';

const ME = 'u-me';
function org(id: string, members: Array<[string, string]>): OrgWithMembers {
  return {
    id,
    name: `Org ${id}`,
    members: members.map(([userId, role], i) => ({ id: `${id}-m${i}`, userId, role })),
  };
}

describe('planOrgSteps', () => {
  it('rører ikke organisationer, hvor brugeren er alene (serveren sletter dem selv)', () => {
    expect(planOrgSteps(ME, [org('solo', [[ME, 'owner']])])).toEqual([]);
  });

  it('forlader en delt organisation som medlem eller admin (serveren anonymiserer brugeren)', () => {
    expect(planOrgSteps(ME, [
      org('a', [['boss', 'owner'], [ME, 'member']]),
      org('b', [['boss', 'owner'], [ME, 'admin']]),
    ])).toEqual([
      { kind: 'leave', orgId: 'a', name: 'Org a' },
      { kind: 'leave', orgId: 'b', name: 'Org b' },
    ]);
  });

  it('fjerner de øvrige medlemmer, når brugeren er eneste ejer', () => {
    expect(planOrgSteps(ME, [org('t', [[ME, 'owner'], ['x', 'member'], ['y', 'admin']])])).toEqual([
      { kind: 'remove-members', orgId: 't', name: 'Org t', memberIds: ['t-m1', 't-m2'] },
    ]);
  });

  it('forlader organisationen, når der er en anden ejer (også med flere roller i samme felt)', () => {
    expect(planOrgSteps(ME, [org('t', [[ME, 'owner'], ['x', 'admin, owner'], ['y', 'member']])])).toEqual([
      { kind: 'leave', orgId: 't', name: 'Org t' },
    ]);
  });

  it('ser roller i et kommasepareret felt som ejer', () => {
    expect(planOrgSteps(ME, [org('t', [[ME, 'admin,owner'], ['x', 'member']])])[0]?.kind).toBe('remove-members');
  });

  it('springer organisationer over, hvor brugeren ikke står som medlem', () => {
    expect(planOrgSteps(ME, [org('t', [['x', 'owner'], ['y', 'member']])])).toEqual([]);
  });
});
