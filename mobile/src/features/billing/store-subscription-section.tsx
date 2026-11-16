import type { StoreOffer } from './billing-logic';
import type { StoreCycle, StorePlatform, StoreSubscription } from './store-billing-api';
import * as WebBrowser from 'expo-web-browser';
import * as React from 'react';
import { ActivityIndicator, View } from 'react-native';
import { Badge, Button, Card, ErrorState, ListRow, ListSkeleton, SectionHeader, Segmented, Text } from '~/components/ui';
import { APPLE_EULA_URL, PRIVACY_URL, TERMS_URL } from '~/features/more/links';
import { formatDateShort } from '~/lib/format';
import { translate } from '~/lib/i18n';
import { findOffer, isOtherStore, liveStoreSource, PLAN_TIERS, purchaseBlockedKey } from './billing-logic';
import { useStoreBilling } from './use-store-billing';

function open(url: string) {
  void WebBrowser.openBrowserAsync(url);
}

function isStoreSource(current: StoreSubscription): boolean {
  return liveStoreSource(current) !== null;
}

function planTitle(planTier: string | null): string {
  return planTier === 'privat' || planTier === 'solo' ? translate(`billing.plans.${planTier}.title`) : (planTier ?? '–');
}

/** Planen købt i butikken: hvilken, hvor og hvornår den fornyes eller udløber. */
function CurrentStorePlan({ current }: { current: StoreSubscription }) {
  // Et udløbet køb (TimeTrack-status canceled) skal ikke stå med "Fornyes" og en gammel dato.
  const date = current.currentPeriodEnd && isStoreSource(current) ? formatDateShort(current.currentPeriodEnd) : null;
  const period = date ? translate(current.cancelAtPeriodEnd ? 'billing.ends_on' : 'billing.renews_on', { date }) : undefined;
  return (
    <Card className="p-0">
      <ListRow
        title={planTitle(current.planTier)}
        subtitle={translate(current.source === 'apple' ? 'billing.source_apple' : 'billing.source_google')}
        right={period}
        last
        testID="billing-current"
      />
    </Card>
  );
}

type PlanCardProps = {
  offer: StoreOffer;
  isCurrent: boolean;
  canBuy: boolean;
  busy: boolean;
  onBuy: (offer: StoreOffer) => void;
};

function PlanCard({ offer, isCurrent, canBuy, busy, onBuy }: PlanCardProps) {
  const price = translate(offer.cycle === 'monthly' ? 'billing.per_month' : 'billing.per_year', { price: offer.displayPrice });
  return (
    <Card className="mt-3" testID={`billing-plan-${offer.planTier}`}>
      <View className="flex-row items-center justify-between">
        <Text className="text-base font-semibold text-foreground" tx={`billing.plans.${offer.planTier}.title`} />
        {isCurrent ? <Badge label={translate('billing.current_plan')} tone="success" /> : null}
      </View>
      <Text className="mt-1 text-[13px] text-muted-foreground" tx={`billing.plans.${offer.planTier}.body`} />
      <Text className="mt-2 text-sm font-medium text-foreground">{price}</Text>
      {canBuy
        ? (
            <Button
              className="mt-3 mb-0"
              label={translate('billing.subscribe')}
              onPress={() => onBuy(offer)}
              loading={busy}
              disabled={busy}
              testID={`billing-buy-${offer.planTier}-${offer.cycle}`}
            />
          )
        : null}
    </Card>
  );
}

function LegalLinks({ platform }: { platform: StorePlatform }) {
  return (
    <View>
      <Text className="mt-3 text-xs text-muted-foreground" tx="billing.auto_renew" />
      <Card className="mt-3 p-0">
        <ListRow title={translate('billing.terms')} onPress={() => open(platform === 'ios' ? APPLE_EULA_URL : TERMS_URL)} testID="billing-terms" />
        <ListRow title={translate('billing.privacy')} onPress={() => open(PRIVACY_URL)} last testID="billing-privacy" />
      </Card>
    </View>
  );
}

/**
 * Køb af Privat og Selvstændig i App Store/Google Play. Købsknapper vises kun, når serveren
 * tager imod et køb fra kontoen (`canPurchase`); ellers står der hvorfor. Har kontoen et
 * abonnement fra websitet, vises det kun som tekst, uden link. Priserne er altid butikkens egne.
 */
export function StoreSubscriptionSection() {
  const billing = useStoreBilling();
  const [cycle, setCycle] = React.useState<StoreCycle>('monthly');
  const data = billing.config.data;
  if (!data || !billing.platform)
    return null;
  if (data.current.source === 'web') {
    return (
      <Card className="mt-3" testID="billing-web-managed">
        <Text className="text-sm text-foreground" tx="billing.account_managed" />
      </Card>
    );
  }
  const current = data.current;
  // Købt i den anden butik: vis planen, men intet køb og ingen genvej til den forkerte butik.
  if (data.enabled && isOtherStore(data, billing.platform)) {
    return (
      <View testID="billing-section">
        <SectionHeader title={translate('billing.title')} />
        <CurrentStorePlan current={current} />
      </View>
    );
  }
  // Serveren tager ikke imod køb fra kontoen: ingen købsknapper, kun en forklaring. Et
  // eksisterende abonnement fra denne butik kan stadig administreres.
  const blockedKey = purchaseBlockedKey(data);
  if (blockedKey) {
    const ownStore = isStoreSource(current) && !isOtherStore(data, billing.platform);
    // Køb slået fra på serveren og intet at administrere: ingen flade, der kun siger "ikke nu".
    if (!data.enabled && !ownStore)
      return null;
    return (
      <View testID="billing-section">
        <SectionHeader title={translate('billing.title')} />
        {ownStore ? <CurrentStorePlan current={current} /> : null}
        <Card className="mt-3" testID="billing-blocked">
          <Text className="text-sm text-foreground" tx={blockedKey} />
        </Card>
        {ownStore
          ? (
              <Card className="mt-3 p-0">
                <ListRow title={translate('billing.manage')} onPress={billing.manage} last testID="billing-manage" />
              </Card>
            )
          : null}
      </View>
    );
  }
  if (!billing.buyable)
    return null;
  const offers = billing.offers.data ?? [];
  const busy = billing.purchasing || billing.restoring;
  // Butikken kender ingen af produkterne (fx før de er godkendt i App Store Connect): hellere
  // ingen købsflade end en halv med fejlboks, gendan og vilkår (Apple 2.1).
  if (billing.offers.isSuccess && offers.length === 0 && !isStoreSource(current))
    return null;

  return (
    <View testID="billing-section">
      <SectionHeader title={translate('billing.title')} />
      {isStoreSource(current) ? <CurrentStorePlan current={current} /> : null}
      <Segmented
        className="mt-3"
        value={cycle}
        onChange={setCycle}
        options={[
          { value: 'monthly', label: translate('billing.cycle_monthly') },
          { value: 'yearly', label: translate('billing.cycle_yearly') },
        ]}
        testID="billing-cycle"
      />
      {billing.offers.isLoading
        ? <ListSkeleton rows={2} />
        : billing.offers.isError || offers.length === 0
          ? <ErrorState message={translate('billing.products_unavailable')} onRetry={() => void billing.offers.refetch()} />
          : PLAN_TIERS.map((tier) => {
              const offer = findOffer(offers, tier, cycle);
              if (!offer)
                return null;
              const isCurrent = isStoreSource(current) && current.planTier === tier;
              // iOS kender den præcise periode; på Android lader vi Google Play afgøre det.
              const exact = billing.platform === 'ios' && isStoreSource(current) && current.productId === offer.productId;
              return <PlanCard key={tier} offer={offer} isCurrent={isCurrent} canBuy={!exact} busy={busy} onBuy={billing.buy} />;
            })}
      {billing.pending ? <Text className="mt-3 text-[13px] text-muted-foreground" tx="billing.status_pending" /> : null}
      <Card className="mt-3 p-0">
        <ListRow
          title={translate('billing.restore')}
          right={billing.restoring ? <ActivityIndicator /> : undefined}
          onPress={busy ? undefined : () => void billing.restore()}
          testID="billing-restore"
        />
        <ListRow title={translate('billing.manage')} onPress={billing.manage} last testID="billing-manage" />
      </Card>
      <LegalLinks platform={billing.platform} />
    </View>
  );
}
