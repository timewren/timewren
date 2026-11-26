import type { Bucket, DayRange, PeriodMode, StatsMode } from './local-logic';
import { format } from 'date-fns';
import { ChevronLeft, ChevronRight } from 'lucide-react-native';
import * as React from 'react';
import { Pressable, Share, View } from 'react-native';
import { Button, Card, colors, IconButton, Screen, SectionHeader, Segmented, StatTile, Text, useModal } from '~/components/ui';
import { DateField } from '~/features/entries/components/date-field';
import { PrivateBadge, PrivatePlanSheet } from '~/features/plan/private-plan';
import { usePlan } from '~/features/plan/use-plan';
import { brand } from '~/features/server/server-config';
import { formatHoursClock } from '~/lib/format';
import { translate } from '~/lib/i18n';
import { dateFnsLocale, dayOfMonth } from '~/lib/locale';
import { computeStats, entriesToCsv, groupDaysByMonth, groupDaysForChart, periodRange, shiftAnchor } from './local-logic';
import { useLocalStore } from './local-store';

// t:mm uden loft (formatDuration(...).slice(0, 5) klippede timer over 99 forkert af)
const hm = (seconds: number) => formatHoursClock(seconds / 3600);

function parseKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y!, m! - 1, d!);
}

function periodTitle(mode: PeriodMode, range: DayRange): string {
  if (mode === 'year')
    return range.start.slice(0, 4);
  if (mode === 'month') {
    const t = format(parseKey(range.start), 'MMMM yyyy', { locale: dateFnsLocale() });
    return t.charAt(0).toUpperCase() + t.slice(1);
  }
  const start = parseKey(range.start);
  const end = parseKey(range.end);
  return `${translate('local.stats.week')} ${format(start, 'I')} · ${format(start, `${dayOfMonth()} MMM`, { locale: dateFnsLocale() })}–${format(end, `${dayOfMonth()} MMM`, { locale: dateFnsLocale() })}`;
}

/** Statistik uden konto: uge, måned eller valgfri periode — tid pr. dag og fordeling på projekt, kunde og tag. */
export function LocalStatsScreen() {
  const [mode, setMode] = React.useState<StatsMode>('week');
  const [anchor, setAnchor] = React.useState(() => new Date());
  const [custom, setCustom] = React.useState<DayRange>(() => ({ start: format(new Date(), 'yyyy-MM-01'), end: format(new Date(), 'yyyy-MM-dd') }));
  const entries = useLocalStore.use.entries();
  const projects = useLocalStore.use.projects();
  const clients = useLocalStore.use.clients();
  const tags = useLocalStore.use.tags();

  const range = mode === 'custom' ? custom : periodRange(mode, anchor);
  const stats = React.useMemo(
    () => computeStats({ entries, projects, clients, tags }, range, translate('local.stats.none')),
    [entries, projects, clients, tags, range.start, range.end], // eslint-disable-line react/exhaustive-deps
  );
  const avg = stats.activeDays ? stats.totalSeconds / stats.activeDays : 0;
  const plan = usePlan();
  const privateSheet = useModal();
  const exportCsv = () => {
    const csv = entriesToCsv({ entries, projects, clients, tags }, range);
    void Share.share({ title: `${brand.name} ${range.start}–${range.end}.csv`, message: csv });
  };

  return (
    <Screen
      back
      title={translate('local.stats.title')}
      header={(
        <Segmented
          value={mode}
          onChange={setMode}
          options={[
            { value: 'week', label: translate('local.stats.week') },
            { value: 'month', label: translate('local.stats.month') },
            { value: 'year', label: translate('local.stats.year') },
            { value: 'custom', label: translate('local.stats.custom') },
          ]}
          testID="local-stats-mode"
        />
      )}
    >
      {mode === 'custom'
        ? <CustomRange value={custom} onChange={setCustom} />
        : (
            <PeriodNav
              title={periodTitle(mode, range)}
              onPrev={() => setAnchor(a => shiftAnchor(mode, a, -1))}
              onNext={() => setAnchor(a => shiftAnchor(mode, a, 1))}
              onToday={() => setAnchor(new Date())}
            />
          )}
      <View className="mt-3 flex-row gap-3">
        <View className="flex-1"><StatTile label={translate('local.stats.total')} value={hm(stats.totalSeconds)} /></View>
        <View className="flex-1"><StatTile label={translate('local.stats.entries')} value={String(stats.count)} /></View>
        <View className="flex-1"><StatTile label={translate('local.stats.avg')} value={hm(avg)} /></View>
      </View>
      {mode === 'year' && plan.isPrivate('yearStats') ? <View className="mt-3 flex-row"><PrivateBadge onPress={() => privateSheet.present()} /></View> : null}
      <Chart mode={mode} byDay={stats.byDay} />
      <Breakdown title={translate('local.projects')} buckets={stats.byProject} total={stats.totalSeconds} />
      <Breakdown title={translate('local.clients')} buckets={stats.byClient} total={stats.totalSeconds} />
      {stats.byTag.length ? <Breakdown title={translate('local.tags')} buckets={stats.byTag} total={stats.totalSeconds} /> : null}
      {plan.can('export') ? <ExportButton count={stats.count} onExport={exportCsv} showBadge={plan.isPrivate('export')} /> : null}
      <PrivatePlanSheet ref={privateSheet.ref} />
    </Screen>
  );
}

type PeriodNavProps = { title: string; onPrev: () => void; onNext: () => void; onToday: () => void };

function PeriodNav({ title, onPrev, onNext, onToday }: PeriodNavProps) {
  return (
    <View className="flex-row items-center justify-between">
      <IconButton icon={ChevronLeft} onPress={onPrev} label={translate('common.previous')} testID="local-stats-prev" />
      <Pressable onPress={onToday} hitSlop={8} accessibilityRole="button" className="flex-1 items-center" testID="local-stats-title">
        <Text className="text-base font-semibold text-foreground">{title}</Text>
      </Pressable>
      <IconButton icon={ChevronRight} onPress={onNext} label={translate('common.next')} testID="local-stats-next" />
    </View>
  );
}

function CustomRange({ value, onChange }: { value: DayRange; onChange: (r: DayRange) => void }) {
  return (
    <View className="flex-row gap-3">
      <View className="flex-1">
        <DateField label={translate('local.entry.from')} value={value.start} onChange={start => onChange({ ...value, start })} testID="local-stats-from" />
      </View>
      <View className="flex-1">
        <DateField label={translate('local.entry.to')} value={value.end} onChange={end => onChange({ ...value, end })} testID="local-stats-to" />
      </View>
    </View>
  );
}

type LabelOpts = { weekly: boolean; weekdays: boolean; index: number };

/** Ugenummer (ugesøjler), ugedag (≤ 7 dage) eller hver 5. dato (måned). */
function barLabel(key: string, { weekly, weekdays, index }: LabelOpts): string {
  const d = parseKey(key);
  if (weekly)
    return format(d, 'I');
  if (weekdays)
    return format(d, 'EEEEEE', { locale: dateFnsLocale() });
  return index === 0 || (index + 1) % 5 === 0 ? format(d, 'd') : '';
}

/** Søjler pr. dag (lange perioder pr. uge). Højden er relativ til periodens største søjle. */
function Chart({ mode, byDay }: { mode: StatsMode; byDay: Array<{ key: string; seconds: number }> }) {
  const monthly = mode === 'year';
  const bars = monthly ? groupDaysByMonth(byDay) : groupDaysForChart(byDay);
  const weekly = !monthly && bars.length !== byDay.length;
  const max = Math.max(...bars.map(b => b.seconds), 1);
  return (
    <Card className="mt-4" testID="local-stats-chart">
      <Text className="mb-3 text-sm font-medium text-muted-foreground">{translate(monthly ? 'local.stats.per_month' : weekly ? 'local.stats.per_week' : 'local.stats.per_day')}</Text>
      <View className="h-32 flex-row items-end gap-1">
        {bars.map(b => (
          <View key={b.key} className="flex-1 items-center justify-end" style={{ height: '100%' }}>
            <View
              className={b.seconds > 0 ? 'w-full rounded-t-md bg-primary-500' : 'w-full rounded-t-md bg-muted'}
              style={{ height: b.seconds > 0 ? `${Math.max(4, (b.seconds / max) * 100)}%` : 3 }}
            />
          </View>
        ))}
      </View>
      {/* Mærker placeres absolut under deres søjle, så 2-cifrede datoer ikke afkortes i smalle søjler.
          `min-h-4`, ikke `h-4`: etiketten skalerer med systemets skrift, så linjen skal kunne vokse
          (porten i `text-scale.test.ts` dømmer `h-4` over en tekst). */}
      <View className="mt-1 min-h-4">
        {bars.map((b, i) => {
          const label = monthly
            ? format(parseKey(`${b.key}-01`), 'MMM', { locale: dateFnsLocale() }).slice(0, 3)
            : barLabel(b.key, { weekly, weekdays: mode === 'week' || bars.length <= 7, index: i });
          return label
            ? (
                <Text
                  key={b.key}
                  className="absolute w-8 text-center text-[10px] text-muted-foreground"
                  style={{ left: `${((i + 0.5) / bars.length) * 100}%`, marginLeft: -16 }}
                  numberOfLines={1}
                >
                  {label}
                </Text>
              )
            : null;
        })}
      </View>
    </Card>
  );
}

function Breakdown({ title, buckets, total }: { title: string; buckets: Bucket[]; total: number }) {
  if (!total)
    return null;
  return (
    <View>
      <SectionHeader title={title} />
      <Card className="gap-3">
        {buckets.map(b => (
          <View key={b.id ?? 'none'}>
            <View className="flex-row justify-between">
              <Text className="flex-1 text-sm text-foreground" numberOfLines={1}>{b.name}</Text>
              <Text className="text-sm font-medium text-foreground" style={{ fontVariant: ['tabular-nums'] }}>
                {`${hm(b.seconds)} · ${Math.round((b.seconds / total) * 100)} %`}
              </Text>
            </View>
            <View className="mt-1 h-2 overflow-hidden rounded-full bg-muted">
              <View className="h-2 rounded-full" style={{ width: `${(b.seconds / total) * 100}%`, backgroundColor: b.color ?? colors.primary[500] }} />
            </View>
          </View>
        ))}
      </Card>
    </View>
  );
}

function ExportButton({ count, onExport, showBadge }: { count: number; onExport: () => void; showBadge: boolean }) {
  return (
    <View className="mt-6 flex-row items-center gap-3">
      <Button variant="outline" size="sm" fullWidth={false} className="my-0" label={translate('local.stats.export')} onPress={onExport} disabled={count === 0} testID="local-stats-export" />
      {showBadge ? <PrivateBadge /> : null}
    </View>
  );
}
