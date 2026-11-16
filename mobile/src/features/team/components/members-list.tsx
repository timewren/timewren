import type { StatTone } from '~/components/ui';
import type { OrgRole } from '~/features/team/role-logic';
import * as React from 'react';
import { View } from 'react-native';
import { Avatar, Badge, Card, ListRow, SectionHeader } from '~/components/ui';
import { SectionState } from '~/features/overview/components/section-state';
import { roleLabel } from '~/features/team/role-logic';
import { trpc } from '~/lib/api';
import { translate } from '~/lib/i18n';

const ROLE_TONE: Record<OrgRole, StatTone> = {
  owner: 'primary',
  admin: 'primary',
  manager: 'violet',
  member: 'default',
  hr: 'warning',
};

export function RoleBadge({ role }: { role: string }) {
  const tone = ROLE_TONE[role as OrgRole] ?? 'default';
  return <Badge label={roleLabel(role)} tone={tone} />;
}

/** Alle medlemmer i org'en med rolle-badge. */
export function MembersList() {
  const query = trpc.organization.getMembers.useQuery();
  const members = query.data ?? [];
  // Tallet i overskriften kommer fra samme kald som listen under sig, så det
  // skrives kun når kallet har svaret. Ellers siger skærmen "0" for et kald
  // der fejlede — lige over fejlteksten.
  const titel = query.isSuccess ? `${translate('team.members')} (${members.length})` : translate('team.members');

  return (
    <View>
      <SectionHeader title={titel} />
      <SectionState isLoading={query.isLoading} isError={query.isError} error={query.error} onRetry={() => void query.refetch()} tiles={1}>
        <Card className="p-0">
          {members.map((m, i) => (
            <ListRow
              key={m.userId}
              title={m.name}
              subtitle={m.email}
              left={<Avatar name={m.name} image={m.image} size={36} />}
              right={<RoleBadge role={m.role} />}
              last={i === members.length - 1}
            />
          ))}
        </Card>
      </SectionState>
    </View>
  );
}
