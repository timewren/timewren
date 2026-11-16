import type { AbsenceType, VacationBalance } from './use-absence';
import { useRouter } from 'expo-router';
import * as React from 'react';
import { View } from 'react-native';
import { Button } from '~/components/ui/button';
import { Card } from '~/components/ui/card';
import { Switch } from '~/components/ui/checkbox';
import { ErrorState } from '~/components/ui/empty-state';
import { Input } from '~/components/ui/input';
import { Select } from '~/components/ui/select';
import { ListSkeleton } from '~/components/ui/skeleton';
import { Text } from '~/components/ui/text';
import { errorMessage, trpc } from '~/lib/api';
import { useToday } from '~/lib/hooks/use-today';
import { translate } from '~/lib/i18n';
import { showMessage, useReportLoad } from '~/lib/notify';
import { ScreenLoad } from '~/lib/notify-load';
import { allowsOpenPeriod, countAbsenceDays, formatDays, pickCurrentBalance } from './absence-logic';
import { DateField } from './components/date-field';
import { useAbsenceTypes, useHolidays, useInvalidateAbsence } from './use-absence';
import { haptic } from './use-approval';

type PreviewProps = {
  days: number;
  type: AbsenceType | undefined;
  balance: VacationBalance | undefined;
  /** Saldoen kunde ikke hentes. Uden den skrev formlen "0 dage → 0 dage", som ligner en rigtig saldo. */
  balanceFailed: boolean;
  open: boolean;
};

/** Antal dage + saldo-effekt. Konverteringsfaktor (deltid) beregnes af serveren. */
function DaysPreview({ days, type, balance, balanceFailed, open }: PreviewProps) {
  if (open) {
    return (
      <Card className="mt-2 bg-muted">
        <Text className="text-sm text-muted-foreground">{translate('enterprise.absence.open_period_hint')}</Text>
      </Card>
    );
  }
  const deducts = !!type?.deductsVacation;
  const pool = type?.vacationPool === 'extra' ? 'extra' : 'vacation';
  const remaining = pool === 'extra' ? (balance?.extraRemaining ?? 0) : (balance?.remaining ?? 0);
  const after = remaining - days;
  return (
    <Card className="mt-2 bg-muted">
      <Text className="text-base font-semibold text-foreground">{formatDays(days)}</Text>
      <Text className="text-xs text-muted-foreground">{translate('enterprise.absence.days_preview_hint')}</Text>
      {deducts && days > 0
        ? balanceFailed
          ? <Text className="mt-2 text-sm text-danger-600 dark:text-danger-400" tx="enterprise.absence.balance_failed" />
          : (
              <Text className={after < 0 ? 'mt-2 text-sm text-danger-600 dark:text-danger-400' : 'mt-2 text-sm text-foreground'}>
                {translate(pool === 'extra' ? 'enterprise.absence.balance_effect_extra' : 'enterprise.absence.balance_effect_vacation', {
                  before: formatDays(remaining),
                  after: formatDays(after),
                })}
              </Text>
            )
        : null}
      {type?.deductsOvertime && days > 0
        ? <Text className="mt-2 text-sm text-foreground">{translate('enterprise.absence.overtime_effect')}</Text>
        : null}
    </Card>
  );
}

/** createRequest med haptik, toast, invalidering og tilbage-navigation. */
function useCreateRequest() {
  const router = useRouter();
  const invalidate = useInvalidateAbsence();
  return trpc.enterprise.createRequest.useMutation({
    onSuccess: () => {
      haptic(true);
      invalidate();
      showMessage({ message: translate('enterprise.absence.created_toast'), type: 'success' });
      router.back();
    },
    onError: (e) => {
      haptic(false);
      showMessage({ message: errorMessage(e), type: 'danger' });
    },
  });
}

/**
 * Eget stop for de to kald (typeliste og feriesaldo). Uden det taler hvert
 * kald for sig selv, og en skærmlæser hører "Indhold indlæst" to gange for én
 * formular. `ScreenLoad` står uden for kaldene — de skal kunne melde ind i
 * det, også mens formularen kun viser en skeleton.
 */
export function AbsenceForm() {
  return (
    <ScreenLoad message={translate('common.loaded')}>
      <AbsenceFormFields />
    </ScreenLoad>
  );
}

function AbsenceFormFields() {
  const today = useToday();
  const types = useAbsenceTypes();
  const { holidays } = useHolidays();
  const balanceQuery = trpc.enterprise.getVacationBalance.useQuery();
  const create = useCreateRequest();

  const [typeId, setTypeId] = React.useState<string>('');
  const [startDate, setStartDate] = React.useState<string | null>(null);
  const [endDate, setEndDate] = React.useState<string | null>(null);
  const [openPeriod, setOpenPeriod] = React.useState(false);
  const [halfDayStart, setHalfDayStart] = React.useState(false);
  const [halfDayEnd, setHalfDayEnd] = React.useState(false);
  const [note, setNote] = React.useState('');

  const type = types.data?.find(t => t.id === typeId);
  const canOpen = allowsOpenPeriod(type?.category);
  const open = canOpen && openPeriod;
  const effectiveEnd = open ? null : (endDate && startDate && endDate < startDate ? startDate : endDate);
  const holidayDates = React.useMemo(() => new Set(holidays.filter(h => !h.isHalfDay).map(h => h.date)), [holidays]);
  const days = startDate && effectiveEnd
    ? countAbsenceDays({ startDate, endDate: effectiveEnd, holidayDates: [...holidayDates], halfDayStart, halfDayEnd })
    : 0;
  const balance = pickCurrentBalance(balanceQuery.data, today);

  // Begge kald melder, så formularen siger når den er klar — og en fejl i
  // typelisten må ikke ende som en Select uden muligheder.
  useReportLoad(types, translate('common.loaded'));
  useReportLoad(balanceQuery, translate('common.loaded'));

  const valid = !!typeId && !!startDate && (open || (!!effectiveEnd && days > 0));
  const submit = () => {
    if (!valid || !startDate)
      return;
    create.mutate({
      absenceTypeId: typeId,
      startDate,
      endDate: open ? undefined : (effectiveEnd ?? undefined),
      halfDayStart,
      halfDayEnd: open ? false : halfDayEnd,
      note: note.trim() || undefined,
    });
  };

  if (types.isLoading)
    return <ListSkeleton rows={3} />;
  if (types.isError)
    return <ErrorState message={errorMessage(types.error)} onRetry={types.refetch} />;

  const options = (types.data ?? []).map(t => ({ label: t.name, value: t.id }));
  return (
    <View>
      <Select
        label={translate('enterprise.absence.type')}
        placeholder={translate('enterprise.absence.type_placeholder')}
        options={options}
        value={typeId || undefined}
        onSelect={v => setTypeId(String(v))}
        testID="absence-type"
      />
      <DateField label={translate('enterprise.absence.start_date')} value={startDate} onChange={setStartDate} marked={holidayDates} testID="start-date" />
      {canOpen
        ? (
            <Switch
              checked={openPeriod}
              onChange={setOpenPeriod}
              label={translate('enterprise.absence.open_period')}
              accessibilityLabel={translate('enterprise.absence.open_period')}
              className="mb-3"
              testID="open-period"
            />
          )
        : null}
      {open
        ? null
        : <DateField label={translate('enterprise.absence.end_date')} value={endDate} onChange={setEndDate} minDate={startDate ?? undefined} marked={holidayDates} testID="end-date" />}
      <View className="mb-3 gap-2">
        <Switch checked={halfDayStart} onChange={setHalfDayStart} label={translate('enterprise.absence.half_day_start')} accessibilityLabel={translate('enterprise.absence.half_day_start')} testID="half-start" />
        {open
          ? null
          : <Switch checked={halfDayEnd} onChange={setHalfDayEnd} label={translate('enterprise.absence.half_day_end')} accessibilityLabel={translate('enterprise.absence.half_day_end')} testID="half-end" />}
      </View>
      <Input
        label={translate('enterprise.absence.note')}
        placeholder={translate('enterprise.absence.note_placeholder')}
        value={note}
        onChangeText={setNote}
        multiline
        testID="absence-note"
      />
      {startDate ? <DaysPreview days={days} type={type} balance={balance} balanceFailed={balanceQuery.isError} open={open} /> : null}
      {type && !type.requiresApproval
        ? <Text className="mt-2 text-xs text-muted-foreground">{translate('enterprise.absence.no_approval_hint')}</Text>
        : null}
      <Button
        label={translate('enterprise.absence.submit')}
        className="mt-4"
        disabled={!valid}
        loading={create.isPending}
        onPress={submit}
        testID="absence-submit"
      />
    </View>
  );
}
