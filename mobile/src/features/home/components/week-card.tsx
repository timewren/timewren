import * as React from 'react';
import { View } from 'react-native';
import { Badge, Card, ErrorState, SectionHeader, Skeleton, Text } from '~/components/ui';
import { trpc } from '~/lib/api';
import { formatHours } from '~/lib/format';
import { translate } from '~/lib/i18n';
import { useReportLoad } from '~/lib/notify';
import { Meter } from './meter';

/** Ugens fremdrift mod brugerens ugemål (`time.weeklyGoalProgress`). */
export function WeekCard() {
  const { data, isLoading, isError, refetch } = trpc.time.weeklyGoalProgress.useQuery();

  useReportLoad({ isLoading, isError }, translate('common.loaded'));

  return (
    <View>
      <SectionHeader title={translate('home.week_title')} />
      <Card testID="week-card">
        {isError
          ? <ErrorState onRetry={refetch} />
          : isLoading || !data
            ? (
                <>
                  <Skeleton className="h-6 w-2/5" />
                  <Skeleton className="mt-3 h-2 w-full" />
                </>
              )
            : (
                <>
                  <View className="flex-row items-end justify-between">
                    <Text className="text-2xl font-bold text-foreground">
                      {translate('home.week_progress', { worked: formatHours(data.hoursWorked), goal: formatHours(data.weeklyGoal) })}
                    </Text>
                    <Badge
                      label={translate(data.isOnTrack ? 'home.week_on_track' : 'home.week_behind')}
                      tone={data.isOnTrack ? 'success' : 'warning'}
                    />
                  </View>
                  <Meter
                    fraction={data.progressPercentage / 100}
                    tone={data.isOnTrack ? 'success' : 'primary'}
                    className="mt-3"
                    a11yLabel={translate('home.week_progress', { worked: formatHours(data.hoursWorked), goal: formatHours(data.weeklyGoal) })}
                  />
                  <Text className="mt-2 text-sm text-muted-foreground">
                    {translate('home.week_remaining', { hours: formatHours(data.hoursRemaining) })}
                  </Text>
                </>
              )}
      </Card>
    </View>
  );
}
