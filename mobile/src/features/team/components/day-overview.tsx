import { CalendarDays } from 'lucide-react-native';
import * as React from 'react';
import { View } from 'react-native';
import { Avatar, Card, EmptyState, ListRow, Text } from '~/components/ui';
import { SectionState } from '~/features/overview/components/section-state';
import { trpc } from '~/lib/api';
import { formatHours } from '~/lib/format';
import { useToday } from '~/lib/hooks/use-today';
import { translate } from '~/lib/i18n';

/** Timer pr. medlem i dag (kun admin — routeren er orgAdmin). */
export function DayOverview() {
  const date = useToday();
  const query = trpc.team.dayOverview.useQuery({ date });
  const members = (query.data?.members ?? []).filter(m => m.totalHours > 0);
  const total = members.reduce((sum, m) => sum + m.totalHours, 0);

  return (
    <SectionState isLoading={query.isLoading} isError={query.isError} error={query.error} onRetry={() => void query.refetch()} tiles={1}>
      <Card className="p-0">
        {members.length === 0
          ? <EmptyState icon={CalendarDays} title={translate('team.empty_day')} compact />
          : (
              <>
                {members.map(m => (
                  <ListRow
                    key={m.userId}
                    title={m.name}
                    left={<Avatar name={m.name} image={m.image} size={36} />}
                    right={formatHours(m.totalHours)}
                  />
                ))}
                <View className="flex-row items-center justify-between px-4 py-3">
                  <Text className="text-sm font-semibold text-muted-foreground">{translate('team.total')}</Text>
                  <Text className="text-base font-bold text-foreground">{formatHours(total)}</Text>
                </View>
              </>
            )}
      </Card>
    </SectionState>
  );
}
