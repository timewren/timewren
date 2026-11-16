import type { TeamMember } from './team-logic';
import {
  completenessTone,
  countByStatus,
  filterMembers,
  fromMemberList,
  matchesStatus,
  weekActions,
} from './team-logic';

function member(over: Partial<TeamMember>): TeamMember {
  return {
    userId: 'u',
    profileId: null,
    name: 'Anna',
    email: 'anna@x.dk',
    image: null,
    departmentId: null,
    total: 0,
    norm: 37,
    perDay: {},
    absenceByDay: {},
    completeness: 'empty',
    weekStatus: null,
    submittedAt: null,
    rejectionReason: null,
    ...over,
  };
}

describe('team-logic', () => {
  it('matchesStatus: draft dækker kladde/afvist/genåbnet', () => {
    expect(matchesStatus(null, 'draft')).toBe(true);
    expect(matchesStatus('rejected', 'draft')).toBe(true);
    expect(matchesStatus('reopened', 'draft')).toBe(true);
    expect(matchesStatus('submitted', 'draft')).toBe(false);
    expect(matchesStatus('submitted', 'submitted')).toBe(true);
    expect(matchesStatus('approved', 'all')).toBe(true);
  });

  it('filterMembers filtrerer og sorterer', () => {
    const members = [
      member({ userId: '1', name: 'Bo', weekStatus: 'submitted', departmentId: 'd1' }),
      member({ userId: '2', name: 'Anna', weekStatus: 'submitted', departmentId: 'd2' }),
      member({ userId: '3', name: 'Carl', weekStatus: 'approved', departmentId: 'd1' }),
    ];
    expect(filterMembers(members, { status: 'submitted', departmentId: null, query: '' }).map(m => m.name)).toEqual(['Anna', 'Bo']);
    expect(filterMembers(members, { status: 'all', departmentId: 'd1', query: '' }).map(m => m.name)).toEqual(['Bo', 'Carl']);
    expect(filterMembers(members, { status: 'all', departmentId: null, query: 'car' }).map(m => m.name)).toEqual(['Carl']);
  });

  it('countByStatus', () => {
    const members = [
      member({ weekStatus: 'submitted' }),
      member({ weekStatus: 'approved' }),
      member({ weekStatus: 'rejected' }),
      member({ weekStatus: null }),
    ];
    expect(countByStatus(members)).toEqual({ all: 4, submitted: 1, approved: 1, draft: 2 });
  });

  it('fromMemberList: kun aktive med ugestatus, draft → null', () => {
    const list = fromMemberList([
      { id: 'p1', userId: 'u1', isActive: true, weekStatus: 'draft', departmentId: null, submittedAt: null, user: { name: 'A', email: 'a', image: null } },
      { id: 'p2', userId: 'u2', isActive: false, weekStatus: 'submitted', departmentId: null, submittedAt: null, user: { name: 'B', email: 'b', image: null } },
      { id: 'p3', userId: 'u3', isActive: true, weekStatus: null, departmentId: null, submittedAt: null, user: { name: 'C', email: 'c', image: null } },
    ] as any);
    expect(list).toHaveLength(1);
    expect(list[0]!.weekStatus).toBeNull();
    expect(list[0]!.total).toBeNull();
  });

  it('tone og handlinger', () => {
    expect(completenessTone('complete')).toBe('success');
    expect(completenessTone('incomplete')).toBe('warning');
    expect(completenessTone('empty')).toBe('danger');
    expect(completenessTone(null)).toBe('default');
    expect(weekActions('submitted', { isManager: true, isSelf: false })).toEqual({ approve: true, reject: true, reopen: false });
    expect(weekActions('approved', { isManager: true, isSelf: false })).toEqual({ approve: false, reject: false, reopen: true });
    expect(weekActions(null, { isManager: true, isSelf: false })).toEqual({ approve: true, reject: false, reopen: false });
    expect(weekActions('submitted', { isManager: false, isSelf: false })).toEqual({ approve: false, reject: false, reopen: false });
    expect(weekActions('submitted', { isManager: true, isSelf: true })).toEqual({ approve: false, reject: false, reopen: false });
  });
});
