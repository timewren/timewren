import type { AbsenceRequest } from '../use-absence';
import * as React from 'react';
import { View } from 'react-native';
import { Avatar } from '~/components/ui/avatar';
import { Badge } from '~/components/ui/badge';
import { ColorDot, ListRow } from '~/components/ui/list-row';
import { Text } from '~/components/ui/text';
import { translate } from '~/lib/i18n';
import { formatWords } from '~/lib/locale';
import { absenceStatusKey, absenceStatusTone, formatDays, requestPeriodText } from '../absence-logic';

function halfDayHint(r: AbsenceRequest): string {
  const parts: string[] = [];
  if (r.halfDayStart)
    parts.push(translate('enterprise.absence.half_day_start_short'));
  if (r.halfDayEnd)
    parts.push(translate('enterprise.absence.half_day_end_short'));
  if (r.hoursPerDay)
    parts.push(`${r.hoursPerDay} ${formatWords().hourUnit}/${formatWords().day}`);
  return parts.length ? ` · ${parts.join(', ')}` : '';
}

type Props = {
  request: AbsenceRequest;
  onPress?: () => void;
  /** Vis medarbejderens avatar (godkendelsesliste) i stedet for typens farveprik */
  showEmployee?: boolean;
  /** Vælg-tilstand (batch): tegner en markering til venstre */
  selected?: boolean;
  onLongPress?: () => void;
  last?: boolean;
  testID?: string;
};

export function AbsenceRequestRow({ request: r, onPress, onLongPress, showEmployee, selected, last, testID }: Props) {
  const title = showEmployee ? (r.user?.name ?? '—') : r.absenceType.name;
  const subtitle = showEmployee
    ? `${r.absenceType.name} · ${requestPeriodText(r)}${halfDayHint(r)}`
    : `${requestPeriodText(r)}${halfDayHint(r)}`;
  const left = showEmployee
    ? <Avatar name={r.user?.name} size={36} className={selected ? 'opacity-40' : ''} />
    : <ColorDot color={r.absenceType.color} size={12} />;
  return (
    <ListRow
      title={title}
      subtitle={subtitle}
      left={left}
      right={(
        <View className="items-end gap-1">
          <Badge label={translate(absenceStatusKey(r.status))} tone={absenceStatusTone(r.status)} />
          {r.totalDays ? <Text className="text-xs text-muted-foreground">{formatDays(r.totalDays)}</Text> : null}
        </View>
      )}
      onPress={onPress}
      onLongPress={onLongPress}
      chevron={false}
      className={selected ? 'bg-primary-50 dark:bg-primary-900' : ''}
      last={last}
      testID={testID}
    />
  );
}
