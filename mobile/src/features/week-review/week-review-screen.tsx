import type { WeekDay } from './week-review-logic';
import type { RouterOutputs } from '~/api/app-router';
import { useRouter } from 'expo-router';
import { CalendarCheck, Flame, Sparkles } from 'lucide-react-native';
import * as React from 'react';
import { Alert, View } from 'react-native';
import { twMerge } from 'tailwind-merge';
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  ListSkeleton,
  Screen,
  SectionHeader,
  StatTile,
  Text,
} from '~/components/ui';
import { useCapabilities } from '~/features/capabilities/use-capabilities';
import { errorMessage, trpc } from '~/lib/api';
import { formatDateShort, formatHours, formatMoney } from '~/lib/format';
import { translate } from '~/lib/i18n';
import { showMessage, useAnnounceLoaded } from '~/lib/notify';
import { bonusCaptionKey, bonusTone, isBonusRelevant, roundedAmount } from './rounding-bonus';
import {
  barFraction,
  currentWeekStart,
  dailyGoal,
  dayLabel,
  dayReference,
  sumHours,
  thinDays,
  weekFraction,
  weekRangeLabel,
} from './week-review-logic';

type WeekReview = RouterOutputs['time']['getWeekReview'];

/** Samme palet som `StatTile`, men et afrundingsbeløb er ikke et nøgletal-kort. */
const BONUS_TONE: Record<'success' | 'danger' | 'default', string> = {
  success: 'text-success-600 dark:text-success-400',
  danger: 'text-danger-600 dark:text-danger-400',
  default: 'text-foreground',
};

export function WeekReviewScreen() {
  const [weekStart, setWeekStart] = React.useState(() => currentWeekStart());
  const utils = trpc.useUtils();
  const query = trpc.time.getWeekReview.useQuery({ weekStart });
  const close = trpc.time.closeWeek.useMutation({
    onSuccess: () => {
      // `closeWeek` svarer `{ success: true }` også når kaldet var en no-op
      // (ON CONFLICT DO NOTHING), så svaret er IKKE bevis på en ny lukning.
      // Vi genindlæser og lader serverens `isClosed` afgøre, hvad der vises.
      void utils.time.getWeekReview.invalidate();
      showMessage({ message: translate('week_review.closed_ok'), type: 'success' });
    },
    onError: error => showMessage({ message: errorMessage(error), type: 'danger' }),
  });

  // Ugen kan rulle over mens appen er åben. Nøglen på `weekStart` følger den
  // nye uge, så forrige uges timer aldrig hænger ved som cache.
  const refresh = React.useCallback(() => {
    const next = currentWeekStart();
    setWeekStart(prev => (prev === next ? prev : next));
    void query.refetch();
  }, [query]);

  const confirmClose = React.useCallback(() => {
    const week = query.data?.weekStart;
    if (!week)
      return;
    Alert.alert(translate('week_review.close_confirm_title'), translate('week_review.close_confirm_body'), [
      { text: translate('week_review.cancel'), style: 'cancel' },
      { text: translate('week_review.close'), onPress: () => close.mutate({ weekStart: week }) },
    ]);
  }, [close, query.data]);

  useAnnounceLoaded(query, translate('common.loaded'));

  const data = query.data;
  const body = query.isLoading && !data
    ? <ListSkeleton rows={3} />
    : !data
        ? <ErrorState message={errorMessage(query.error)} onRetry={refresh} />
        : <Body review={data} pending={close.isPending} onClose={confirmClose} />;

  return (
    <Screen
      title={translate('week_review.title')}
      subtitle={data ? weekRangeLabel(data.weekStart) : undefined}
      back
      refreshing={query.isRefetching}
      onRefresh={refresh}
    >
      {body}
    </Screen>
  );
}

function Body({ review, pending, onClose }: { review: WeekReview; pending: boolean; onClose: () => void }) {
  const router = useRouter();
  const goal = dailyGoal(review.weeklyGoal);
  // Vi summerer de dage, der vises, frem for at bruge serverens `totalHours`:
  // serverens dags-spredning er ikke DST-sikker, så en søndag i en
  // overgangssuge kan mangle. Bjælkerne skal passe med det tal, der står.
  const total = sumHours(review.days);
  return (
    <>
      {review.streak > 0
        ? (
            <Card className="mb-3 flex-row items-center gap-2" testID="week-review-streak">
              <Flame size={18} color="#ea580c" />
              <Text className="flex-1 text-sm text-foreground">{translate(review.streak === 1 ? 'week_review.streak_one' : 'week_review.streak_other', { count: review.streak })}</Text>
            </Card>
          )
        : null}
      <View className="flex-row gap-3">
        <StatTile
          label={translate('week_review.total')}
          value={formatHours(total)}
          hint={goal ? translate('week_review.of_goal', { goal: formatHours(goal) }) : undefined}
          tone="primary"
        />
        <StatTile label={translate('week_review.daily_goal')} value={goal ? formatHours(goal) : translate('week_review.not_set')} />
      </View>
      <View className="mt-3 flex-row gap-3">
        <StatTile label={translate('week_review.unbilled_hours')} value={formatHours(review.unbilledHours)} />
        <StatTile
          label={translate('week_review.unbilled_value')}
          value={formatMoney(review.unbilledValue)}
          tone={review.unbilledValue > 0 ? 'warning' : 'default'}
        />
      </View>
      {goal ? <WeekProgress total={total} goal={review.weeklyGoal ?? 0} /> : <NoGoalCard />}
      <BonusRow />
      {total > 0
        ? <DaySection days={review.days} reference={dayReference(review.weeklyGoal, review.days)} />
        : (
            <EmptyState
              icon={CalendarCheck}
              title={translate('week_review.empty_title')}
              description={translate('week_review.empty_body')}
              action={{ label: translate('week_review.register_time'), onPress: () => router.push('/time'), testID: 'week-review-empty-action' }}
              compact
            />
          )}
      <CloseSection review={review} pending={pending} onClose={onClose} />
    </>
  );
}

/**
 * Hvad tidsrundingen har været værd — måned og år, som web's widget.
 *
 * Kun uden organisation. `time.getRoundingBonus` summerer i en org ALLE
 * medlemmers fakturerbare poster og bruger kun den kaldendes egen
 * afrundingsindstilling, så tallet er ikke den enkeltes bonus: det ville stå
 * som kollegas timer i hans egen uge. Se `docs/api-behov.md`.
 */
function BonusRow() {
  const caps = useCapabilities();
  const solo = !caps.hasOrg;
  const query = trpc.time.getRoundingBonus.useQuery(undefined, { enabled: solo });
  const month = roundedAmount(query.data?.thisMonth);
  const year = roundedAmount(query.data?.thisYear);
  if (!solo || query.isError || !isBonusRelevant(query.data))
    return null;
  const tone = bonusTone(month);
  const caption = translate(bonusCaptionKey(month));
  const label = [
    translate('week_review.bonus'),
    `${formatMoney(month)} ${translate('week_review.bonus_month')}`,
    caption,
    `${translate('week_review.bonus_year')}: ${formatMoney(year)}`,
  ].join('. ');
  return (
    <Card className="mt-3" accessible accessibilityLabel={label} testID="week-review-bonus">
      <Text className="text-sm font-medium text-foreground" tx="week_review.bonus" />
      <View className="mt-1 flex-row items-baseline gap-2">
        <Text className={twMerge('text-2xl font-semibold tracking-tight', BONUS_TONE[tone])} style={{ fontVariant: ['tabular-nums'] }}>
          {formatMoney(month)}
        </Text>
        <Text className="text-sm text-muted-foreground" tx="week_review.bonus_month" />
      </View>
      <Text className="mt-0.5 text-xs text-muted-foreground">{caption}</Text>
      <View className="mt-2 flex-row items-center justify-between border-t border-border pt-2">
        <Text className="text-sm text-muted-foreground" tx="week_review.bonus_year" />
        <Text className="text-sm font-medium text-foreground" style={{ fontVariant: ['tabular-nums'] }}>{formatMoney(year)}</Text>
      </View>
    </Card>
  );
}

function WeekProgress({ total, goal }: { total: number; goal: number }) {
  const pct = Math.round(weekFraction(total, goal) * 100);
  return (
    <View className="mt-4">
      <View className="mb-1 flex-row items-center justify-between">
        <Text className="text-sm text-muted-foreground" tx="week_review.progress" />
        <Text className="text-sm font-medium text-foreground">{formatHours(goal)}</Text>
      </View>
      <View
        className="h-2 overflow-hidden rounded-full bg-muted"
        accessibilityRole="progressbar"
        accessibilityValue={{ min: 0, max: 100, now: pct }}
        testID="week-review-progress"
      >
        <View className="h-2 rounded-full bg-primary-600" style={{ width: `${pct}%` }} />
      </View>
    </View>
  );
}

function NoGoalCard() {
  const router = useRouter();
  return (
    <Card
      className="mt-3"
      onPress={() => router.push('/settings/profile')}
      testID="week-review-no-goal"
      a11yLabel={`${translate('week_review.no_goal_title')}. ${translate('week_review.no_goal_body')}`}
    >
      <Text className="text-sm font-medium text-foreground" tx="week_review.no_goal_title" />
      <Text className="mt-1 text-sm text-muted-foreground" tx="week_review.no_goal_body" />
    </Card>
  );
}

function DaySection({ days, reference }: { days: WeekDay[]; reference: number }) {
  const router = useRouter();
  const thin = thinDays(days);
  return (
    <>
      <SectionHeader title={translate('week_review.days')} />
      <Card className="gap-3">
        {days.map(d => <DayRow key={d.date} day={d} reference={reference} />)}
      </Card>
      {thin.length > 0
        ? (
            <Card
              className="mt-3 flex-row items-center gap-2"
              onPress={() => router.push('/time')}
              testID="week-review-thin"
              a11yLabel={translate(thin.length === 1 ? 'week_review.thin_days_one' : 'week_review.thin_days_other', { count: thin.length })}
            >
              <Sparkles size={18} color="#d97706" />
              <Text className="flex-1 text-sm text-foreground">{translate(thin.length === 1 ? 'week_review.thin_days_one' : 'week_review.thin_days_other', { count: thin.length })}</Text>
            </Card>
          )
        : null}
    </>
  );
}

function DayRow({ day, reference }: { day: WeekDay; reference: number }) {
  const pct = Math.round(barFraction(day.hours, reference) * 100);
  const label = `${dayLabel(day.date)}: ${formatHours(day.hours)}${day.isGap ? `, ${translate('week_review.thin')}` : ''}`;
  return (
    <View accessible accessibilityLabel={label}>
      <View className="flex-row items-center justify-between">
        <Text className="w-10 text-sm text-muted-foreground">{dayLabel(day.date)}</Text>
        <Text className="w-12 text-right text-sm font-medium text-foreground" style={{ fontVariant: ['tabular-nums'] }}>{formatHours(day.hours)}</Text>
      </View>
      <View className="mt-1 h-2 overflow-hidden rounded-full bg-muted">
        <View
          className={day.isGap ? 'h-2 rounded-full bg-warning-500' : 'h-2 rounded-full bg-primary-600'}
          style={{ width: `${pct}%` }}
        />
      </View>
    </View>
  );
}

function CloseSection({ review, pending, onClose }: { review: WeekReview; pending: boolean; onClose: () => void }) {
  if (review.isClosed) {
    return (
      <Card className="mt-6" testID="week-review-closed">
        <Text className="text-sm font-medium text-foreground" tx="week_review.closed_title" />
        <Text className="mt-1 text-sm text-muted-foreground" tx="week_review.closed_body" />
        <Text className="mt-0.5 text-xs text-muted-foreground">
          {review.closedAt ? formatDateShort(review.closedAt) : ''}
        </Text>
      </Card>
    );
  }
  return <Button className="mt-6" label={translate('week_review.close')} loading={pending} onPress={onClose} testID="week-review-close" />;
}
