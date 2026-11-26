import type { Bar, ReportConfig, ReportEntryLike, ReportMetric, ReportPeriod } from './report-logic';
import type { SharePeriod } from './report-share-logic';
import { BarChart3 } from 'lucide-react-native';
import * as React from 'react';
import { Share, View } from 'react-native';
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  Input,
  ListSkeleton,
  Screen,
  SectionHeader,
  Segmented,
  StatTile,
  Text,
  useModal,
} from '~/components/ui';
import { useCapabilities } from '~/features/capabilities/use-capabilities';
import { errorMessage, trpc } from '~/lib/api';
import { formatDateShort, formatHours, formatMoney } from '~/lib/format';
import { translate } from '~/lib/i18n';
import { showMessage, useAnnounceLoaded } from '~/lib/notify';
import { ShareReportSheet } from './components/share-report-sheet';
import {
  barPercent,
  billableHours,
  buildReportConfig,
  groupEntries,
  hasMemberData,
  REPORT_PERIODS,
} from './report-logic';

export function ReportsScreen() {
  const caps = useCapabilities();
  const enabled = caps.isEnabled('reports');
  const [period, setPeriod] = React.useState<ReportPeriod>('thisMonth');
  const [customStart, setCustomStart] = React.useState('');
  const [customEnd, setCustomEnd] = React.useState('');
  const [metric, setMetric] = React.useState<ReportMetric>('hours');

  const config = React.useMemo(
    () => buildReportConfig({ period, customStart, customEnd }),
    [period, customStart, customEnd],
  );
  const report = trpc.reports.getReportData.useQuery(
    { config: config! },
    { enabled: enabled && !!config },
  );
  useAnnounceLoaded(report, translate('common.loaded'));

  const { shareCsv, sharingCsv } = useShareCsv(config, report.data?.period);

  const periodOptions = React.useMemo(
    () => REPORT_PERIODS.map(p => ({ value: p, label: translate(`reports.period.${p}`) })),
    [],
  );
  const metricOptions = React.useMemo(
    () => (['hours', 'revenue'] as ReportMetric[]).map(m => ({ value: m, label: translate(`reports.metric.${m}`) })),
    [],
  );

  // Delingsarket får **samme** config som rapporten viser, så et link aldrig
  // kan vise en anden periode end den brugeren lige har set.
  const share = useModal();
  // Kun et åbent ark henter listen — BottomSheetModal monterer indholdet hele tiden.
  const [shareOpen, setShareOpen] = React.useState(false);
  const openShare = React.useCallback(() => {
    setShareOpen(true);
    share.present();
  }, [share]);
  const serverPeriod = report.data?.period as SharePeriod | undefined;

  if (!enabled) {
    return (
      <Screen title={translate('reports.title')} back>
        <EmptyState icon={BarChart3} title={translate('reports.module_off_title')} description={translate('reports.module_off_body')} />
      </Screen>
    );
  }

  const entries = (report.data?.entries ?? []) as ReportEntryLike[];
  const subtitle = report.data ? `${formatDateShort(report.data.period.start)} – ${formatDateShort(report.data.period.end)}` : undefined;

  return (
    <Screen
      title={translate('reports.title')}
      subtitle={subtitle}
      back
      refreshing={report.isRefetching}
      onRefresh={() => void report.refetch()}
      header={<Segmented options={periodOptions} value={period} onChange={setPeriod} testID="reports-period" />}
    >
      {period === 'custom'
        ? (
            <View className="flex-row gap-3">
              <View className="flex-1"><Input label={translate('reports.from')} value={customStart} onChangeText={setCustomStart} placeholder="2026-01-01" keyboardType="numbers-and-punctuation" testID="reports-from" /></View>
              <View className="flex-1"><Input label={translate('reports.to')} value={customEnd} onChangeText={setCustomEnd} placeholder="2026-01-31" keyboardType="numbers-and-punctuation" testID="reports-to" /></View>
            </View>
          )
        : null}
      {!config
        ? <Text className="text-sm text-muted-foreground" tx="reports.invalid_dates" />
        : report.isLoading
          ? <ListSkeleton rows={3} />
          : report.isError
            ? <ErrorState message={errorMessage(report.error)} onRetry={() => void report.refetch()} />
            : entries.length === 0
              ? <EmptyState icon={BarChart3} title={translate('reports.empty_title')} description={translate('reports.empty_body')} compact />
              : (
                  <>
                    <SummaryTiles entries={entries} summary={report.data!.aggregates.summary} />
                    <Segmented className="mt-6" options={metricOptions} value={metric} onChange={setMetric} testID="reports-metric" />
                    <BarSection title={translate('reports.by_client')} bars={groupEntries(entries, 'client', translate('reports.no_client'))} metric={metric} />
                    <BarSection title={translate('reports.by_project')} bars={groupEntries(entries, 'project', translate('reports.no_project'))} metric={metric} />
                    {caps.isManager && hasMemberData(entries)
                      ? <BarSection title={translate('reports.by_member')} bars={groupEntries(entries, 'member', translate('reports.no_member'))} metric={metric} />
                      : null}
                    <Button className="mt-8" variant="outline" label={translate('reports.share_csv')} loading={sharingCsv} onPress={shareCsv} testID="reports-share-csv" />
                    <Button className="mt-2" variant="outline" label={translate('reports.share_action')} onPress={openShare} testID="reports-share-link" />
                    <Text className="mt-2 text-center text-xs text-muted-foreground">{translate('reports.entries_count', { count: entries.length })}</Text>
                  </>
                )}
      <ShareReportSheet ref={share.ref} period={serverPeriod} config={config} enabled={shareOpen} onDismiss={() => setShareOpen(false)} />
    </Screen>
  );
}

function useShareCsv(config: ReportConfig | null, period: SharePeriod | undefined) {
  const exportCsv = trpc.reports.exportReport.useMutation();
  const csvInFlightRef = React.useRef(false);
  const [sharingCsv, setSharingCsv] = React.useState(false);

  async function shareCsv() {
    if (!config || !period || csvInFlightRef.current)
      return;

    csvInFlightRef.current = true;
    setSharingCsv(true);
    try {
      const title = translate('reports.csv_title', { start: period.start, end: period.end });
      const result = await exportCsv.mutateAsync({
        config: {
          ...config,
          filters: {
            ...config.filters,
            dateRange: 'custom',
            customStart: period.start,
            customEnd: period.end,
          },
        },
        format: 'csv',
      });
      if (result.format !== 'csv')
        return;

      try {
        await Share.share({ message: result.data, title });
      }
      catch {
        showMessage({ message: translate('reports.csv_share_error'), type: 'danger' });
      }
    }
    catch (error) {
      showMessage({ message: errorMessage(error), type: 'danger' });
    }
    finally {
      csvInFlightRef.current = false;
      setSharingCsv(false);
    }
  }

  return { shareCsv, sharingCsv };
}

type Summary = { totalHours: number; totalRevenue: number; unbilledRevenue: number };

function SummaryTiles({ entries, summary }: { entries: ReportEntryLike[]; summary: Summary }) {
  return (
    <View className="gap-3">
      <View className="flex-row gap-3">
        <StatTile label={translate('reports.tiles.hours')} value={formatHours(summary.totalHours)} tone="primary" />
        <StatTile label={translate('reports.tiles.billable')} value={formatHours(billableHours(entries))} />
      </View>
      <View className="flex-row gap-3">
        <StatTile label={translate('reports.tiles.revenue')} value={formatMoney(summary.totalRevenue)} tone="success" />
        <StatTile label={translate('reports.tiles.unbilled')} value={formatMoney(summary.unbilledRevenue)} tone={summary.unbilledRevenue > 0 ? 'warning' : 'default'} />
      </View>
    </View>
  );
}

function BarSection({ title, bars, metric }: { title: string; bars: Bar[]; metric: ReportMetric }) {
  const max = Math.max(0, ...bars.map(b => b[metric]));
  return (
    <>
      <SectionHeader title={title} />
      <Card className="gap-3">
        {bars.map(b => (
          <BarRow key={b.key} bar={b} metric={metric} max={max} />
        ))}
      </Card>
    </>
  );
}

function BarRow({ bar, metric, max }: { bar: Bar; metric: ReportMetric; max: number }) {
  const value = bar[metric];
  const pct = barPercent(value, max);
  return (
    <View>
      <View className="flex-row items-center justify-between">
        <Text className="flex-1 pr-2 text-sm text-foreground" numberOfLines={1}>{bar.label}</Text>
        <Text className="text-sm font-medium text-foreground">{metric === 'hours' ? formatHours(value) : formatMoney(value)}</Text>
      </View>
      <View className="mt-1 h-2 overflow-hidden rounded-full bg-muted">
        <View className="h-2 rounded-full bg-primary-600" style={{ width: `${pct}%` }} />
      </View>
    </View>
  );
}
