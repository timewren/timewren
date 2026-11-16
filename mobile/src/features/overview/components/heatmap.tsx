import type { HeatCell } from '../heatmap';

import * as React from 'react';
import { View } from 'react-native';
import { twMerge } from 'tailwind-merge';
import { Card, SectionHeader, Text } from '~/components/ui';
import { trpc } from '~/lib/api';
import { formatHours } from '~/lib/format';
import { translate } from '~/lib/i18n';
import { buildHeatmapWeeks, HEAT_CLASS, heatWeekDaysKey, heatWeekSummary } from '../heatmap';
import { SectionState } from './section-state';

const DAYS = [['man', 'M'], ['tir', 'T'], ['ons', 'O'], ['tor', 'T'], ['fre', 'F'], ['lør', 'L'], ['søn', 'S']] as const;

/** Ét stop pr. uge: datoerne, hvor mange dage der er arbejdet, og hvor mange timer. */
function weekLabel(week: readonly HeatCell[]): string {
  const { days, hours, range } = heatWeekSummary(week);
  const spoken = days === 0
    ? [translate('overview.heatmap_week_empty')]
    : [translate(heatWeekDaysKey(days), { count: days }), formatHours(hours)];
  return [range, ...spoken].filter(Boolean).join(', ');
}

/** 7×5 gitter over de sidste fem uger — farvede celler, ingen chart-bibliotek. */
export function Heatmap() {
  const query = trpc.time.productivityHeatmap.useQuery();
  const weeks = React.useMemo(
    () => buildHeatmapWeeks(query.data?.heatmapData ?? []),
    [query.data],
  );

  return (
    <View>
      <SectionHeader title={translate('overview.heatmap')} />
      <SectionState isLoading={query.isLoading} isError={query.isError} error={query.error} onRetry={() => void query.refetch()} tiles={1}>
        <Card>
          <View
            accessible
            accessibilityLabel={translate('overview.heatmap_axis')}
            className="flex-row gap-1.5"
            testID="heatmap-axis"
          >
            <View
              className="flex-row gap-1.5"
              importantForAccessibility="no-hide-descendants"
              accessibilityElementsHidden
              testID="heatmap-axis-indhold"
            >
              {DAYS.map(([key, label]) => (
                <Text key={key} className="flex-1 text-center text-xs text-muted-foreground">{label}</Text>
              ))}
            </View>
          </View>
          <View className="mt-1.5 gap-1.5" testID="overview-heatmap">
            {weeks.map(week => (
              <View
                key={week[0]?.date}
                testID={`heatmap-week-${week[0]?.date}`}
                accessible
                accessibilityLabel={weekLabel(week)}
              >
                <View
                  className="flex-row gap-1.5"
                  importantForAccessibility="no-hide-descendants"
                  accessibilityElementsHidden
                >
                  {week.map(cell => (
                    <View
                      key={cell.date}
                      testID={`heatmap-cell-${cell.date}`}
                      accessible={false}
                      className={twMerge(
                        'aspect-square flex-1 rounded-md',
                        HEAT_CLASS[cell.level],
                        cell.isFuture ? 'opacity-30' : '',
                      )}
                    />
                  ))}
                </View>
              </View>
            ))}
          </View>
          <Text className="mt-3 text-xs text-muted-foreground">
            {translate('overview.heatmap_streak', {
              count: query.data?.currentStreak ?? 0,
              avg: formatHours(query.data?.weeklyAverage ?? 0),
            })}
          </Text>
        </Card>
      </SectionState>
    </View>
  );
}
