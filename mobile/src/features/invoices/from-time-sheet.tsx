import type { BottomSheetModal } from '@gorhom/bottom-sheet';
import type { UnbilledPeriod } from './invoice-logic';
import * as React from 'react';
import { ActivityIndicator, View } from 'react-native';
import { Button, ErrorState, Modal, Segmented, Select, Text } from '~/components/ui';
import { BottomSheetView } from '~/components/ui/bottom-sheet';
import { errorMessage, trpc } from '~/lib/api';
import { formatHours, formatMoney } from '~/lib/format';
import { translate } from '~/lib/i18n';
import { showMessage, useReportLoad } from '~/lib/notify';
import { ScreenLoad } from '~/lib/notify-load';
import { summarizeUnbilled } from './invoice-logic';

type Props = {
  ref: React.RefObject<BottomSheetModal | null>;
  onCreated: (invoiceId: string) => void;
  onManual: () => void;
};

const PERIODS: UnbilledPeriod[] = ['thisMonth', 'lastMonth', 'all'];
const PERIOD_TX = { thisMonth: 'invoices.from_time.this_month', lastMonth: 'invoices.from_time.last_month', all: 'invoices.from_time.all' } as const;

/**
 * Bottom sheet: vælg kunde → periode → se ufakturerede timer → opret kladde.
 * Bruger `invoices.getUninvoicedTimeEntries` (kundens ufakturerede, ikke-klippekort
 * poster) og `invoices.generateFromTimeEntries`, præcis som web's "Ny faktura fra tid".
 */
export function FromTimeSheet({ ref, onCreated, onManual }: Props) {
  const [clientId, setClientId] = React.useState<string | undefined>();
  const [period, setPeriod] = React.useState<UnbilledPeriod>('thisMonth');
  const utils = trpc.useUtils();

  const clients = trpc.clients.list.useQuery(undefined);
  const entries = trpc.invoices.getUninvoicedTimeEntries.useQuery(
    { clientId: clientId ?? '' },
    { enabled: !!clientId },
  );
  const generate = trpc.invoices.generateFromTimeEntries.useMutation({
    onSuccess: (result) => {
      void utils.invoices.invalidate();
      void utils.time.invalidate();
      showMessage({ message: translate('invoices.from_time.created'), type: 'success' });
      ref.current?.dismiss();
      onCreated(result.invoice.id);
    },
    onError: error => showMessage({ message: errorMessage(error), type: 'danger' }),
  });

  useReportLoad(clients, translate('common.loaded'));
  useReportLoad(entries, translate('common.loaded'));

  const summary = React.useMemo(
    () => summarizeUnbilled(entries.data ?? [], period),
    [entries.data, period],
  );

  const clientOptions = React.useMemo(
    () => (clients.data ?? []).map(c => ({ label: c.company || c.name, value: c.id })),
    [clients.data],
  );
  const periodOptions = React.useMemo(
    () => PERIODS.map(p => ({ value: p, label: translate(PERIOD_TX[p]) })),
    [],
  );

  return (
    <Modal ref={ref} snapPoints={['70%']} title={translate('invoices.from_time.title')}>
      <ScreenLoad message={translate('common.loaded')}>
        <BottomSheetView className="px-4 pb-8">
          {clients.isError
            ? <ErrorState message={errorMessage(clients.error)} onRetry={clients.refetch} />
            : null}
          <Select
            label={translate('invoices.client')}
            placeholder={translate('invoices.from_time.pick_client')}
            options={clientOptions}
            value={clientId}
            onSelect={v => setClientId(String(v))}
            testID="from-time-client"
          />
          <Segmented options={periodOptions} value={period} onChange={setPeriod} testID="from-time-period" />
          <View className="my-6 min-h-16 items-center justify-center rounded-2xl border border-border bg-card p-4">
            {!clientId
              ? <Text className="text-center text-muted-foreground" tx="invoices.from_time.pick_client" />
              : entries.isLoading
                ? <ActivityIndicator />
                : entries.isError
                  ? <ErrorState message={errorMessage(entries.error)} onRetry={entries.refetch} />
                  : summary.ids.length === 0
                    ? <Text className="text-center text-muted-foreground" tx="invoices.from_time.empty" />
                    : (
                        <Text className="text-center text-base font-medium text-foreground">
                          {translate('invoices.from_time.preview', {
                            count: summary.ids.length,
                            hours: formatHours(summary.hours),
                            value: formatMoney(summary.value),
                          })}
                        </Text>
                      )}
          </View>
          <Button
            label={translate('invoices.from_time.create')}
            disabled={!clientId || summary.ids.length === 0}
            loading={generate.isPending}
            onPress={() => clientId && generate.mutate({ clientId, timeEntryIds: summary.ids })}
            testID="from-time-create"
          />
          {/* Fast pris og andet arbejde uden registreret tid har ingen timer at
              komme fra — de skrives som egne linjer. */}
          <Button
            className="mt-3"
            variant="outline"
            label={translate('invoices.new.manual')}
            onPress={() => {
              ref.current?.dismiss();
              onManual();
            }}
            testID="from-time-manual"
          />
        </BottomSheetView>
      </ScreenLoad>
    </Modal>
  );
}
