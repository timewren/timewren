import type { MemberRate, RateChange } from './project-health-logic';
import { ArrowDown, ArrowUp } from 'lucide-react-native';
import { View } from 'react-native';
import { useUniwind } from 'uniwind';
import {
  Card,
  colors,
  ErrorState,
  ListRow,
  SectionHeader,
  Skeleton,
  Text,
} from '~/components/ui';
import { useCapabilities } from '~/features/capabilities/use-capabilities';
import { trpc } from '~/lib/api';
import { translate } from '~/lib/i18n';
import { useReportLoad } from '~/lib/notify';
import {
  hasRateHistory,
  memberRate,
  memberRateText,
  rateChangeText,
  rateDirection,
  rateEffectiveDate,
} from './project-health-logic';

/**
 * Prisændringer og timesatser på ét projekt.
 *
 * Begge kald er projektsbundne. `rateHistory.getHistory` er
 * `protectedProcedure` og prisen er én og fælles for projektet, så alle i
 * org'en må se den. `memberRates.listForProject` er `orgAdminProcedure` —
 * satsen er løn-data, så vejen skjudes OG kaldet slås fra for en almindelig
 * medarbejder, ellers ville et dybt link give en rå 403.
 *
 * Begge sektioner melder deres kald, så de er en del af skærmens ene stop i
 * stedet for at være to stille kort der materialiserer sig. Og begge har en
 * `ErrorState`: uden den viste en fejlet pris historie "ingen prisændringer",
 * som er en påstand om at der aldrig har været nogen.
 */
export function ProjectRates({ projectId }: { projectId: string }) {
  const caps = useCapabilities();
  const canSeeRates = caps.hasOrg && caps.isAdmin;
  const history = trpc.rateHistory.getHistory.useQuery({ projectId }, { enabled: !!projectId });
  const members = trpc.memberRates.listForProject.useQuery({ projectId }, { enabled: canSeeRates && !!projectId });

  useReportLoad(history, translate('common.loaded'));
  useReportLoad(members, translate('common.loaded'));

  return (
    <View className="mt-2">
      <RateHistorySection data={history.data} isLoading={history.isLoading} isError={history.isError} onRetry={history.refetch} />
      {canSeeRates
        ? <MemberRatesSection data={members.data} isLoading={members.isLoading} isError={members.isError} onRetry={members.refetch} />
        : null}
    </View>
  );
}

type SectionProps<T> = {
  data: T | undefined;
  isLoading: boolean;
  isError: boolean;
  onRetry: () => unknown;
};

function RateHistorySection({ data, isLoading, isError, onRetry }: SectionProps<RateChange[]>) {
  if (isLoading)
    return <Skeleton className="h-28" />;
  if (isError) {
    return (
      <View className="mt-6">
        <SectionHeader title={translate('projects.rate_history_title')} />
        <Card>
          <ErrorState onRetry={() => void onRetry()} />
        </Card>
      </View>
    );
  }
  if (!hasRateHistory(data)) {
    return (
      <View className="mt-6">
        <SectionHeader title={translate('projects.rate_history_title')} />
        <Card>
          <Text className="text-[13px] text-muted-foreground" tx="projects.rate_history_empty" />
        </Card>
      </View>
    );
  }

  // En række uden læselig dato er støj i en liste hvor alle andre har en, så
  // den springes over i stedet for at vise en tankestegn.
  const changes = (data ?? []).filter(change => rateEffectiveDate(change) !== null);
  return (
    <View className="mt-6">
      <SectionHeader title={translate('projects.rate_history_title')} />
      <Card className="p-0" testID="project-rate-history">
        {changes.map((change, index) => (
          <RateRow key={change.id} change={change} last={index === changes.length - 1} />
        ))}
      </Card>
    </View>
  );
}

function RateRow({ change, last }: { change: RateChange; last: boolean }) {
  const { theme } = useUniwind();
  const date = rateEffectiveDate(change);
  const direction = rateDirection(change);
  const shade = theme === 'dark' ? 400 : 600;
  const right = direction === 'up'
    ? <ArrowUp size={16} color={colors.success[shade]} />
    : direction === 'down' ? <ArrowDown size={16} color={colors.danger[shade]} /> : undefined;
  return (
    <ListRow
      title={rateChangeText(change)}
      subtitle={date ?? undefined}
      right={right}
      last={last}
      testID={`project-rate-${change.id}`}
    />
  );
}

function MemberRatesSection({ data, isLoading, isError, onRetry }: SectionProps<MemberRate[]>) {
  if (isLoading)
    return <Skeleton className="h-40" />;
  if (isError) {
    return (
      <View className="mt-6">
        <SectionHeader title={translate('projects.member_rates_title')} />
        <Card>
          <ErrorState onRetry={() => void onRetry()} />
        </Card>
      </View>
    );
  }
  const rows = data ?? [];
  if (rows.length === 0)
    return null;

  return (
    <View className="mt-6">
      <SectionHeader title={translate('projects.member_rates_title')} />
      <Card className="p-0" testID="project-member-rates">
        {rows.map((row, index) => (
          <MemberRateRow key={row.memberId} row={row} last={index === rows.length - 1} />
        ))}
      </Card>
      <Text className="mt-2 text-[12px] text-muted-foreground" tx="projects.member_rates_hint" />
    </View>
  );
}

function MemberRateRow({ row, last }: { row: MemberRate; last: boolean }) {
  const { inherited } = memberRate(row);
  return (
    <ListRow
      title={row.userName}
      subtitle={inherited ? translate('projects.rate_inherited') : undefined}
      right={memberRateText(row)}
      last={last}
      testID={`project-member-rate-${row.memberId}`}
    />
  );
}
