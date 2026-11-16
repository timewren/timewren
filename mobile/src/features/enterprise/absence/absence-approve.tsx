import type { BottomSheetModal } from '@gorhom/bottom-sheet';
import { useRouter } from 'expo-router';
import { CheckCheck } from 'lucide-react-native';
import * as React from 'react';
import { View } from 'react-native';
import { Button } from '~/components/ui/button';
import { Card } from '~/components/ui/card';
import { EmptyState, ErrorState } from '~/components/ui/empty-state';
import { ListSkeleton } from '~/components/ui/skeleton';
import { Text } from '~/components/ui/text';
import { errorMessage } from '~/lib/api';
import { translate } from '~/lib/i18n';
import { AbsenceRequestRow } from './components/absence-request-row';
import { RejectSheet } from './components/reject-sheet';
import { SwipeRow } from './components/swipe-row';
import { usePendingTeamRequests } from './use-absence';
import { useApprovalMutations } from './use-approval';

type SelectionBarProps = {
  count: number;
  approving: boolean;
  onApprove: () => void;
  onReject: () => void;
  onClear: () => void;
};

function SelectionBar({ count, approving, onApprove, onReject, onClear }: SelectionBarProps) {
  return (
    <View>
      <View className="mt-4 flex-row gap-3">
        <Button
          label={translate('enterprise.absence.approve_selected', { count })}
          className="flex-1 rounded-xl bg-success-600 dark:bg-success-600"
          textClassName="text-white dark:text-white"
          loading={approving}
          onPress={onApprove}
          testID="approve-selected"
        />
        <Button
          variant="destructive"
          label={translate('enterprise.absence.reject_selected', { count })}
          className="flex-1 rounded-xl"
          onPress={onReject}
          testID="reject-selected"
        />
      </View>
      <Button variant="ghost" label={translate('enterprise.absence.clear_selection')} onPress={onClear} testID="clear-selection" />
    </View>
  );
}

/** Godkendelsesliste for ledere: swipe pr. række eller vælg flere (langt tryk). */
export function AbsenceApprove() {
  const router = useRouter();
  const { pending, isLoading, isError, error, refetch } = usePendingTeamRequests(true);
  const [selected, setSelected] = React.useState<Set<string>>(() => new Set());
  const clearSelection = React.useCallback(() => setSelected(new Set()), []);
  const { approve, reject, approveMany, rejectMany, busy } = useApprovalMutations(clearSelection);
  const rejectRef = React.useRef<BottomSheetModal>(null);
  const [rejectTarget, setRejectTarget] = React.useState<string[]>([]);

  const toggle = React.useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id))
        next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const openReject = React.useCallback((ids: string[]) => {
    setRejectTarget(ids);
    rejectRef.current?.present();
  }, []);

  const confirmReject = React.useCallback((reason: string) => {
    rejectRef.current?.dismiss();
    if (rejectTarget.length === 1)
      reject.mutate({ id: rejectTarget[0]!, reviewNote: reason || undefined });
    else if (rejectTarget.length > 1)
      rejectMany.mutate({ ids: rejectTarget, reason: reason || undefined });
  }, [rejectTarget, reject, rejectMany]);

  const selecting = selected.size > 0;

  if (isLoading)
    return <ListSkeleton />;
  if (isError)
    return <ErrorState message={errorMessage(error)} onRetry={() => void refetch()} />;
  if (pending.length === 0) {
    return (
      <EmptyState
        icon={CheckCheck}
        title={translate('enterprise.absence.empty_approve_title')}
        description={translate('enterprise.absence.empty_approve_body')}
        compact
      />
    );
  }

  return (
    <View>
      <Text className="mb-2 text-xs text-muted-foreground">{translate('enterprise.absence.swipe_hint')}</Text>
      <Card className="overflow-hidden p-0">
        {pending.map((r, i) => (
          <SwipeRow
            key={r.id}
            enabled={!selecting && !busy}
            onApprove={() => approve.mutate({ id: r.id })}
            onReject={() => openReject([r.id])}
          >
            <View className="bg-card">
              <AbsenceRequestRow
                request={r}
                showEmployee
                selected={selected.has(r.id)}
                onPress={() => (selecting ? toggle(r.id) : router.push(`/enterprise/absence/${r.id}`))}
                onLongPress={() => toggle(r.id)}
                last={i === pending.length - 1}
                testID={`pending-${r.id}`}
              />
            </View>
          </SwipeRow>
        ))}
      </Card>
      {selecting
        ? (
            <SelectionBar
              count={selected.size}
              approving={approveMany.isPending}
              onApprove={() => approveMany.mutate({ ids: [...selected] })}
              onReject={() => openReject([...selected])}
              onClear={clearSelection}
            />
          )
        : null}
      <RejectSheet
        sheetRef={rejectRef}
        count={rejectTarget.length}
        loading={reject.isPending || rejectMany.isPending}
        onConfirm={confirmReject}
      />
    </View>
  );
}
