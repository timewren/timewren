import { Ticket } from 'lucide-react-native';
import * as React from 'react';
import { View } from 'react-native';
import { Badge, Card, EmptyState, ErrorState, ListSkeleton, SectionHeader, Text } from '~/components/ui';
import { trpc } from '~/lib/api';
import { formatHours } from '~/lib/format';
import { translate } from '~/lib/i18n';
import { useReportLoad } from '~/lib/notify';
import { LOW_FRACTION, packageFraction, pickLowest } from '../prepaid-logic';
import { Meter } from './meter';

export function PrepaidCard() {
  const { data, isLoading, isError, refetch } = trpc.prepaid.list.useQuery({ activeOnly: true });
  const packages = React.useMemo(() => pickLowest(data ?? []), [data]);

  useReportLoad({ isLoading, isError }, translate('common.loaded'));

  return (
    <View>
      <SectionHeader title={translate('home.klippekort_title')} />
      {isLoading
        ? <ListSkeleton rows={2} />
        : isError
          ? <Card className="p-0"><ErrorState onRetry={refetch} /></Card>
          : packages.length === 0
            ? (
                <Card className="p-0">
                  <EmptyState compact icon={Ticket} title={translate('home.klippekort_empty')} />
                </Card>
              )
            : (
                <View className="gap-3">
                  {packages.map((pkg) => {
                    const fraction = packageFraction(pkg);
                    const low = fraction < LOW_FRACTION;
                    return (
                      <Card key={pkg.id} testID={`prepaid-${pkg.id}`}>
                        <View className="flex-row items-center justify-between gap-2">
                          <View className="flex-1">
                            <Text className="text-base font-semibold text-foreground" numberOfLines={1}>
                              {pkg.client?.name ?? pkg.name}
                            </Text>
                            {pkg.client?.name && pkg.name
                              ? <Text className="text-sm text-muted-foreground" numberOfLines={1}>{pkg.name}</Text>
                              : null}
                          </View>
                          {low ? <Badge label={translate('home.klippekort_low')} tone="warning" /> : null}
                        </View>
                        <Meter
                          fraction={fraction}
                          tone={low ? 'warning' : 'violet'}
                          className="mt-3"
                          a11yLabel={translate('home.klippekort_remaining', {
                            remaining: formatHours(pkg.remainingHours),
                            total: formatHours(pkg.totalHours),
                          })}
                        />
                        <Text className="mt-2 text-sm text-violet-700 dark:text-violet-300">
                          {translate('home.klippekort_remaining', {
                            remaining: formatHours(pkg.remainingHours),
                            total: formatHours(pkg.totalHours),
                          })}
                        </Text>
                      </Card>
                    );
                  })}
                </View>
              )}
    </View>
  );
}
