import type { PrepaidLike } from '../prepaid-logic';
import * as React from 'react';
import { View } from 'react-native';
import { twMerge } from 'tailwind-merge';
import { Badge, Card, Text } from '~/components/ui';
import { formatHours, formatMoney } from '~/lib/format';
import { translate } from '~/lib/i18n';
import { expiryText, prepaidStatus } from '../prepaid-logic';

export type PrepaidCardItem = PrepaidLike & {
  id: string;
  name: string;
  hourlyRate?: string | number | null;
  hideValue?: boolean;
  client?: { name: string } | null;
};

type Props = {
  pkg: PrepaidCardItem;
  onPress?: () => void;
  /** Skjul kundenavn (fx på kunde-detalje hvor kunden er givet) */
  hideClient?: boolean;
};

const BAR_BG: Record<'violet' | 'warning' | 'danger', string> = {
  violet: 'bg-violet-500',
  warning: 'bg-warning-500',
  danger: 'bg-danger-500',
};

/** Saldo-bar: violet som standard, gul ved lav saldo, rød ved opbrugt. */
export function BalanceBar({ fraction, tone, a11yLabel }: { fraction: number; tone: 'violet' | 'warning' | 'danger'; a11yLabel?: string }) {
  const pct = Math.round(Math.min(1, Math.max(0, Number.isFinite(fraction) ? fraction : 0)) * 100);
  return (
    <View
      className="h-2 w-full overflow-hidden rounded-full bg-muted"
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 100, now: pct }}
      accessibilityLabel={a11yLabel}
    >
      <View className={twMerge('h-2 rounded-full', BAR_BG[tone])} style={{ width: `${pct}%` }} />
    </View>
  );
}

export function ExpiryBadge({ pkg }: { pkg: PrepaidLike }) {
  const label = expiryText(pkg);
  if (!label)
    return null;
  return <Badge label={label} tone={prepaidStatus(pkg).expiryTone} />;
}

export function PrepaidCard({ pkg, onPress, hideClient }: Props) {
  const s = prepaidStatus(pkg);
  const barTone = s.balanceTone === 'danger' ? 'danger' : s.balanceTone === 'warning' ? 'warning' : 'violet';
  const showValue = !pkg.hideValue && Boolean(pkg.hourlyRate);
  const remainingValue = s.remainingHours * Number.parseFloat(String(pkg.hourlyRate ?? 0));
  const remainingText = translate('prepaid.remaining', { remaining: formatHours(s.remainingHours), total: formatHours(s.totalHours) });
  return (
    <Card
      onPress={onPress}
      testID={`prepaid-card-${pkg.id}`}
      // Hvert felt kortet viser skal høres: navn, kunde, saldo, pris og udløb
      a11yLabel={[
        pkg.name,
        !hideClient ? pkg.client?.name : null,
        remainingText,
        showValue ? formatMoney(remainingValue) : null,
        expiryText(pkg),
        s.isDepleted ? translate('prepaid.depleted') : s.isLowBalance ? translate('prepaid.low_balance') : null,
      ].filter(Boolean).join(', ')}
    >
      <View className="flex-row items-start justify-between gap-3">
        <View className="flex-1">
          <Text className="text-base font-semibold text-foreground" numberOfLines={1}>{pkg.name}</Text>
          {!hideClient && pkg.client?.name
            ? <Text className="text-sm text-muted-foreground" numberOfLines={1}>{pkg.client.name}</Text>
            : null}
        </View>
        <View className="items-end gap-1">
          <ExpiryBadge pkg={pkg} />
          {s.isDepleted
            ? <Badge label={translate('prepaid.depleted')} tone="danger" />
            : s.isLowBalance ? <Badge label={translate('prepaid.low_balance')} tone="warning" /> : null}
        </View>
      </View>
      <View className="mt-3">
        <BalanceBar fraction={s.fraction} tone={barTone} />
        <View className="mt-1.5 flex-row justify-between">
          <Text className="text-sm font-medium text-violet-600 dark:text-violet-300">{remainingText}</Text>
          {showValue
            ? <Text className="text-sm text-muted-foreground">{formatMoney(remainingValue)}</Text>
            : null}
        </View>
      </View>
    </Card>
  );
}
