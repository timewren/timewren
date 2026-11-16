import type { BottomSheetModal } from '@gorhom/bottom-sheet';
import type { AbsenceRequest } from './use-absence';
import { parseISO } from 'date-fns';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { FileQuestion } from 'lucide-react-native';
import * as React from 'react';
import { Alert, View } from 'react-native';
import { Avatar } from '~/components/ui/avatar';
import { Badge } from '~/components/ui/badge';
import { Button } from '~/components/ui/button';
import { Card } from '~/components/ui/card';
import { EmptyState, ErrorState } from '~/components/ui/empty-state';
import { ColorDot, ListRow } from '~/components/ui/list-row';
import { Screen } from '~/components/ui/screen';
import { ListSkeleton } from '~/components/ui/skeleton';
import { Text } from '~/components/ui/text';
import { useCapabilities } from '~/features/capabilities/use-capabilities';
import { errorMessage, trpc } from '~/lib/api';
import { formatDateShort } from '~/lib/format';
import { useCurrentYear, useToday } from '~/lib/hooks/use-today';
import { translate } from '~/lib/i18n';
import { showMessage, useAnnounceLoaded } from '~/lib/notify';
import { absenceStatusKey, absenceStatusTone, formatDays, requestPeriodText } from './absence-logic';
import { DateField } from './components/date-field';
import { EnterpriseGate } from './components/enterprise-gate';
import { RejectSheet } from './components/reject-sheet';
import { useInvalidateAbsence, useMyRequests, useMyUserId, usePendingTeamRequests } from './use-absence';
import { haptic, useApprovalMutations } from './use-approval';

/** Find anmodningen i de lister vi allerede henter (der findes ingen getRequest-procedure). */
function useRequest(id: string, isManager: boolean) {
  const year = useCurrentYear();
  const cur = useMyRequests(year);
  const next = useMyRequests(year + 1);
  const prev = useMyRequests(year - 1);
  const team = usePendingTeamRequests(isManager);
  const all = [...(cur.data ?? []), ...(next.data ?? []), ...(prev.data ?? []), ...(team.data ?? [])];
  const request = all.find(r => r.id === id);
  const isLoading = cur.isLoading || (isManager && team.isLoading);
  const isError = cur.isError || (isManager && team.isError);
  const refetch = () => void Promise.all([cur.refetch(), team.refetch()]);
  return { request, isLoading, isError, refetch };
}

function Facts({ r }: { r: AbsenceRequest }) {
  return (
    <Card className="p-0">
      <ListRow title={translate('enterprise.absence.period')} right={requestPeriodText(r)} />
      {r.totalDays ? <ListRow title={translate('enterprise.absence.days')} right={formatDays(r.totalDays)} /> : null}
      {r.deductedDays && r.deductedDays !== r.totalDays ? <ListRow title={translate('enterprise.absence.deducted')} right={formatDays(r.deductedDays)} /> : null}
      {r.halfDayStart ? <ListRow title={translate('enterprise.absence.half_day_start')} right="✓" /> : null}
      {r.halfDayEnd ? <ListRow title={translate('enterprise.absence.half_day_end')} right="✓" /> : null}
      {r.note ? <ListRow title={translate('enterprise.absence.note')} subtitle={r.note} /> : null}
      {r.rejectionReason ? <ListRow title={translate('enterprise.absence.rejection_reason')} subtitle={r.rejectionReason} /> : null}
      {r.registrar && r.registrar.id !== r.userId ? <ListRow title={translate('enterprise.absence.registered_by')} right={r.registrar.name ?? '—'} /> : null}
      <ListRow title={translate('enterprise.absence.created')} right={formatDateShort(r.createdAt)} last />
    </Card>
  );
}

function ReportWell({ r }: { r: AbsenceRequest }) {
  const today = useToday();
  const [date, setDate] = React.useState<string>(today);
  const invalidate = useInvalidateAbsence();
  const router = useRouter();
  const mutation = trpc.enterprise.reportWell.useMutation({
    onSuccess: () => {
      haptic(true);
      invalidate();
      showMessage({ message: translate('enterprise.absence.report_well_toast'), type: 'success' });
      router.back();
    },
    onError: e => showMessage({ message: errorMessage(e), type: 'danger' }),
  });
  return (
    <Card className="mt-4">
      <Text className="mb-2 text-base font-semibold text-foreground">{translate('enterprise.absence.report_well_title')}</Text>
      <Text className="mb-3 text-sm text-muted-foreground">{translate('enterprise.absence.report_well_body')}</Text>
      <DateField label={translate('enterprise.absence.last_sick_date')} value={date} onChange={setDate} minDate={r.startDate} testID="last-sick-date" />
      <Button
        label={translate('enterprise.absence.report_well')}
        className="rounded-xl bg-success-600 dark:bg-success-600"
        textClassName="text-white dark:text-white"
        loading={mutation.isPending}
        onPress={() => mutation.mutate({ requestId: r.id, lastSickDate: date })}
        testID="report-well"
      />
    </Card>
  );
}

function OwnerActions({ r }: { r: AbsenceRequest }) {
  const invalidate = useInvalidateAbsence();
  const router = useRouter();
  const cancel = trpc.enterprise.cancelRequest.useMutation({
    onSuccess: () => {
      haptic(true);
      invalidate();
      showMessage({ message: translate('enterprise.absence.cancelled_toast'), type: 'success' });
      router.back();
    },
    onError: e => showMessage({ message: errorMessage(e), type: 'danger' }),
  });
  const confirmCancel = () => Alert.alert(
    translate('enterprise.absence.cancel_confirm_title'),
    translate('enterprise.absence.cancel_confirm_body'),
    [
      { text: translate('enterprise.absence.keep'), style: 'cancel' },
      { text: translate('enterprise.absence.cancel'), style: 'destructive', onPress: () => cancel.mutate({ id: r.id }) },
    ],
  );
  const canCancel = (r.status === 'pending' || r.status === 'approved') && r.source !== 'closure';
  const canReportWell = !r.endDate && r.status !== 'cancelled' && r.status !== 'rejected';
  return (
    <View>
      {canReportWell ? <ReportWell r={r} /> : null}
      {canCancel
        ? <Button variant="destructive" label={translate('enterprise.absence.cancel')} className="mt-4 rounded-xl" loading={cancel.isPending} onPress={confirmCancel} testID="cancel-request" />
        : null}
    </View>
  );
}

function ManagerActions({ r }: { r: AbsenceRequest }) {
  const router = useRouter();
  const { approve, reject } = useApprovalMutations();
  const rejectRef = React.useRef<BottomSheetModal>(null);
  const done = () => router.back();
  if (r.status !== 'pending')
    return null;
  return (
    <View className="mt-4 flex-row gap-3">
      <Button
        label={translate('enterprise.absence.approve')}
        className="flex-1 rounded-xl bg-success-600 dark:bg-success-600"
        textClassName="text-white dark:text-white"
        loading={approve.isPending}
        onPress={() => approve.mutate({ id: r.id }, { onSuccess: done })}
        testID="detail-approve"
      />
      <Button
        variant="destructive"
        label={translate('enterprise.absence.reject')}
        className="flex-1 rounded-xl"
        loading={reject.isPending}
        onPress={() => rejectRef.current?.present()}
        testID="detail-reject"
      />
      <RejectSheet
        sheetRef={rejectRef}
        count={1}
        loading={reject.isPending}
        onConfirm={(reason) => {
          rejectRef.current?.dismiss();
          reject.mutate({ id: r.id, reviewNote: reason || undefined }, { onSuccess: done });
        }}
      />
    </View>
  );
}

function DetailBody({ id }: { id: string }) {
  const caps = useCapabilities();
  const me = useMyUserId();
  const { request: r, isLoading, isError, refetch } = useRequest(id, caps.isManager);
  // `useRequest` summerer allerede begge kald til én gate, så det er samme
  // form som et LoadSource.
  useAnnounceLoaded({ isLoading, isError }, translate('common.loaded'));
  if (isLoading && !r)
    return <ListSkeleton rows={2} />;
  if (!r && isError)
    return <ErrorState onRetry={refetch} />;
  if (!r)
    return <EmptyState icon={FileQuestion} title={translate('enterprise.absence.not_found')} />;
  const own = r.userId === me;
  return (
    <View>
      <Card className="mb-4">
        <View className="flex-row items-center gap-3">
          {own ? <ColorDot color={r.absenceType.color} size={14} /> : <Avatar name={r.user?.name} size={40} />}
          <View className="flex-1">
            <Text className="text-lg font-semibold text-foreground">{own ? r.absenceType.name : (r.user?.name ?? '—')}</Text>
            {own ? null : <Text className="text-sm text-muted-foreground">{r.absenceType.name}</Text>}
          </View>
          <Badge label={translate(absenceStatusKey(r.status))} tone={absenceStatusTone(r.status)} />
        </View>
      </Card>
      <Facts r={r} />
      {own ? <OwnerActions r={r} /> : null}
      {!own && caps.isManager ? <ManagerActions r={r} /> : null}
      {!own && !r.endDate && caps.isManager && r.status !== 'cancelled' ? <ReportWell r={r} /> : null}
      <Text className="mt-6 text-center text-xs text-muted-foreground">
        {translate('enterprise.absence.start_label', { date: formatDateShort(parseISO(r.startDate)) })}
      </Text>
    </View>
  );
}

export function AbsenceDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return (
    <EnterpriseGate title={translate('enterprise.absence.detail_title')} back>
      <Screen title={translate('enterprise.absence.detail_title')} back>
        {id ? <DetailBody id={id} /> : null}
      </Screen>
    </EnterpriseGate>
  );
}
