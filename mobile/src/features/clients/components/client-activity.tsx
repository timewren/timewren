import type { ActivityInvoice, ActivityStats } from '../client-activity-logic';
import { useRouter } from 'expo-router';
import { Clock, Receipt, TriangleAlert } from 'lucide-react-native';
import * as React from 'react';
import { View } from 'react-native';
import { Badge, Card, colors, EmptyState, ErrorState, ListRow, Skeleton, Text } from '~/components/ui';
import { statusTone, statusTx } from '~/features/invoices/invoice-logic';
import { formatDateRelative, formatDateShort, formatMoney } from '~/lib/format';
import { translate } from '~/lib/i18n';
import { clientActivity, hasOverdue, isEmptyActivity } from '../client-activity-logic';

type Row = React.ComponentProps<typeof ListRow>;

type LabelInput = {
  number: string | null;
  dueDate: string | null;
  amount: string;
  status: string;
};

type Props = {
  stats: ActivityStats;
  invoices: readonly ActivityInvoice[] | undefined;
  isLoading: boolean;
  isError: boolean;
  /** Allerede omsat af `errorMessage(error)` — denne komponent kender ikke API'et. */
  errorMessage?: string;
  onRetry: () => void;
  /**
   * `clients.listWithStats` fejlede. De to linjer der kommer fra det kald
   * mangler da, og `ClientStats` lige ovenfor har allerede vist fejlen med sit
   * eget genforsøg — derfor forsvinder de i stedet for at vise et «—» eller 0.
   */
  statsFailed: boolean;
};

function invoiceLabel({ number, dueDate, amount, status }: LabelInput): string {
  return [
    `${translate('clients.activity_last_invoice')} ${number ?? ''}`.trim(),
    dueDate ? `${translate('invoices.due')} ${formatDateShort(dueDate)}` : null,
    amount,
    status,
  ].filter(Boolean).join(', ');
}

/**
 * «Senest set» på kundedetaljen (feature-kø F3): sidste registrerede tid,
 * seneste faktura og forfalde beløb samlet ét sted.
 *
 * Tallene kommer fra de kald skærmen **allerede** har — `clients.listWithStats`
 * svarer `lastActivityDate`, `overdueCount` og `overdueAmount` pr. kunde, og
 * fakturaerne kommer fra `invoices.list` med kunden. Kortet tilføjer ingen ny
 * trafik ud over den kortfattede fakturaliste, der skulle hentes alligevel.
 *
 * R5's regel gælder her som overalt: et kald der fejler må ikke male et nul.
 * Fakturalisten får derfor sin egen `ErrorState`, og linjerne fra `stats`
 * forsvinder i stedet for at vise «—» eller 0, når `stats`-kaldet fejlede.
 */
export function ClientActivity({ stats, invoices, isLoading, isError, errorMessage, onRetry, statsFailed }: Props) {
  const router = useRouter();
  const activity = React.useMemo(() => clientActivity(stats, invoices ?? []), [stats, invoices]);

  if (isLoading) {
    return (
      <Card className="p-0">
        <View className="gap-3 p-4">
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-4 w-1/3" />
        </View>
      </Card>
    );
  }

  if (isError)
    return <Card><ErrorState message={errorMessage} onRetry={onRetry} /></Card>;

  // Tom-tilstanden er en påstand om kunden: «der er intet registreret». Når
  // `stats`-kaldet fejlede, ved vi det ikke — uden denne tjek ville et 500 fra
  // `listWithStats` få kortet til at lyve om en kunde, der har både tid og
  // forfaldne fakturaer. R5's regel, anvendt på tom-rækken.
  if (isEmptyActivity(activity) && !statsFailed)
    return <Card><EmptyState title={translate('clients.no_activity')} compact /></Card>;

  const invoice = activity.lastInvoice;
  const rows: Row[] = [];

  if (!statsFailed) {
    rows.push({
      title: translate('clients.activity_last_time'),
      right: activity.lastEntryDate ? formatDateRelative(activity.lastEntryDate) : translate('clients.no_time_short'),
      left: <Clock size={16} color={colors.neutral[500]} />,
      testID: 'client-activity-last-time',
    });
  }

  rows.push({
    title: invoice ? `${translate('clients.activity_last_invoice')} ${invoice.number ?? ''}`.trim() : translate('clients.activity_last_invoice'),
    subtitle: invoice?.dueDate ? `${translate('invoices.due')} ${formatDateShort(invoice.dueDate)}` : undefined,
    right: invoice
      ? (
          <View className="flex-row items-center gap-2">
            <Text className="text-[15px] font-medium text-foreground">{formatMoney(invoice.amount)}</Text>
            <Badge label={translate(statusTx(invoice.status))} tone={statusTone(invoice.status)} />
          </View>
        )
      : translate('clients.no_invoices'),
    left: <Receipt size={16} color={colors.neutral[500]} />,
    // Højre side er et element med egen betydning (beløb + status), så uden
    // egen label ville skærmlæseren læse dem som løsrevst indhold.
    a11yLabel: invoice
      ? invoiceLabel({
          number: invoice.number,
          dueDate: invoice.dueDate,
          amount: formatMoney(invoice.amount),
          status: translate(statusTx(invoice.status)),
        })
      : undefined,
    onPress: invoice ? () => router.push(`/invoices/${invoice.id}`) : undefined,
    testID: 'client-activity-last-invoice',
  });

  if (!statsFailed) {
    const overdue = hasOverdue(activity);
    // Antal og beløb kommer fra samme forespørgsel og følges derfor ad. Falder
    // de fra hinanden, viser vi beløbet alene frem for et «ingen forfaldne».
    const overdueText = !overdue
      ? translate('clients.no_overdue')
      : activity.overdueCount > 0 ? `${activity.overdueCount} · ${formatMoney(activity.overdueAmount)}` : formatMoney(activity.overdueAmount);
    rows.push({
      title: translate('clients.activity_overdue'),
      right: overdueText,
      left: overdue ? <TriangleAlert size={16} color={colors.danger[600]} /> : undefined,
      a11yLabel: overdue
        ? `${translate('clients.activity_overdue')}, ${activity.overdueCount}, ${formatMoney(activity.overdueAmount)}`
        : undefined,
      testID: 'client-activity-overdue',
    });
  }

  return (
    <Card className="p-0">
      {rows.map((row, index) => <ListRow key={row.testID} {...row} last={index === rows.length - 1} />)}
    </Card>
  );
}
