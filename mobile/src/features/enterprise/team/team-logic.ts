import type { WeekStatus } from '../timesheet/week';
import type { RouterOutputs } from '~/api/app-router';
import type { StatTone } from '~/components/ui/stat-tile';
import { intlLocale } from '~/lib/locale';

export type TeamOverview = RouterOutputs['enterprise']['getTeamWeekOverview'];
export type TeamBalances = RouterOutputs['enterprise']['getTeamWeekBalances'];
export type MemberBalances = TeamBalances['members'][number];
export type ListedMember = RouterOutputs['enterprise']['listMembers'][number];

export type Completeness = 'empty' | 'incomplete' | 'complete';

/** Fælles visningsmodel: fra getTeamWeekOverview (manager) eller listMembers (hr). */
export type TeamMember = {
  userId: string;
  profileId: string | null;
  name: string;
  email: string;
  image: string | null;
  departmentId: string | null;
  /** null når timerne ikke er tilgængelige (hr-fallback) */
  total: number | null;
  norm: number | null;
  perDay: Record<string, number> | null;
  absenceByDay: Record<string, { name: string; color: string }>;
  completeness: Completeness | null;
  weekStatus: WeekStatus;
  submittedAt: Date | string | null;
  rejectionReason: string | null;
};

export type StatusFilter = 'all' | 'submitted' | 'draft' | 'approved';

export function fromOverview(members: TeamOverview['members']): TeamMember[] {
  return members.map(m => ({
    userId: m.userId,
    profileId: null,
    name: m.name,
    email: m.email,
    image: m.image,
    departmentId: m.departmentId,
    total: m.total,
    norm: m.norm,
    perDay: m.perDay,
    absenceByDay: m.absenceByDay,
    completeness: m.completeness,
    weekStatus: (m.weekStatus ?? null) as WeekStatus,
    submittedAt: m.submittedAt,
    rejectionReason: m.rejectionReason,
  }));
}

/** HR-fallback: listMembers giver status/afdeling, men ingen timer. Kun aktive. */
export function fromMemberList(members: ListedMember[]): TeamMember[] {
  return members
    .filter(m => m.isActive && m.weekStatus !== null)
    .map(m => ({
      userId: m.userId,
      profileId: m.id,
      name: m.user?.name ?? 'Ukendt',
      email: m.user?.email ?? '',
      image: m.user?.image ?? null,
      departmentId: m.departmentId,
      total: null,
      norm: null,
      perDay: null,
      absenceByDay: {},
      completeness: null,
      weekStatus: m.weekStatus === 'draft' ? null : (m.weekStatus as WeekStatus),
      submittedAt: m.submittedAt,
      rejectionReason: null,
    }));
}

/** Matcher status-filteret? "draft" dækker kladde, afvist og genåbnet (alt der kan redigeres). */
export function matchesStatus(status: WeekStatus, filter: StatusFilter): boolean {
  switch (filter) {
    case 'all': return true;
    case 'submitted': return status === 'submitted';
    case 'approved': return status === 'approved';
    case 'draft': return status === null || status === 'rejected' || status === 'reopened';
    default: return true;
  }
}

export function filterMembers(
  members: readonly TeamMember[],
  filter: { status: StatusFilter; departmentId: string | null; query: string },
): TeamMember[] {
  const q = filter.query.trim().toLowerCase();
  return members
    .filter(m => matchesStatus(m.weekStatus, filter.status))
    .filter(m => !filter.departmentId || m.departmentId === filter.departmentId)
    .filter(m => q === '' || m.name.toLowerCase().includes(q) || m.email.toLowerCase().includes(q))
    .sort((a, b) => a.name.localeCompare(b.name, intlLocale()));
}

/** Antal pr. filter — til badges i segment-kontrollen. */
export function countByStatus(members: readonly TeamMember[]): Record<StatusFilter, number> {
  const out: Record<StatusFilter, number> = { all: members.length, submitted: 0, draft: 0, approved: 0 };
  for (const m of members) {
    if (matchesStatus(m.weekStatus, 'submitted'))
      out.submitted++;
    else if (matchesStatus(m.weekStatus, 'approved'))
      out.approved++;
    else
      out.draft++;
  }
  return out;
}

export function completenessTone(c: Completeness | null): StatTone {
  switch (c) {
    case 'complete': return 'success';
    case 'incomplete': return 'warning';
    case 'empty': return 'danger';
    default: return 'default';
  }
}

/** Hvilke handlinger må vises for en medarbejders uge (som web's regler). */
export function weekActions(status: WeekStatus, opts: { isManager: boolean; isSelf: boolean }) {
  if (!opts.isManager || opts.isSelf)
    return { approve: false, reject: false, reopen: false };
  return {
    approve: status !== 'approved',
    reject: status === 'submitted',
    reopen: status === 'approved',
  };
}
