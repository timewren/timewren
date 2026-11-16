import type { CashflowForecast } from './cashflow-logic';

import * as React from 'react';
import { View } from 'react-native';
import { Text } from '~/components/ui';
import { formatMoney } from '~/lib/format';
import { translate } from '~/lib/i18n';
import { expectedWeeksKey, forecastCoverage } from './cashflow-logic';

/**
 * Summen under ugebjælkerne.
 *
 * Labelen siger de uger serveren faktisk har sendt og viser den daterække,
 * de dækker — ikke et "næste 30 dage", der kun holder mandag til torsdag.
 * Begge dele læses fra `forecastCoverage`, så de kan ikke glide fra
 * `FORECAST_WEEKS` i web's `forecast.ts`.
 */
export function ForecastTotal({ forecast }: { forecast: CashflowForecast }) {
  const coverage = forecastCoverage(forecast.weeks);
  const heading = translate(expectedWeeksKey(coverage.weekCount), { count: coverage.weekCount });
  const amount = formatMoney(forecast.totalExpected);
  const spoken = [heading, coverage.range, amount].filter(Boolean).join(', ');
  return (
    <View
      accessible
      accessibilityLabel={spoken}
      className="mt-1 gap-0.5 border-t border-border pt-3"
      testID="cashflow-forecast-summary"
    >
      <View className="flex-row items-center justify-between">
        <Text className="text-sm text-muted-foreground">{heading}</Text>
        <Text className="text-base font-semibold text-foreground" style={{ fontVariant: ['tabular-nums'] }} testID="cashflow-forecast-total">
          {amount}
        </Text>
      </View>
      {coverage.range
        ? <Text className="text-xs text-muted-foreground">{coverage.range}</Text>
        : null}
    </View>
  );
}
