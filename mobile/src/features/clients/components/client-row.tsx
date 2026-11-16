import type { ClientListItem } from '../client-logic';
import * as React from 'react';
import { ColorDot, ListRow } from '~/components/ui';
import { formatHours } from '~/lib/format';
import { translate } from '~/lib/i18n';

type Props = {
  client: ClientListItem & { color?: string | null };
  onPress: () => void;
  last?: boolean;
};

function subtitleFor(client: ClientListItem): string {
  const count = client.stats.projectCount;
  const projects = count === 1
    ? translate('clients.project_count_one', { count })
    : translate('clients.project_count_other', { count });
  const parts = [formatHours(client.stats.totalHours), projects];
  if (client.stats.unbilledHours > 0)
    parts.push(translate('clients.unbilled_hours', { hours: formatHours(client.stats.unbilledHours) }));
  return parts.join(' · ');
}

export function ClientRow({ client, onPress, last }: Props) {
  return (
    <ListRow
      title={client.name}
      subtitle={subtitleFor(client)}
      left={<ColorDot color={client.color} size={12} />}
      onPress={onPress}
      last={last}
      testID={`client-row-${client.id}`}
    />
  );
}
