import type { RouterOutputs } from '~/api/app-router';
import * as React from 'react';
import { View } from 'react-native';
import { Badge, Card, Text } from '~/components/ui';
import { formatDateShort, formatMoney } from '~/lib/format';
import { translate } from '~/lib/i18n';
import { effectiveStatus, statusTone, statusTx } from '../invoice-logic';

export type InvoiceListItem = RouterOutputs['invoices']['list'][number];

type Props = {
  invoice: InvoiceListItem;
  onPress: () => void;
};

export function InvoiceRow({ invoice, onPress }: Props) {
  const status = effectiveStatus(invoice);
  const clientName = invoice.client?.company || invoice.client?.name || '';
  const isCreditNote = invoice.kind === 'credit_note';
  return (
    <Card
      onPress={onPress}
      className="mb-3"
      testID={`invoice-${invoice.id}`}
      a11yLabel={[
        `${isCreditNote ? `${translate('invoices.credit_note_kind')} ` : ''}${invoice.invoiceNumber}`,
        clientName,
        invoice.dueDate ? `${translate('invoices.due')} ${formatDateShort(invoice.dueDate)}` : null,
        formatMoney(invoice.amount),
        translate(statusTx(status)),
      ].filter(Boolean).join(', ')}
    >
      <View className="flex-row items-center justify-between">
        <Text className="text-base font-semibold text-foreground" numberOfLines={1}>
          {isCreditNote ? `${translate('invoices.credit_note_kind')} ` : ''}
          {invoice.invoiceNumber}
        </Text>
        <Badge label={translate(statusTx(status))} tone={statusTone(status)} />
      </View>
      <View className="mt-1 flex-row items-end justify-between">
        <View className="flex-1 pr-3">
          <Text className="text-sm text-muted-foreground" numberOfLines={1}>{clientName}</Text>
          {invoice.dueDate
            ? (
                <Text className={status === 'overdue' ? 'text-xs text-danger-600 dark:text-danger-400' : 'text-xs text-muted-foreground'}>
                  {translate('invoices.due')}
                  {' '}
                  {formatDateShort(invoice.dueDate)}
                </Text>
              )
            : null}
        </View>
        <Text className="text-base font-semibold text-foreground">{formatMoney(invoice.amount)}</Text>
      </View>
    </Card>
  );
}
