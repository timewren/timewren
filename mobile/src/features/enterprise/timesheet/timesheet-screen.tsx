import type { CellTarget } from './components/cell-sheet';
import type { TimesheetRow, TimesheetWeek } from './timesheet-logic';
import type { DayTotal, WeekStatus } from './week';
import { Ellipsis } from 'lucide-react-native';
import * as React from 'react';
import { View } from 'react-native';
import {
  Badge,
  Button,
  Card,
  ColorDot,
  EmptyState,
  ErrorState,
  IconButton,
  ListRow,
  ListSkeleton,
  Screen,
  SectionHeader,
  Text,
  useModal,
} from '~/components/ui';
import { useCapabilities } from '~/features/capabilities/use-capabilities';
import { formatDateLong, formatHours } from '~/lib/format';
import { translate } from '~/lib/i18n';
import { useAnnounceLoaded } from '~/lib/notify';
import { ActionsSheet } from './components/actions-sheet';
import { AddRowSheet } from './components/add-row-sheet';
import { CellSheet } from './components/cell-sheet';
import { DayStrip } from './components/day-strip';
import { WeekNav } from './components/week-nav';
import { absenceForDay } from './timesheet-logic';
import { useTimesheetWeek, useWeekNavigation } from './use-timesheet';
import { deltaTone, expectedDelta, formatDelta, weekStatusKey, weekStatusTone } from './week';

/** Timeseddel — dag-for-dag-udgave af web's ugegrid. */
export function TimesheetScreen() {
  const caps = useCapabilities();
  const nav = useWeekNavigation();
  const ts = useTimesheetWeek(nav.weekStart);
  useAnnounceLoaded(ts, translate('common.loaded'));
  const cellModal = useModal();
  const addModal = useModal();
  const actionsModal = useModal();
  const [cell, setCell] = React.useState<CellTarget | null>(null);

  const openCell = (row: TimesheetRow, day: string) => {
    if (!ts.derived?.editable || !row.projectId)
      return;
    const c = row.days[day];
    setCell({
      projectId: row.projectId,
      projectName: row.projectName,
      activityTypeId: row.activityTypeId,
      activityName: row.activityName,
      date: day,
      hours: c?.total ?? 0,
      minHours: Math.max(0, (c?.total ?? 0) - (c?.timesheetHours ?? 0)),
      note: c?.note ?? null,
    });
    cellModal.present();
  };

  if (!caps.isLoading && !caps.isEnterprise) {
    return (
      <Screen title={translate('enterprise.timesheet.title')} back>
        <EmptyState title={translate('enterprise.timesheet.title')} description={translate('common.requires_enterprise')} />
      </Screen>
    );
  }

  const d = ts.derived;
  const data = ts.data;
  const right = (
    <IconButton icon={Ellipsis} label={translate('enterprise.timesheet.more_actions')} onPress={actionsModal.present} testID="timesheet-actions" />
  );

  return (
    <Screen
      title={translate('enterprise.timesheet.title')}
      back
      right={right}
      refreshing={ts.isRefetching}
      onRefresh={ts.refetch}
      header={<WeekNav weekStart={nav.weekStart} onPrev={nav.prev} onNext={nav.next} onThisWeek={nav.thisWeek} isThisWeek={nav.isThisWeek} />}
    >
      {ts.isLoading || !data || !d
        ? (ts.isError ? <ErrorState onRetry={ts.refetch} /> : <ListSkeleton rows={4} />)
        : (
            <>
              <WeekSummary data={data} total={d.total} expected={d.expected} />
              <StatusBanner data={data} />
              <View className="mt-4">
                <DayStrip
                  days={data.days}
                  selected={nav.selectedDay}
                  today={nav.today}
                  totals={d.totals}
                  norms={data.norms}
                  holidays={new Set(data.holidays.map(h => h.date))}
                  onSelect={nav.selectDay}
                />
              </View>
              <DaySection
                data={data}
                rows={d.rows}
                day={nav.selectedDay}
                totals={d.totals}
                editable={d.editable}
                onPressRow={openCell}
                onAddRow={addModal.present}
              />
              <SubmitArea data={data} editable={d.editable} hasHours={d.total > 0} onSubmit={ts.submit} isSubmitting={ts.isSubmitting} />
            </>
          )}
      <CellSheet
        ref={cellModal.ref}
        target={cell}
        onDismiss={() => setCell(null)}
        onSave={(target, hours, note) => ts.setCell({
          projectId: target.projectId,
          activityTypeId: target.activityTypeId,
          date: target.date,
          hours,
          note,
        })}
      />
      <AddRowSheet ref={addModal.ref} week={data} onAdd={ts.addLocalRow} />
      <ActionsSheet
        ref={actionsModal.ref}
        weekStart={nav.weekStart}
        editable={d?.editable ?? false}
        hasHours={(d?.total ?? 0) > 0}
        onCopyLastWeek={ts.copyLastWeek}
        isCopying={ts.isCopying}
      />
    </Screen>
  );
}

function WeekSummary({ data, total, expected }: { data: TimesheetWeek; total: number; expected: number }) {
  const status = weekStatusKey(data.weekStatus as WeekStatus);
  const delta = expectedDelta(total, expected);
  return (
    <Card className="mt-1">
      <View className="flex-row items-center justify-between">
        <Text className="text-xs font-medium text-muted-foreground uppercase" tx="enterprise.timesheet.week_total" />
        <Badge label={translate(`enterprise.timesheet.status.${status}`)} tone={weekStatusTone(status)} />
      </View>
      <View className="mt-1 flex-row items-end gap-2">
        <Text className="text-3xl font-bold text-foreground" testID="timesheet-week-total">{formatHours(total)}</Text>
        <Text className="mb-1 text-sm text-muted-foreground">{translate('enterprise.common.of_expected', { expected: formatHours(expected) })}</Text>
        <View className="flex-1" />
        {total > 0 ? <Badge label={formatDelta(delta)} tone={deltaTone(total, expected)} className="mb-1" /> : null}
      </View>
      <Text className="mt-2 text-xs text-muted-foreground">
        {`${translate('enterprise.timesheet.flex_balance')}: ${formatDelta(data.flexBalance)}`}
      </Text>
    </Card>
  );
}

function StatusBanner({ data }: { data: TimesheetWeek }) {
  if (data.weekStatus === 'rejected' && data.rejectionReason) {
    return (
      <View className="mt-3 rounded-xl bg-danger-100 p-3 dark:bg-danger-900">
        <Text className="text-sm text-danger-700 dark:text-danger-200">
          {translate('enterprise.timesheet.rejection_reason', { reason: data.rejectionReason })}
        </Text>
      </View>
    );
  }
  if (data.rollingLocked) {
    return (
      <View className="mt-3 rounded-xl bg-muted p-3">
        <Text className="text-sm text-muted-foreground">
          {translate('enterprise.timesheet.locked_rolling', { weeks: data.lockAfterWeeks ?? 0 })}
        </Text>
      </View>
    );
  }
  if (data.weekStatus === 'submitted' || data.weekStatus === 'approved') {
    return (
      <View className="mt-3 rounded-xl bg-muted p-3">
        <Text className="text-sm text-muted-foreground">
          {translate('enterprise.timesheet.locked_status', { status: translate(`enterprise.timesheet.status.${data.weekStatus}`).toLowerCase() })}
        </Text>
      </View>
    );
  }
  return null;
}

type DaySectionProps = {
  data: TimesheetWeek;
  rows: TimesheetRow[];
  day: string;
  totals: Record<string, DayTotal>;
  editable: boolean;
  onPressRow: (row: TimesheetRow, day: string) => void;
  onAddRow: () => void;
};

function DaySection({ data, rows, day, totals, editable, onPressRow, onAddRow }: DaySectionProps) {
  const holiday = data.holidays.find(h => h.date === day);
  const norm = data.norms[day] ?? 0;
  const absences = absenceForDay(data.absenceRows, day);
  const dayRows = rows.filter(r => r.projectId && ((r.days[day]?.total ?? 0) > 0 || r.source !== 'all' || editable));
  // Tid uden projekt (fx intern tid fra stopuret) tæller i dagstotalen og vises skrivebeskyttet.
  const otherRows = rows.filter(r => !r.projectId && (r.days[day]?.total ?? 0) > 0);
  const isEmptyDay = dayRows.length === 0 && otherRows.length === 0 && absences.length === 0;
  const dayTotal = totals[day]?.total ?? 0;
  const subtitle = holiday
    ? `${translate('enterprise.timesheet.holiday')}: ${holiday.name}`
    : norm > 0
      ? `${translate('enterprise.common.expected')} ${formatHours(norm)}`
      : translate('enterprise.timesheet.off_day');

  return (
    <>
      <SectionHeader
        title={formatDateLong(day)}
        action={editable && !isEmptyDay ? { label: translate('enterprise.timesheet.add_row'), onPress: onAddRow, testID: 'timesheet-add-row' } : undefined}
      />
      <Text className="-mt-1 mb-2 text-xs text-muted-foreground">{dayTotal > 0 || norm > 0 || holiday ? `${subtitle} · ${formatHours(dayTotal)}` : subtitle}</Text>
      {absences.map(a => (
        <Card key={a.row.absenceTypeId} className="mb-2 flex-row items-center gap-3 border-violet-300 bg-violet-100 p-3 dark:bg-violet-700">
          <ColorDot color={a.row.color} />
          <Text className="flex-1 text-base text-violet-700 dark:text-violet-100">{a.row.name}</Text>
          <Badge label={translate(a.status === 'approved' ? 'enterprise.timesheet.status.approved' : 'enterprise.timesheet.status.submitted')} tone="violet" />
          <Text className="font-medium text-violet-700 dark:text-violet-100">{formatHours(a.hours)}</Text>
        </Card>
      ))}
      {isEmptyDay
        ? (
            <EmptyState
              title={translate('enterprise.timesheet.no_rows')}
              description={translate('enterprise.timesheet.no_rows_body')}
              action={editable ? { label: translate('enterprise.timesheet.add_row'), onPress: onAddRow } : undefined}
              compact
            />
          )
        : (
            <Card className="p-0">
              {dayRows.map((row, i) => {
                const c = row.days[day];
                const hours = c?.total ?? 0;
                return (
                  <ListRow
                    key={`${row.projectId}|${row.activityTypeId ?? ''}`}
                    title={row.projectName}
                    subtitle={[row.activityName ?? (data.activityTypes.length > 0 ? translate('enterprise.timesheet.no_activity') : null), c?.note].filter(Boolean).join(' · ') || undefined}
                    left={row.activityColor ? <ColorDot color={row.activityColor} /> : undefined}
                    right={<Text className={hours > 0 ? 'text-base font-semibold text-foreground' : 'text-base text-muted-foreground'}>{formatHours(hours)}</Text>}
                    onPress={editable ? () => onPressRow(row, day) : undefined}
                    chevron={false}
                    last={otherRows.length === 0 && i === dayRows.length - 1}
                    testID={`timesheet-row-${row.projectId}-${row.activityTypeId ?? 'none'}`}
                  />
                );
              })}
              {otherRows.map((row, i) => {
                const c = row.days[day];
                return (
                  <ListRow
                    key={`internal|${row.activityTypeId ?? 'none'}|${row.source ?? ''}`}
                    title={row.projectName || translate('timer.internal')}
                    subtitle={[row.activityName, c?.note].filter(Boolean).join(' · ') || translate('timer.internal_hint')}
                    right={<Text className="text-base font-semibold text-foreground">{formatHours(c?.total ?? 0)}</Text>}
                    chevron={false}
                    last={i === otherRows.length - 1}
                    testID={`timesheet-row-internal-${row.activityTypeId ?? 'none'}`}
                  />
                );
              })}
            </Card>
          )}
    </>
  );
}

type SubmitAreaProps = { data: TimesheetWeek; editable: boolean; hasHours: boolean; onSubmit: () => void; isSubmitting: boolean };

function SubmitArea({ data, editable, hasHours, onSubmit, isSubmitting }: SubmitAreaProps) {
  if (!editable || !hasHours)
    return null;
  const label = data.weekStatus === 'rejected' ? translate('enterprise.timesheet.resubmit') : translate('enterprise.timesheet.submit');
  return (
    <View className="mt-6">
      <Button variant="secondary" label={label} onPress={onSubmit} loading={isSubmitting} testID="timesheet-submit" />
    </View>
  );
}
