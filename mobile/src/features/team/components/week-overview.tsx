import { CalendarRange } from 'lucide-react-native';
import * as React from 'react';
import { View } from 'react-native';
import { Card, EmptyState, Text } from '~/components/ui';
import { SectionState } from '~/features/overview/components/section-state';
import { periodRange } from '~/features/overview/period';
import { trpc } from '~/lib/api';
import { formatHours, toISODate } from '~/lib/format';
import { translate } from '~/lib/i18n';

const DAY_LABELS = ['M', 'T', 'O', 'T', 'F', 'L', 'S'];

/** Timer pr. medlem pr. dag i indeværende uge — kompakt tabel med små bjælker (kun admin). */
export function WeekOverview() {
  const weekStart = toISODate(periodRange('week').from);
  const query = trpc.team.weekOverview.useQuery({ weekStart });
  const members = (query.data?.members ?? []).filter(m => m.totalHours > 0);
  const maxDay = members.reduce((max, m) => Math.max(max, ...m.hoursByDay), 0);

  return (
    <SectionState isLoading={query.isLoading} isError={query.isError} error={query.error} onRetry={() => void query.refetch()} tiles={1}>
      <Card>
        {members.length === 0
          ? <EmptyState icon={CalendarRange} title={translate('team.empty_week')} compact />
          : (
              <View className="gap-3">
                <View className="flex-row items-center">
                  <View className="w-24" />
                  {DAY_LABELS.map((d, i) => (
                    <Text key={`${d}-${i}`} className="flex-1 text-center text-xs text-muted-foreground">{d}</Text>
                  ))}
                  <Text className="w-12 text-right text-xs text-muted-foreground">{translate('team.total')}</Text>
                </View>
                {members.map(m => (
                  <View key={m.userId} className="flex-row items-center">
                    <Text className="w-24 pr-2 text-sm text-foreground" numberOfLines={1}>{m.name}</Text>
                    {m.hoursByDay.map((h, i) => (
                      <View key={i} className="h-6 flex-1 justify-end px-0.5">
                        <View
                          className="rounded-sm bg-primary-500 dark:bg-primary-400"
                          style={{ height: maxDay > 0 ? Math.max(h > 0 ? 3 : 0, (h / maxDay) * 24) : 0 }}
                        />
                      </View>
                    ))}
                    <Text className="w-12 text-right text-sm font-medium text-foreground">{formatHours(m.totalHours, { unit: false })}</Text>
                  </View>
                ))}
              </View>
            )}
      </Card>
    </SectionState>
  );
}
