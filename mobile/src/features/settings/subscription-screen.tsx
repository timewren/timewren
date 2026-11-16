import { CreditCard } from 'lucide-react-native';
import { View } from 'react-native';
import { Badge, Card, EmptyState, ErrorState, ListRow, ListSkeleton, Screen, SectionHeader, Text } from '~/components/ui';
import { StoreSubscriptionSection } from '~/features/billing/store-subscription-section';
import { errorMessage, trpc } from '~/lib/api';
import { formatDateShort, formatMoney } from '~/lib/format';
import { translate } from '~/lib/i18n';
import { screenLoad, useAnnounceLoaded } from '~/lib/notify';

// free/trial_expired: permanent gratis-niveau (web-PR om freemium) og udløbet prøve
const STATUS_KEYS = ['active', 'trialing', 'canceled', 'past_due', 'free', 'trial_expired'] as const;
type StatusKey = typeof STATUS_KEYS[number];

function statusLabel(status: string | null | undefined): string {
  const key = STATUS_KEYS.find(k => k === status) ?? null;
  return key ? translate(`settings.subscription.status_${key}`) : (status ?? '–');
}

const STATUS_TONE: Record<StatusKey, 'success' | 'primary' | 'default' | 'danger'> = {
  active: 'success',
  trialing: 'primary',
  canceled: 'default',
  past_due: 'danger',
  free: 'default',
  trial_expired: 'default',
};

/**
 * Abonnementet på kontoen og, når serveren har slået det til, køb af Privat og
 * Selvstændig i App Store/Google Play. Appen nævner aldrig andre steder at købe
 * (App Store 3.1.1/3.1.3, Google Play Payments).
 */
export function SubscriptionScreen() {
  const details = trpc.subscription.getDetails.useQuery();
  const usage = trpc.subscription.getUsageStats.useQuery();
  // To kald på én skærm: ét stop, når den sidste af dem er færdig.
  useAnnounceLoaded(screenLoad(details, usage), translate('common.loaded'));
  const sub = details.data;
  const tone = sub ? (STATUS_TONE[sub.status as StatusKey] ?? 'default') : 'default';

  return (
    <Screen title={translate('settings.subscription.title')} back>
      {details.isLoading
        ? <ListSkeleton rows={3} />
        : details.isError
          ? <ErrorState message={errorMessage(details.error)} onRetry={() => void details.refetch()} />
          : !sub
              ? <EmptyState icon={CreditCard} title={translate('settings.subscription.none')} compact />
              : (
                  <View>
                    <Card className="p-0">
                      <ListRow title={translate('settings.subscription.plan')} right={sub.planName} />
                      <ListRow title={translate('settings.subscription.status')} right={<Badge label={statusLabel(sub.status)} tone={tone} />} />
                      <ListRow title={translate('settings.subscription.price')} right={sub.displayPrice} />
                      <ListRow title={translate('settings.subscription.seats')} right={String(sub.seatCount ?? sub.includedSeats)} />
                      <ListRow
                        title={translate('settings.subscription.next_billing')}
                        right={sub.nextBillingDate ? formatDateShort(sub.nextBillingDate) : '–'}
                        last
                      />
                    </Card>
                    {sub.status === 'trialing'
                      ? <Text className="mt-2 text-sm text-muted-foreground">{translate('settings.subscription.trial_days', { count: sub.trialDaysRemaining })}</Text>
                      : null}
                    {sub.status === 'free' || sub.status === 'trial_expired'
                      ? (
                          <Card className="mt-3">
                            <Text className="text-sm font-medium text-foreground" tx="settings.subscription.free_title" />
                            <Text className="mt-1 text-[13px] text-muted-foreground" tx="settings.subscription.free_body" />
                          </Card>
                        )
                      : null}
                  </View>
                )}
      <StoreSubscriptionSection />
      {usage.isLoading
        ? <ListSkeleton rows={2} />
        : usage.isError
          ? <ErrorState message={errorMessage(usage.error)} onRetry={() => void usage.refetch()} />
          : usage.data
            ? (
                <View>
                  <SectionHeader title={translate('settings.subscription.usage')} />
                  <Card className="p-0">
                    <ListRow title={translate('settings.subscription.tracked_value')} right={formatMoney(usage.data.totalTrackedValue)} />
                    <ListRow title={translate('settings.subscription.invoiced')} right={formatMoney(usage.data.totalInvoiced)} last />
                  </Card>
                </View>
              )
            : null}
    </Screen>
  );
}
