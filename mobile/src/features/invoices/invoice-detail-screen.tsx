import type { BottomSheetModal } from '@gorhom/bottom-sheet';
import type { InvoiceStatus } from './invoice-logic';
import type { RouterOutputs } from '~/api/app-router';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as React from 'react';
import { Alert, View } from 'react-native';
import {
  Badge,
  Button,
  Card,
  ErrorState,
  ListRow,
  ListSkeleton,
  Screen,
  SectionHeader,
  Text,
} from '~/components/ui';
import { errorMessage, trpc } from '~/lib/api';
import { formatDateShort, formatHours, formatMoney } from '~/lib/format';
import { translate } from '~/lib/i18n';
import { intlLocale } from '~/lib/locale';
import { showMessage, useAnnounceLoaded } from '~/lib/notify';
import { InvoiceLinesEditor } from './invoice-lines-editor';
import { canTransition, computeTotals, effectiveStatus, statusTone, statusTx } from './invoice-logic';

type Invoice = RouterOutputs['invoices']['getById'];

export function InvoiceDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const invoice = trpc.invoices.getById.useQuery({ id }, { enabled: !!id });
  const lines = trpc.invoices.getLines.useQuery({ invoiceId: id }, { enabled: !!id });
  const template = trpc.invoiceTemplates.getDefault.useQuery();
  const sheetRef = React.useRef<BottomSheetModal | null>(null);
  // Stabil identitet: `?? []` ville give et nyt array hvert render, og editoren
  // bruger identiteten til at vide hvornår den skal genindlæse fra serveren.
  const serverLines = React.useMemo(() => lines.data ?? [], [lines.data]);

  const refresh = React.useCallback(() => {
    void invoice.refetch();
    void lines.refetch();
  }, [invoice, lines]);

  useAnnounceLoaded(invoice, translate('common.loaded'));

  const title = invoice.data ? translate('invoices.detail_title', { number: invoice.data.invoiceNumber }) : '';
  // Serveren afviser linjeskift på alt andet end kladder, så vi tilbyder dem kun der.
  const editable = (invoice.data?.status ?? 'draft') === 'draft';

  return (
    <Screen title={title} back refreshing={invoice.isRefetching} onRefresh={refresh}>
      {invoice.isLoading
        ? <ListSkeleton rows={3} />
        : invoice.isError || !invoice.data
          ? <ErrorState message={errorMessage(invoice.error)} onRetry={refresh} />
          : (
              <>
                <InvoiceHeader invoice={invoice.data} />
                <InvoiceLines lines={serverLines} amount={invoice.data.amount} vatRate={template.data?.vatRate} />
                <InvoiceTimeEntries invoice={invoice.data} />
                <InvoiceActions invoice={invoice.data} onEditLines={() => sheetRef.current?.present()} />
              </>
            )}
      {editable
        ? (
            <InvoiceLinesEditor
              ref={sheetRef}
              invoiceId={id}
              lines={serverLines}
              onSaved={() => {
                refresh();
                sheetRef.current?.dismiss();
              }}
            />
          )
        : null}
    </Screen>
  );
}

function InvoiceHeader({ invoice }: { invoice: Invoice }) {
  const status = effectiveStatus(invoice);
  const clientName = invoice.client?.company || invoice.client?.name || '';
  return (
    <Card className="mb-2">
      <View className="flex-row items-center justify-between">
        <Text className="text-lg font-semibold text-foreground" numberOfLines={1}>{clientName}</Text>
        <Badge label={translate(statusTx(status))} tone={statusTone(status)} />
      </View>
      {invoice.kind === 'credit_note' && invoice.relatedInvoiceId
        ? <Text className="mt-1 text-sm text-muted-foreground" tx="invoices.credit_note_kind" />
        : null}
      <View className="mt-3 flex-row gap-4">
        <Meta label={translate('invoices.issued')} value={formatDateShort(invoice.issueDate)} />
        {invoice.dueDate ? <Meta label={translate('invoices.due')} value={formatDateShort(invoice.dueDate)} /> : null}
        {invoice.paidDate ? <Meta label={translate('invoices.paid_on')} value={formatDateShort(invoice.paidDate)} /> : null}
      </View>
      {invoice.notes
        ? (
            <View className="mt-3">
              <Text className="text-xs font-medium text-muted-foreground uppercase" tx="invoices.notes" />
              <Text className="mt-0.5 text-sm text-foreground">{invoice.notes}</Text>
            </View>
          )
        : null}
    </Card>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <View>
      <Text className="text-xs font-medium text-muted-foreground uppercase">{label}</Text>
      <Text className="text-sm text-foreground">{value}</Text>
    </View>
  );
}

type LinesProps = { lines: RouterOutputs['invoices']['getLines']; amount: string; vatRate: string | null | undefined };

function InvoiceLines({ lines, amount, vatRate }: LinesProps) {
  const totals = computeTotals(lines, amount, vatRate);
  return (
    <>
      <SectionHeader title={translate('invoices.lines')} />
      <Card className="p-0">
        {lines.length === 0
          ? <Text className="p-4 text-sm text-muted-foreground" tx="invoices.no_lines" />
          : lines.map((line, i) => (
              <ListRow
                key={line.id}
                title={line.description}
                subtitle={`${Number.parseFloat(line.quantity).toLocaleString(intlLocale())} × ${formatMoney(line.unitPrice)}`}
                right={formatMoney(line.amount)}
                last={i === lines.length - 1}
              />
            ))}
      </Card>
      <Card className="mt-3">
        <TotalRow label={translate('invoices.net')} value={formatMoney(totals.net, { decimals: 2 })} />
        <TotalRow label={translate('invoices.vat', { rate: totals.vatRate })} value={formatMoney(totals.vat, { decimals: 2 })} />
        <View className="mt-2 border-t border-border pt-2">
          <TotalRow label={translate('invoices.gross')} value={formatMoney(totals.gross, { decimals: 2 })} bold />
        </View>
      </Card>
    </>
  );
}

function TotalRow({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  const cls = bold ? 'text-base font-bold text-foreground' : 'text-sm text-muted-foreground';
  return (
    <View className="flex-row items-center justify-between py-0.5">
      <Text className={cls}>{label}</Text>
      <Text className={bold ? 'text-base font-bold text-foreground' : 'text-sm text-foreground'}>{value}</Text>
    </View>
  );
}

function InvoiceTimeEntries({ invoice }: { invoice: Invoice }) {
  const router = useRouter();
  const entries = invoice.timeEntries ?? [];
  if (entries.length === 0)
    return null;
  return (
    <>
      <SectionHeader title={translate('invoices.time_entries')} />
      <Card className="p-0">
        {entries.map((e, i) => (
          <ListRow
            key={e.id}
            title={e.description || e.project?.name || formatDateShort(e.date)}
            subtitle={`${formatDateShort(e.date)}${e.project?.name ? ` · ${e.project.name}` : ''}`}
            right={formatHours(e.hours)}
            onPress={() => router.push(`/entries/${e.id}`)}
            last={i === entries.length - 1}
          />
        ))}
      </Card>
    </>
  );
}

function useInvoiceMutations(invoice: Invoice) {
  const utils = trpc.useUtils();
  const router = useRouter();
  const invalidate = () => {
    void utils.invoices.invalidate();
    void utils.time.invalidate();
  };
  const onError = (error: unknown) => showMessage({ message: errorMessage(error), type: 'danger' });

  const transition = trpc.invoices.transition.useMutation({
    onSuccess: (_data, vars) => {
      invalidate();
      if (vars.newStatus === 'deleted') {
        showMessage({ message: translate('invoices.deleted_ok'), type: 'success' });
        router.back();
      }
      else {
        showMessage({ message: translate('invoices.updated_ok'), type: 'success' });
      }
    },
    onError,
  });
  const send = trpc.invoices.sendEmail.useMutation({
    onSuccess: () => {
      invalidate();
      showMessage({ message: translate('invoices.sent_ok'), type: 'success' });
    },
    onError,
  });
  const creditNote = trpc.invoices.createCreditNote.useMutation({
    onSuccess: (cn) => {
      invalidate();
      showMessage({ message: translate('invoices.credit_note_created'), type: 'success' });
      router.replace(`/invoices/${cn.id}`);
    },
    onError,
  });

  const go = (newStatus: InvoiceStatus) => transition.mutate({ id: invoice.id, newStatus });
  const confirm = (message: string, onOk: () => void) =>
    Alert.alert(translate('invoices.title'), message, [
      { text: translate('tasks.cancel'), style: 'cancel' },
      { text: 'OK', onPress: onOk },
    ]);

  return {
    busy: transition.isPending || send.isPending || creditNote.isPending,
    go,
    sendEmail: () => {
      const email = invoice.client?.email;
      if (!email) {
        showMessage({ message: translate('invoices.no_client_email'), type: 'warning' });
        return;
      }
      confirm(translate('invoices.confirm_send', { number: invoice.invoiceNumber, email }), () => send.mutate({ id: invoice.id }));
    },
    deleteDraft: () => confirm(translate('invoices.confirm_delete'), () => go('deleted')),
    createCreditNote: () => confirm(translate('invoices.confirm_credit_note'), () => creditNote.mutate({ invoiceId: invoice.id })),
  };
}

function InvoiceActions({ invoice, onEditLines }: { invoice: Invoice; onEditLines: () => void }) {
  const m = useInvoiceMutations(invoice);
  const status = (invoice.status ?? 'draft') as InvoiceStatus;
  const isCreditNote = invoice.kind === 'credit_note';
  const canSend = status === 'draft' || status === 'sent' || status === 'overdue';
  return (
    <View className="mt-6">
      {status === 'draft'
        ? <Button label={translate('invoices.actions.edit_lines')} onPress={onEditLines} disabled={m.busy} testID="invoice-edit-lines" />
        : null}
      {canTransition(status, 'paid') ? <Button className="mt-2" label={translate('invoices.actions.mark_paid')} onPress={() => m.go('paid')} disabled={m.busy} testID="invoice-mark-paid" /> : null}
      {canSend && !isCreditNote
        ? <Button variant="outline" label={translate(status === 'draft' ? 'invoices.actions.send' : 'invoices.actions.resend')} onPress={m.sendEmail} disabled={m.busy} testID="invoice-send" />
        : null}
      {canTransition(status, 'sent') && status === 'draft' ? <Button variant="outline" label={translate('invoices.actions.mark_sent')} onPress={() => m.go('sent')} disabled={m.busy} /> : null}
      {canTransition(status, 'sent') && status === 'overdue' ? <Button variant="outline" label={translate('invoices.actions.extend')} onPress={() => m.go('sent')} disabled={m.busy} /> : null}
      {canTransition(status, 'overdue') ? <Button variant="outline" label={translate('invoices.actions.mark_overdue')} onPress={() => m.go('overdue')} disabled={m.busy} /> : null}
      {status === 'paid' && !isCreditNote ? <Button variant="outline" label={translate('invoices.actions.credit_note')} onPress={m.createCreditNote} disabled={m.busy} /> : null}
      {canTransition(status, 'deleted') ? <Button variant="destructive" label={translate('invoices.actions.delete_draft')} onPress={m.deleteDraft} disabled={m.busy} testID="invoice-delete" /> : null}
    </View>
  );
}
