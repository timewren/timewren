import type { BottomSheetModal } from '@gorhom/bottom-sheet';
import type { MemberBalances, TeamMember } from '../team-logic';
import * as React from 'react';
import { View } from 'react-native';
import { useUniwind } from 'uniwind';
import { Avatar, Badge, Button, colors, ErrorState, ListRow, Modal, SectionHeader, Text } from '~/components/ui';
import { BottomSheetScrollView, BottomSheetTextInput } from '~/components/ui/bottom-sheet';
import { errorMessage, trpc } from '~/lib/api';
import { formatAgo, formatDateShort, formatHours } from '~/lib/format';
import { translate } from '~/lib/i18n';
import { intlLocale } from '~/lib/locale';
import { formatDelta, weekStatusKey, weekStatusTone } from '../../timesheet/week';
import { completenessTone, weekActions } from '../team-logic';

type MemberSheetProps = {
  ref: React.RefObject<BottomSheetModal | null>;
  member: TeamMember | null;
  balances: MemberBalances | undefined;
  days: readonly string[] | null;
  weekStart: string;
  isManager: boolean;
  isSelf: boolean;
  busy: boolean;
  onApprove: (userId: string) => void;
  onReject: (userId: string, reason: string) => void;
  onReopen: (userId: string, reason: string) => void;
};

/**
 * Mindste begrundelse pr. handling. Genåbning af en godkendt uge kræver en
 * årsag på serveren (web `MIN_UNLOCK_REASON`), fordi den står i ugens historik.
 */
const MIN_REASON = { reject: 1, reopen: 3 } as const;

/** Detalje for én medarbejders uge: dagsfordeling, saldi, handlinger, historik. */
export function MemberSheet(props: MemberSheetProps) {
  const { ref, member, balances, days, weekStart, isManager, isSelf, busy, onApprove, onReject, onReopen } = props;
  const { theme } = useUniwind();
  const dark = theme === 'dark';
  const [pending, setPending] = React.useState<'reject' | 'reopen' | null>(null);
  const [reason, setReason] = React.useState('');

  const resetForm = () => {
    setPending(null);
    setReason('');
  };
  const close = () => {
    ref.current?.dismiss();
    resetForm();
  };
  const act = (fn: () => void) => () => {
    fn();
    close();
  };
  const actions = weekActions(member?.weekStatus ?? null, { isManager, isSelf });
  const status = weekStatusKey(member?.weekStatus ?? null);

  return (
    <Modal
      ref={ref}
      snapPoints={['85%']}
      title={member?.name}
      onDismiss={resetForm}
      backgroundStyle={{ backgroundColor: dark ? colors.neutral[900] : colors.white }}
      keyboardBehavior="interactive"
      keyboardBlurBehavior="restore"
    >
      <BottomSheetScrollView contentContainerClassName="px-4 pb-10">
        {member
          ? (
              <>
                <View className="flex-row items-center gap-3">
                  <Avatar name={member.name} image={member.image} size={44} />
                  <View className="flex-1">
                    <Text className="text-sm text-muted-foreground" numberOfLines={1}>{member.email}</Text>
                    {member.submittedAt
                      ? <Text className="text-xs text-muted-foreground">{translate('enterprise.team.submitted_at', { when: formatAgo(member.submittedAt) })}</Text>
                      : null}
                  </View>
                  <Badge label={translate(`enterprise.timesheet.status.${status}`)} tone={weekStatusTone(status)} />
                </View>
                {member.rejectionReason
                  ? <Text className="mt-2 text-sm text-danger-600">{translate('enterprise.timesheet.rejection_reason', { reason: member.rejectionReason })}</Text>
                  : null}

                <HoursSummary member={member} />
                <BalanceChips balances={balances} />
                {days && member.perDay ? <DayBreakdown member={member} days={days} /> : null}

                {pending
                  ? (
                      <ReasonForm
                        kind={pending}
                        reason={reason}
                        busy={busy}
                        onChange={setReason}
                        onConfirm={act(() => (pending === 'reject' ? onReject : onReopen)(member.userId, reason.trim()))}
                        onCancel={resetForm}
                      />
                    )
                  : (
                      <View className="mt-4">
                        {actions.approve ? <Button variant="secondary" label={translate('enterprise.team.approve')} loading={busy} onPress={act(() => onApprove(member.userId))} testID="approve" /> : null}
                        {actions.reject ? <Button variant="outline" label={translate('enterprise.team.reject')} disabled={busy} onPress={() => setPending('reject')} testID="reject" /> : null}
                        {actions.reopen ? <Button variant="outline" label={translate('enterprise.team.reopen')} disabled={busy} onPress={() => setPending('reopen')} testID="reopen" /> : null}
                      </View>
                    )}

                {isManager ? <EventList userId={member.userId} weekStart={weekStart} /> : null}
              </>
            )
          : null}
      </BottomSheetScrollView>
    </Modal>
  );
}

type ReasonFormProps = {
  kind: 'reject' | 'reopen';
  reason: string;
  busy: boolean;
  onChange: (reason: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
};

/** Begrundelse før afvisning eller genåbning — sendes med til serveren. */
function ReasonForm({ kind, reason, busy, onChange, onConfirm, onCancel }: ReasonFormProps) {
  return (
    <View className="mt-4">
      {kind === 'reopen' ? <Text className="mb-2 text-sm text-muted-foreground" tx="enterprise.team.reopen_body" /> : null}
      <Text className="mb-1 text-sm text-muted-foreground" tx="enterprise.common.reason" />
      <BottomSheetTextInput
        value={reason}
        onChangeText={onChange}
        placeholder={translate(`enterprise.team.${kind}_placeholder`)}
        placeholderTextColor={colors.neutral[400]}
        maxLength={500}
        multiline
        className="min-h-20 rounded-xl border border-border bg-muted px-4 py-3 text-base text-foreground"
        testID={`${kind}-reason`}
      />
      <Button
        variant={kind === 'reject' ? 'destructive' : 'default'}
        label={translate(`enterprise.team.${kind}`)}
        disabled={reason.trim().length < MIN_REASON[kind] || busy}
        onPress={onConfirm}
        testID={`${kind}-confirm`}
      />
      <Button variant="ghost" size="sm" label={translate('enterprise.common.cancel')} onPress={onCancel} />
    </View>
  );
}

function HoursSummary({ member }: { member: TeamMember }) {
  if (member.total === null || member.norm === null)
    return null;
  return (
    <View className="mt-4 flex-row items-end gap-2">
      <Text className="text-3xl font-bold text-foreground">{formatHours(member.total)}</Text>
      <Text className="mb-1 text-sm text-muted-foreground">{translate('enterprise.common.of_expected', { expected: formatHours(member.norm) })}</Text>
      <View className="flex-1" />
      {member.completeness
        ? <Badge label={translate(`enterprise.team.completeness.${member.completeness}`)} tone={completenessTone(member.completeness)} className="mb-1" />
        : null}
    </View>
  );
}

function BalanceChips({ balances }: { balances: MemberBalances | undefined }) {
  if (!balances)
    return null;
  const chips: Array<{ label: string; value: string; tone: 'violet' | 'default' | 'warning' | 'success' }> = [];
  if (balances.vacation)
    chips.push({ label: translate('enterprise.team.balances.vacation'), value: `${balances.vacation.remaining.toLocaleString(intlLocale())} d`, tone: 'violet' });
  if (balances.extraDays)
    chips.push({ label: translate('enterprise.team.balances.extra_days'), value: `${balances.extraDays.remaining.toLocaleString(intlLocale())} d`, tone: 'violet' });
  chips.push({ label: translate('enterprise.team.balances.flex'), value: formatDelta(balances.flexHours), tone: balances.flexHours < 0 ? 'warning' : 'default' });
  if (balances.overtimeHours !== null)
    chips.push({ label: translate('enterprise.team.balances.overtime'), value: formatHours(balances.overtimeHours), tone: 'success' });
  return (
    <View className="mt-3 flex-row flex-wrap gap-2">
      {chips.map(c => <Badge key={c.label} label={`${c.label} ${c.value}`} tone={c.tone} />)}
    </View>
  );
}

function DayBreakdown({ member, days }: { member: TeamMember; days: readonly string[] }) {
  return (
    <>
      <SectionHeader title={translate('enterprise.team.day_breakdown')} />
      <View className="overflow-hidden rounded-2xl border border-border">
        {days.map((day, i) => {
          const hours = member.perDay?.[day] ?? 0;
          const absence = member.absenceByDay[day];
          return (
            <ListRow
              key={day}
              title={formatDateShort(day)}
              subtitle={absence?.name}
              right={<Text className={hours > 0 ? 'font-medium text-foreground' : 'text-muted-foreground'}>{formatHours(hours)}</Text>}
              last={i === days.length - 1}
            />
          );
        })}
      </View>
    </>
  );
}

function EventList({ userId, weekStart }: { userId: string; weekStart: string }) {
  const events = trpc.enterprise.getTimesheetWeekEvents.useQuery({ userId, weekStart });
  const list = events.data ?? [];
  return (
    <>
      <SectionHeader title={translate('enterprise.team.events')} />
      {events.isError
        ? <ErrorState message={errorMessage(events.error)} onRetry={() => void events.refetch()} />
        : list.length === 0
          ? <Text className="text-sm text-muted-foreground" tx="enterprise.team.no_events" />
          : (
              <View className="overflow-hidden rounded-2xl border border-border">
                {list.map((e, i) => (
                  <ListRow
                    key={e.id}
                    title={translate(`enterprise.team.event.${e.event as 'submitted' | 'approved' | 'rejected' | 'reopened'}`)}
                    subtitle={[e.actor?.name ?? e.actorLabel, e.reason].filter(Boolean).join(' · ') || undefined}
                    right={<Text className="text-xs text-muted-foreground">{formatAgo(e.createdAt)}</Text>}
                    last={i === list.length - 1}
                  />
                ))}
              </View>
            )}
    </>
  );
}
