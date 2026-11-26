import type { OrgWithMembers } from './account-deletion-orgs';
import { findSharedOrgs } from './account-deletion-orgs';

const ME = 'u-me';
function org(id: string, members: Array<[string, string]>): OrgWithMembers {
  return {
    id,
    name: `Org ${id}`,
    members: members.map(([userId, role], i) => ({ id: `${id}-m${i}`, userId, role })),
  };
}

describe('findSharedOrgs', () => {
  it('finder delte organisationer uanset brugerens rolle', () => {
    const shared = [
      org('member', [['boss', 'owner'], [ME, 'member']]),
      org('sole-owner', [[ME, 'owner'], ['other', 'member']]),
      org('shared-owner', [[ME, 'owner'], ['other', 'admin,owner']]),
      org('multiple-roles', [[ME, 'admin,owner'], ['other', 'member']]),
    ];
    expect(findSharedOrgs(ME, [
      org('solo', [[ME, 'owner']]),
      org('unrelated', [['boss', 'owner'], ['other', 'member']]),
      ...shared,
    ])).toEqual(shared);
  });
});
