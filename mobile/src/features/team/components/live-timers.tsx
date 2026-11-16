import { useIsFocused } from '@react-navigation/native';
import { Radio } from 'lucide-react-native';
import * as React from 'react';
import { View } from 'react-native';
import { Avatar, Badge, Card, EmptyState, ErrorState, ListRow, ListSkeleton, SectionHeader } from '~/components/ui';
import { errorMessage, trpc } from '~/lib/api';
import { formatDuration, formatTime } from '~/lib/format';
import { translate } from '~/lib/i18n';
import { useReportLoad } from '~/lib/notify';
import { runningSeconds } from '../running-seconds';

const REFRESH_MS = 30_000;

/** Kørende timere i org'en. Refetcher hvert 30 s mens fanen er aktiv; tæller selv sekunderne op. */
export function LiveTimers() {
  const focused = useIsFocused();
  const query = trpc.team.liveTimers.useQuery(undefined, {
    refetchInterval: focused ? REFRESH_MS : false,
  });
  const running = React.useMemo(() => (query.data ?? []).filter(t => t.isRunning), [query.data]);
  const now = useTicker(running.length > 0 && focused);

  useReportLoad({ isLoading: query.isLoading, isError: query.isError }, translate('common.loaded'));

  return (
    <View>
      <SectionHeader title={translate('team.live')} className="mt-0" />
      <Card className="p-0">
        {query.isLoading
          ? <ListSkeleton rows={2} />
          : query.isError
            ? <ErrorState message={errorMessage(query.error)} onRetry={() => void query.refetch()} />
            : running.length === 0
              ? <EmptyState icon={Radio} title={translate('team.live_empty')} compact />
              : running.map((t, i) => (
                  <ListRow
                    key={t.userId}
                    title={t.userName}
                    subtitle={[t.clientName, t.projectName, t.description].filter(Boolean).join(' · ') || translate('team.running_since', { time: t.startTime ? formatTime(t.startTime) : '–' })}
                    left={<Avatar name={t.userName} size={36} />}
                    right={<Badge label={formatDuration(runningSeconds(t, now))} tone="success" />}
                    last={i === running.length - 1}
                    testID={`live-timer-${t.userId}`}
                  />
                ))}
      </Card>
    </View>
  );
}

/** Giver `Date.now()` hvert sekund mens `active` er sand. */
function useTicker(active: boolean): number {
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    if (!active)
      return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active]);
  return now;
}
