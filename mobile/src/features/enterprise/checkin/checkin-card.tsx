import { LogIn, LogOut } from 'lucide-react-native';
import * as React from 'react';
import { View } from 'react-native';
import { Button, Card, ErrorState, Skeleton, Text } from '~/components/ui';
import { formatDuration, formatHours, formatTime } from '~/lib/format';
import { translate } from '~/lib/i18n';
import { useCheckIn } from './use-checkin';

type CheckInCardProps = {
  /** Kaldes af Hjem når enterprise ikke er aktivt — kortet henter så intet. */
  enabled?: boolean;
  className?: string;
};

/**
 * Fuldt check-ind/ud-kort: tilstand, tæller siden check-ind, dagens
 * registrerede timer (netto efter evt. pausefradrag) og knapper.
 * Genbruges af Hjem-fanen og enterprise-siderne.
 */
export function CheckInCard({ enabled = true, className }: CheckInCardProps) {
  const c = useCheckIn({ enabled });

  if (!enabled)
    return null;
  if (c.isLoading) {
    return (
      <Card className={className} testID="checkin-card-loading">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="mt-3 h-8 w-40" />
        <Skeleton className="mt-4 h-10 w-full" />
      </Card>
    );
  }
  if (c.isError || !c.status) {
    return (
      <Card className={className}>
        <ErrorState onRetry={c.refetch} />
      </Card>
    );
  }

  const open = c.open;
  return (
    <Card className={className} testID="checkin-card">
      <View className="flex-row items-center justify-between">
        <Text className="text-xs font-medium text-muted-foreground uppercase" tx="enterprise.checkin.title" />
        {open
          ? (
              <View className="flex-row items-center gap-1.5">
                <View className="size-2 rounded-full bg-success-500" />
                <Text className="text-xs text-muted-foreground">
                  {translate('enterprise.checkin.since', { time: formatTime(open.checkedInAt) })}
                </Text>
              </View>
            )
          : null}
      </View>

      {open
        ? (
            <Text className="mt-2 font-mono text-3xl font-bold text-foreground" testID="checkin-elapsed">
              {formatDuration(c.elapsedSeconds)}
            </Text>
          )
        : (
            <Text className="mt-2 text-lg font-semibold text-foreground" tx="enterprise.checkin.not_checked_in" />
          )}

      <TodaySummary status={c.status} />

      {open
        ? (
            <Button
              variant="destructive"
              label={translate('enterprise.checkin.check_out')}
              onPress={c.checkOut}
              loading={c.isCheckingOut}
              disabled={c.busy}
              testID="checkin-out"
            >
              <ButtonContent icon="out" label={translate('enterprise.checkin.check_out')} loading={c.isCheckingOut} />
            </Button>
          )
        : (
            <Button
              variant="secondary"
              label={translate('enterprise.checkin.check_in')}
              onPress={c.checkIn}
              loading={c.isCheckingIn}
              disabled={c.busy}
              testID="checkin-in"
            >
              <ButtonContent icon="in" label={translate('enterprise.checkin.check_in')} loading={c.isCheckingIn} />
            </Button>
          )}
    </Card>
  );
}

function ButtonContent({ icon, label, loading }: { icon: 'in' | 'out'; label: string; loading: boolean }) {
  const Icon = icon === 'in' ? LogIn : LogOut;
  return (
    <View className="flex-row items-center gap-2">
      <Icon size={18} color="#fff" />
      <Text className="text-base font-semibold text-white">{loading ? '…' : label}</Text>
    </View>
  );
}

function TodaySummary({ status }: { status: NonNullable<ReturnType<typeof useCheckIn>['status']> }) {
  const breakMinutes = Math.round((status.todayBreakDeductedHours ?? 0) * 60);
  return (
    <View className="mt-3 mb-1 flex-row items-end justify-between">
      <View>
        <Text className="text-xs text-muted-foreground" tx="enterprise.checkin.today_hours" />
        <Text className="text-base font-semibold text-foreground" testID="checkin-today-hours">
          {formatHours(status.todayHours)}
        </Text>
      </View>
      <View className="items-end">
        <Text className="text-xs text-muted-foreground">
          {translate('enterprise.checkin.today_sessions', { count: status.todayCount })}
        </Text>
        {breakMinutes > 0
          ? (
              <Text className="text-xs text-muted-foreground">
                {translate('enterprise.checkin.break_deducted', { minutes: breakMinutes })}
              </Text>
            )
          : null}
      </View>
    </View>
  );
}
