import type { LocalRow, SetCellInput, TimesheetWeek } from './timesheet-logic';
import type { WeekStatus } from './week';
import * as React from 'react';
import { Alert } from 'react-native';
import { errorMessage, trpc } from '~/lib/api';
import { useToday } from '~/lib/hooks/use-today';
import { translate } from '~/lib/i18n';
import { showMessage } from '~/lib/notify';
import { applyCellLocally, expectedWeekHours, mergeRows } from './timesheet-logic';
import { dayTotals, getWeekStart, isWeekEditable, shiftWeek, weekDays, weekTotal } from './week';

function showError(error: unknown) {
  showMessage({ message: errorMessage(error), type: 'danger' });
}

/** Uge-navigation + valgt dag. Dagen følger med når ugen skiftes (samme ugedag). */
export function useWeekNavigation() {
  const today = useToday();
  const [weekStart, setWeekStart] = React.useState(() => getWeekStart(today));
  const [dayIndex, setDayIndex] = React.useState(() => Math.max(0, weekDays(getWeekStart(today)).indexOf(today)));
  const days = React.useMemo(() => weekDays(weekStart), [weekStart]);
  return {
    weekStart,
    days,
    selectedDay: days[dayIndex] ?? days[0]!,
    selectDay: (day: string) => setDayIndex(Math.max(0, days.indexOf(day))),
    prev: () => setWeekStart(w => shiftWeek(w, -1)),
    next: () => setWeekStart(w => shiftWeek(w, 1)),
    thisWeek: () => {
      const w = getWeekStart();
      setWeekStart(w);
      setDayIndex(Math.max(0, weekDays(w).indexOf(today)));
    },
    isThisWeek: weekStart === getWeekStart(today),
    today,
  };
}

/** Data + mutationer for én uge. Celler opdateres optimistisk med rollback. */
export function useTimesheetWeek(weekStart: string) {
  const utils = trpc.useUtils();
  const query = trpc.enterprise.getTimesheetWeek.useQuery({ weekStart });
  const [localRows, setLocalRows] = React.useState<Record<string, LocalRow[]>>({});

  const invalidate = React.useCallback(() => void utils.enterprise.invalidate(), [utils]);

  const setCell = trpc.enterprise.setTimesheetCell.useMutation({
    onMutate: async (input: SetCellInput) => {
      const key = { weekStart };
      await utils.enterprise.getTimesheetWeek.cancel(key);
      const prev = utils.enterprise.getTimesheetWeek.getData(key);
      if (prev)
        utils.enterprise.getTimesheetWeek.setData(key, applyCellLocally(prev, input));
      return { prev };
    },
    onError: (error, _input, ctx) => {
      if (ctx?.prev)
        utils.enterprise.getTimesheetWeek.setData({ weekStart }, ctx.prev);
      showError(error);
    },
    onSettled: invalidate,
  });

  const copyLastWeek = trpc.enterprise.copyTimesheetWeek.useMutation({
    onSuccess: () => {
      invalidate();
      showMessage({ message: translate('enterprise.timesheet.copied_toast'), type: 'success' });
    },
    onError: showError,
  });

  const submit = trpc.enterprise.submitTimesheetWeek.useMutation({
    onSuccess: (result) => {
      if (result.status === 'submitted') {
        invalidate();
        showMessage({ message: translate('enterprise.timesheet.submitted_toast'), type: 'success' });
        return;
      }
      if (result.status === 'blocked') {
        Alert.alert(translate('enterprise.timesheet.submit_blocked_title'), [...result.errors, ...result.warnings].join('\n\n'));
        return;
      }
      Alert.alert(
        translate('enterprise.timesheet.submit_confirm_title'),
        `${result.warnings.join('\n\n')}\n\n${translate('enterprise.timesheet.submit_confirm_body')}`,
        [
          { text: translate('enterprise.common.cancel'), style: 'cancel' },
          { text: translate('enterprise.timesheet.submit_submit_anyway'), onPress: () => submit.mutate({ weekStart, confirm: true }) },
        ],
      );
    },
    onError: showError,
  });

  const data = query.data;
  const derived = React.useMemo(() => {
    if (!data)
      return null;
    const rows = mergeRows(data, localRows[weekStart] ?? []);
    const totals = dayTotals(data.days, rows, data.absenceRows);
    return {
      rows,
      totals,
      total: weekTotal(totals),
      expected: expectedWeekHours(data.norms),
      editable: isWeekEditable(data.weekStatus as WeekStatus, data.rollingLocked),
    };
  }, [data, localRows, weekStart]);

  const addLocalRow = React.useCallback((row: LocalRow) => {
    setLocalRows(prev => ({ ...prev, [weekStart]: [...(prev[weekStart] ?? []), row] }));
  }, [weekStart]);

  return {
    data: data as TimesheetWeek | undefined,
    derived,
    isLoading: query.isLoading,
    isError: query.isError,
    isRefetching: query.isRefetching,
    refetch: () => void query.refetch(),
    setCell: (input: SetCellInput) => setCell.mutate(input),
    copyLastWeek: () => copyLastWeek.mutate({ weekStart }),
    submit: () => submit.mutate({ weekStart, confirm: false }),
    isSubmitting: submit.isPending,
    isCopying: copyLastWeek.isPending,
    addLocalRow,
  };
}

/** Skabeloner: liste, anvend, gem, slet. */
export function useTimesheetTemplates(weekStart: string) {
  const utils = trpc.useUtils();
  const list = trpc.enterprise.listTimesheetTemplates.useQuery();
  const invalidate = () => void utils.enterprise.invalidate();

  const apply = trpc.enterprise.applyTimesheetTemplate.useMutation({
    onSuccess: () => {
      invalidate();
      showMessage({ message: translate('enterprise.timesheet.template_applied_toast'), type: 'success' });
    },
    onError: showError,
  });
  const save = trpc.enterprise.saveTimesheetTemplate.useMutation({
    onSuccess: () => {
      void utils.enterprise.listTimesheetTemplates.invalidate();
      showMessage({ message: translate('enterprise.timesheet.template_saved_toast'), type: 'success' });
    },
    onError: showError,
  });
  const remove = trpc.enterprise.deleteTimesheetTemplate.useMutation({
    onSuccess: () => void utils.enterprise.listTimesheetTemplates.invalidate(),
    onError: showError,
  });

  return {
    templates: list.data ?? [],
    isLoading: list.isLoading,
    apply: (templateId: string) => apply.mutate({ templateId, weekStart }),
    save: (name: string) => save.mutate({ name, weekStart }),
    remove: (templateId: string) => remove.mutate({ templateId }),
    busy: apply.isPending || save.isPending || remove.isPending,
  };
}
