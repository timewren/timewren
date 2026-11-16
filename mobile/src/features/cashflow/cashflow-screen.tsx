import type { CashflowForecast, DeadlineTone, VatOverview } from './cashflow-logic';
import { useRouter } from 'expo-router';
import { AlertTriangle, Receipt, TrendingUp } from 'lucide-react-native';
import * as React from 'react';
import { View } from 'react-native';
import { twMerge } from 'tailwind-merge';
import { useUniwind } from 'uniwind';
import {
  Card,
  EmptyState,
  ErrorState,
  Screen,
  SectionHeader,
  Skeleton,
  Text,
} from '~/components/ui';
import colors from '~/components/ui/colors';
import { useCapabilities } from '~/features/capabilities/use-capabilities';
import { errorMessage, trpc } from '~/lib/api';
import { formatMoney } from '~/lib/format';
import { translate } from '~/lib/i18n';
import { screenLoad, useAnnounceLoaded } from '~/lib/notify';
import {
  deadlineCaptionKey,
  deadlineTone,
  forecastMax,
  hasForecast,
  hasVatFigures,
  isVatExempt,
  safeAmount,
  toneClass,
  weekAmountText,
  weekBarFraction,
} from './cashflow-logic';
import { ForecastTotal } from './forecast-total';

export function CashflowScreen() {
  const caps = useCapabilities();
  // Begge procedures er `protectedProcedure`, men uden fakturaer har de intet at
  // vise. Samme modul-gate som web's widgets, så vejen ikke er en tom skærm.
  const enabled = caps.isEnabled('invoicing');
  const vat = trpc.vat.getVatOverview.useQuery(undefined, { enabled });
  const cash = trpc.cashflow.getCashflowForecast.useQuery(undefined, { enabled });
  // Moms og prognose er to regioner med hver sit skeleton på én skærm: ét stop,
  // når den sidste er færdig. Uden `invoicing` er begge kald slået fra, og et
  // slået-fra kald tæller som færdigt — så den tomme skærm tier helt rigtigt.
  useAnnounceLoaded(screenLoad(vat, cash), translate('common.loaded'));
  const refreshing = vat.isRefetching || cash.isRefetching;
  const refresh = React.useCallback(() => {
    void vat.refetch();
    void cash.refetch();
  }, [vat, cash]);

  return (
    <Screen
      title={translate('cashflow.title')}
      back
      refreshing={refreshing}
      onRefresh={refresh}
    >
      {enabled
        ? (
            <>
              <VatSection
                data={vat.data}
                isLoading={vat.isLoading}
                isError={vat.isError}
                error={vat.error}
                onRetry={() => void vat.refetch()}
              />
              <ForecastSection
                data={cash.data}
                isLoading={cash.isLoading}
                isError={cash.isError}
                error={cash.error}
                onRetry={() => void cash.refetch()}
              />
            </>
          )
        : (
            <EmptyState
              icon={Receipt}
              title={translate('cashflow.no_module_title')}
              description={translate('cashflow.no_module_body')}
              compact
            />
          )}
    </Screen>
  );
}

type SectionProps<T> = {
  data: T | undefined;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  onRetry: () => void;
};

function VatSection({ data, isLoading, isError, error, onRetry }: SectionProps<VatOverview>) {
  const caps = useCapabilities();
  const router = useRouter();
  // Virksomhedsprofilen er `orgAdminProcedure` i web, så en medarbejder må ikke
  // få en knap der svarer 403.
  const canEdit = !caps.hasOrg || caps.isAdmin;

  if (isLoading)
    return <Skeleton className="h-40" />;
  if (isError || !data)
    return <ErrorState message={errorMessage(error)} onRetry={onRetry} />;

  if (isVatExempt(data)) {
    return (
      <Card
        accessible
        accessibilityLabel={translate('cashflow.vat_exempt')}
        className="mb-4"
        onPress={canEdit ? () => router.push('/settings/company') : undefined}
        testID="cashflow-vat-exempt"
      >
        <Text className="text-sm text-foreground" tx="cashflow.vat_exempt" />
        {canEdit ? <Text className="mt-1 text-xs text-primary-600 dark:text-primary-400" tx="cashflow.vat_exempt_cta" /> : null}
      </Card>
    );
  }

  if (!hasVatFigures(data)) {
    return (
      <EmptyState
        icon={Receipt}
        title={translate('cashflow.vat_empty_title')}
        description={translate('cashflow.vat_empty_body')}
        action={{ label: translate('cashflow.create_invoice'), onPress: () => router.push('/invoices/new'), testID: 'cashflow-vat-empty-action' }}
        compact
      />
    );
  }

  const { currentPeriod, nextDeadline } = data;
  const tone = deadlineTone(nextDeadline.daysUntil);
  return (
    <View className="mb-6">
      <SectionHeader title={translate('cashflow.vat_title')} />
      <Card accessible accessibilityLabel={vatLabel(data)} testID="cashflow-vat">
        <Text className="text-xs text-muted-foreground">{currentPeriod.label}</Text>
        <Text className="mt-0.5 text-xs text-muted-foreground" tx="cashflow.vat_to_pay" />
        <Text
          className="text-3xl font-semibold tracking-tight text-violet-600 dark:text-violet-300"
          style={{ fontVariant: ['tabular-nums'] }}
          testID="cashflow-vat-amount"
        >
          {formatMoney(currentPeriod.vat)}
        </Text>
        <View className="mt-3 gap-2 border-t border-border pt-3">
          <Row label={translate('cashflow.vat_invoiced')} value={formatMoney(currentPeriod.invoicedExVat)} />
          <Row label={translate('cashflow.ytd')} value={formatMoney(data.ytdVat)} />
          <DeadlineRow label={nextDeadline.label} daysUntil={nextDeadline.daysUntil} tone={tone} />
        </View>
      </Card>
    </View>
  );
}

function ForecastSection({ data, isLoading, isError, error, onRetry }: SectionProps<CashflowForecast>) {
  const router = useRouter();
  if (isLoading)
    return <Skeleton className="h-48" />;
  if (isError || !data)
    return <ErrorState message={errorMessage(error)} onRetry={onRetry} />;

  if (!hasForecast(data)) {
    return (
      <EmptyState
        icon={TrendingUp}
        title={translate('cashflow.forecast_empty_title')}
        description={translate('cashflow.forecast_empty_body')}
        action={{ label: translate('cashflow.see_outstanding'), onPress: () => router.push('/invoices'), testID: 'cashflow-forecast-empty-action' }}
        compact
      />
    );
  }

  return (
    <View>
      <SectionHeader title={translate('cashflow.forecast_title')} />
      {safeAmount(data.totalOverdue) > 0 ? <OverdueBanner forecast={data} /> : null}
      <Card className="gap-3" testID="cashflow-forecast">
        {data.weeks.map(week => <WeekBar key={week.weekNumber} week={week} max={forecastMax(data.weeks)} />)}
        <ForecastTotal forecast={data} />
      </Card>
    </View>
  );
}

function OverdueBanner({ forecast }: { forecast: CashflowForecast }) {
  const { theme } = useUniwind();
  // Kun beløbet. Serverens uge-1-liste kan ikke skelne en forfalden faktura fra
  // en der først forfalder senere i samme uge, så et antal fakturaer ville være
  // en påstand om penge, der ikke er dokumenteret.
  const text = translate('cashflow.overdue', { amount: formatMoney(forecast.totalOverdue) });
  return (
    <Card
      accessible
      accessibilityLabel={text}
      className="mb-2 flex-row items-center gap-2 border-danger-200 bg-danger-50 dark:border-danger-900 dark:bg-danger-900/20"
      testID="cashflow-overdue"
    >
      <AlertTriangle size={18} color={colors.danger[theme === 'dark' ? 400 : 600]} />
      <Text className="flex-1 text-sm text-danger-900 dark:text-danger-100">{text}</Text>
    </Card>
  );
}

function WeekBar({ week, max }: { week: CashflowForecast['weeks'][number]; max: number }) {
  const overdue = safeAmount(week.overdueAmount) > 0;
  const pct = Math.round(weekBarFraction(week.expectedAmount, max) * 100);
  const name = translate('cashflow.week', { number: week.weekNumber });
  return (
    <View accessible accessibilityLabel={`${name}: ${weekAmountText(week.expectedAmount)}`} testID={`cashflow-week-${week.weekNumber}`}>
      <View className="flex-row items-center gap-2">
        <Text className="w-12 shrink-0 text-sm font-medium text-muted-foreground">{name}</Text>
        <View className="h-5 flex-1 overflow-hidden rounded-sm bg-muted">
          <View
            className={twMerge('h-full rounded-sm', overdue ? 'bg-danger-500' : 'bg-primary-600')}
            style={{ width: `${pct}%` }}
          />
        </View>
        <Text className="w-24 shrink-0 text-right text-sm font-medium text-foreground" style={{ fontVariant: ['tabular-nums'] }}>
          {weekAmountText(week.expectedAmount)}
        </Text>
      </View>
    </View>
  );
}

function DeadlineRow({ label, daysUntil, tone }: { label: string; daysUntil: number; tone: DeadlineTone }) {
  const caption = translate(deadlineCaptionKey(daysUntil), { count: daysUntil });
  return (
    <View className="flex-row items-center justify-between">
      <Text className="text-sm text-muted-foreground" tx="cashflow.next_deadline" />
      <Text className={twMerge('text-sm font-medium', toneClass(tone))}>
        {label}
        {' '}
        {caption}
      </Text>
    </View>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row items-center justify-between">
      <Text className="text-sm text-muted-foreground">{label}</Text>
      <Text className="text-sm font-medium text-foreground" style={{ fontVariant: ['tabular-nums'] }}>{value}</Text>
    </View>
  );
}

function vatLabel(vat: Extract<VatOverview, { isVatExempt: false }>): string {
  return [
    translate('cashflow.vat_to_pay'),
    formatMoney(vat.currentPeriod.vat),
    translate('cashflow.vat_invoiced'),
    formatMoney(vat.currentPeriod.invoicedExVat),
    translate('cashflow.next_deadline'),
    `${vat.nextDeadline.label} ${translate(deadlineCaptionKey(vat.nextDeadline.daysUntil), { count: vat.nextDeadline.daysUntil })}`,
  ].join('. ');
}
