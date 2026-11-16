import { Clock, LogIn, LogOut } from 'lucide-react-native';
import * as React from 'react';
import { View } from 'react-native';
import { Button, Card, ErrorState, SectionHeader, Skeleton, StatTile, Text } from '~/components/ui';
import { useCheckIn } from '~/features/enterprise/checkin/use-checkin';
import { trpc } from '~/lib/api';
import { formatDuration, formatHours, formatTime } from '~/lib/format';
import { translate } from '~/lib/i18n';
import { useReportLoad } from '~/lib/notify';

/**
 * Enterprise: check-ind/ud (fremmøde) + flexsaldo. Kun når `isEnterprise`.
 * Deler tilstand, polling og toasts med enterprise-siderne via `useCheckIn`.
 */
export function EnterpriseCard() {
  const c = useCheckIn();
  const flex = trpc.enterprise.getBalance.useQuery();
  const open = c.open;
  const toggle = () => (open ? c.checkOut() : c.checkIn());

  useReportLoad(c, translate('common.loaded'));

  return (
    <View>
      <SectionHeader title={translate('home.enterprise_title')} />
      <View className="flex-row gap-3">
        <Card className="flex-1" testID="checkin-card">
          {c.isError
            ? <ErrorState onRetry={c.refetch} />
            : c.isLoading
              ? (
                  <>
                    <Skeleton className="h-4 w-3/4" />
                    <Skeleton className="mt-3 h-10 w-full" />
                  </>
                )
              : (
                  <>
                    <View className="flex-row items-center gap-2">
                      <View className={`size-2.5 rounded-full ${open ? 'bg-success-500' : 'bg-neutral-300 dark:bg-neutral-600'}`} />
                      <Text className="flex-1 text-sm text-foreground" numberOfLines={1}>
                        {open
                          ? translate('home.checked_in_since', { time: formatTime(open.checkedInAt) })
                          : translate('home.not_checked_in')}
                      </Text>
                    </View>
                    {open
                      ? (
                          <Text className="mt-1 font-mono text-2xl font-bold tracking-tight text-foreground" testID="checkin-elapsed">
                            {formatDuration(c.elapsedSeconds)}
                          </Text>
                        )
                      : null}
                    <Text className="mt-1 text-xs text-muted-foreground">
                      {translate('home.presence_today', { hours: formatHours(c.status?.todayHours ?? 0) })}
                    </Text>
                    <Button
                      onPress={toggle}
                      loading={c.busy}
                      variant={open ? 'destructive' : 'default'}
                      className="mt-3 mb-0 h-10"
                      testID="checkin-toggle"
                    >
                      {open ? <LogOut size={16} color="#fff" /> : <LogIn size={16} color="#fff" />}
                      <Text className="ml-2 text-sm font-semibold text-white">
                        {translate(open ? 'home.check_out' : 'home.check_in')}
                      </Text>
                    </Button>
                  </>
                )}
        </Card>
        <StatTile
          label={translate('home.flex')}
          value={formatHours(flex.data?.balance ?? 0)}
          loading={flex.isLoading}
          error={flex.isError}
          hint={translate('home.flex_hint')}
          icon={Clock}
          tone={(flex.data?.balance ?? 0) < 0 ? 'warning' : 'success'}
          className="max-w-[45%]"
          testID="flex-balance"
        />
      </View>
    </View>
  );
}
