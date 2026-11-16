import type { RouterOutputs } from '~/api/app-router';
import { Banknote, Clock, Gauge, ListChecks } from 'lucide-react-native';
import * as React from 'react';
import { View } from 'react-native';
import { Card, StatTile, Text } from '~/components/ui';
import { BalanceBar } from '~/features/prepaid/components/prepaid-card';
import { formatHours, formatMoney } from '~/lib/format';
import { translate } from '~/lib/i18n';
import { healthTone, projectBudget } from '../project-logic';

type Project = RouterOutputs['projects']['getById'];
type Stats = RouterOutputs['projects']['getStats'];
type Monthly = RouterOutputs['projects']['monthlyBudget'];

type Props = {
  project: Project;
  stats: Stats | undefined;
  monthly: Monthly | undefined;
  isLoading: boolean;
};

/**
 * Nøgletallene på projektdetaljen med egen indlæsningstilstand.
 *
 * Her var det ikke bare tallene der løj: budgetkortet regner procenten ud fra
 * `stats?.totalHours ?? 0`, så mens kallet var i gang stod der "0 % brugt" i
 * grøn* tone med en tom bjælke under. Et budget der ser ud til at være
 * uproblematisk, fordi tallene ikke er kommet endnu, er værre end et tal der
 * mangler. Derfor får alle fire kort `loading`, og bjælken holdes væk indtil
 * der er noget at tegne den ud fra.
 */
export function ProjectStats({ project, stats, monthly, isLoading }: Props) {
  const budget = projectBudget({ fixedPrice: project.fixedPrice, hourlyRate: project.hourlyRate, usedHours: stats?.totalHours ?? 0 });
  const month = monthly?.months[0];
  return (
    <View className="mt-3 gap-2">
      <View className="flex-row gap-2">
        <StatTile label={translate('projects.stat_hours')} value={formatHours(stats?.totalHours ?? 0)} icon={Clock} loading={isLoading} />
        <StatTile label={translate('projects.stat_revenue')} value={formatMoney(stats?.revenue ?? 0)} icon={Banknote} tone="primary" loading={isLoading} />
      </View>
      <View className="flex-row gap-2">
        <StatTile label={translate('projects.stat_entries')} value={String(stats?.entriesCount ?? 0)} icon={ListChecks} loading={isLoading} />
        <StatTile
          label={translate('projects.budget_used')}
          value={budget.percentage === null ? '—' : `${budget.percentage} %`}
          hint={budget.budgetHours === null ? undefined : translate('projects.stat_budget_hint', { used: formatHours(budget.usedHours), budget: formatHours(budget.budgetHours) })}
          icon={Gauge}
          tone={healthTone(budget.health)}
          loading={isLoading}
        />
      </View>
      {budget.percentage !== null && !isLoading
        // Samme tal står i flisen over — bjælken skal bare give procenten til
        ? (
            <BalanceBar
              fraction={Math.min(1, budget.percentage / 100)}
              tone={budget.health === 'red' ? 'danger' : budget.health === 'yellow' ? 'warning' : 'violet'}
            />
          )
        : null}
      {monthly && month && monthly.budgetHours
        ? (
            <Card>
              <Text className="text-xs font-medium text-muted-foreground uppercase">{translate('projects.monthly_budget')}</Text>
              <Text className="mt-1 text-foreground">
                {translate('projects.monthly_used', { used: formatHours(month.hours), budget: formatHours(monthly.budgetHours) })}
              </Text>
              <View className="mt-2">
                <BalanceBar
                  fraction={Math.min(1, (month.percentage ?? 0) / 100)}
                  tone={(month.percentage ?? 0) >= 90 ? 'danger' : (month.percentage ?? 0) >= 75 ? 'warning' : 'violet'}
                  a11yLabel={translate('projects.monthly_budget')}
                />
              </View>
            </Card>
          )
        : null}
    </View>
  );
}
