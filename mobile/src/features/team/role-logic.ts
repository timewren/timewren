import { translate } from '~/lib/i18n';

export type OrgRole = 'owner' | 'admin' | 'manager' | 'member' | 'hr';

const ROLES: OrgRole[] = ['owner', 'admin', 'manager', 'member', 'hr'];

/** Dansk navn på en rolle. Ukendte roller læses som "Medarbejder". */
export function roleLabel(role: string): string {
  const key = ROLES.includes(role as OrgRole) ? role as OrgRole : 'member';
  return translate(`team.role.${key}`);
}
