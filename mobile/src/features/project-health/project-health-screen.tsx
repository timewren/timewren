import type { BudgetAlert, ProjectHealth } from './project-health-logic';
import { useRouter } from 'expo-router';
import { Gauge } from 'lucide-react-native';
import * as React from 'react';
import { Pressable, View } from 'react-native';
import { twMerge } from 'tailwind-merge';
import {
  Badge,
  Card,
  EmptyState,
  ErrorState,
  ListRow,
  Screen,
  SectionHeader,
  Skeleton,
  Text,
} from '~/components/ui';
import { useCapabilities } from '~/features/capabilities/use-capabilities';
import { projectHref } from '~/features/clients/hrefs';
import { errorMessage, trpc } from '~/lib/api';
import { formatHours } from '~/lib/format';
import { translate } from '~/lib/i18n';
import { useAnnounceLoaded } from '~/lib/notify';
import {
  ALERT_CRITICAL,
  alertLabelKey,
  alertTone,
  attentionCaptionKey,
  attentionCount,
  barFraction,
  budgetUsageLine,
  clientLine,
  usageText,
} from './project-health-logic';

/**
 * Projektsundhed på tværs af kunder (Mere → Projektsundhed).
 *
 * Begge kald er `protectedProcedure` i web og læser de samme projekter som
 * projektlisten, så modul-gaten følger `projects` — ellers ville skærmen være
 * tom for en konto uden projekter. Rækkefølgen og timerne kommer fra serveren;
 * vi genberejner ingen af delene, så skærmen aldrig kan afvige fra web.
 */
export function ProjectHealthScreen() {
  const caps = useCapabilities();
  const enabled = caps.isEnabled('projects');
  const alerts = trpc.projects.getBudgetAlerts.useQuery(undefined, { enabled });
  const health = trpc.projects.healthStatus.useQuery(undefined, { enabled });
  useAnnounceLoaded(
    { isLoading: alerts.isLoading || health.isLoading, isError: alerts.isError || health.isError },
    translate('common.loaded'),
  );
  const refreshing = alerts.isRefetching || health.isRefetching;
  const refresh = React.useCallback(() => {
    void alerts.refetch();
    void health.refetch();
  }, [alerts, health]);

  if (!enabled) {
    return (
      <Screen back title={translate('project_health.title')}>
        <EmptyState
          icon={Gauge}
          title={translate('project_health.no_module_title')}
          description={translate('project_health.no_module_body')}
          compact
        />
      </Screen>
    );
  }

  const rows = health.data ?? [];
  const attention = attentionCount(rows);
  const isLoading = health.isLoading || alerts.isLoading;
  const isError = health.isError || alerts.isError;

  return (
    <Screen
      back
      title={translate('project_health.title')}
      subtitle={attention > 0 ? translate(attentionCaptionKey(attention), { count: attention, pct: ALERT_CRITICAL }) : undefined}
      refreshing={refreshing}
      onRefresh={refresh}
    >
      {isLoading
        ? (
            <View className="gap-3">
              <Skeleton className="h-24" />
              <Skeleton className="h-56" />
            </View>
          )
        : isError
          ? <ErrorState message={errorMessage(health.error ?? alerts.error)} onRetry={refresh} />
          : (
              <>
                {alerts.data && alerts.data.length > 0 ? <AlertSection alerts={alerts.data} /> : null}
                <HealthSection rows={rows} />
              </>
            )}
    </Screen>
  );
}

function AlertSection({ alerts }: { alerts: readonly BudgetAlert[] }) {
  const router = useRouter();
  return (
    <View className="mb-6">
      <SectionHeader title={translate('project_health.alerts_title')} />
      <Card className="p-0" testID="project-health-alerts">
        {alerts.map((alert, index) => (
          <AlertRow
            key={alert.id}
            alert={alert}
            last={index === alerts.length - 1}
            onPress={() => router.push(projectHref(alert.id))}
          />
        ))}
      </Card>
    </View>
  );
}

function AlertRow({ alert, last, onPress }: { alert: BudgetAlert; last: boolean; onPress: () => void }) {
  const labelKey = alertLabelKey(alert.severity);
  const label = labelKey ? translate(labelKey) : '';
  const usage = translate('project_health.alert_usage', {
    used: formatHours(alert.hoursUsed),
    budget: formatHours(alert.budgetHours),
  });
  return (
    <Pressable
      onPress={onPress}
      className={twMerge('active:bg-muted', last ? '' : 'border-b border-border')}
      accessibilityRole="button"
      accessibilityLabel={`${alert.projectName}. ${label}. ${usage}. ${alert.budgetPercentage} %`}
      testID={`project-health-alert-${alert.id}`}
    >
      <View className="flex-row items-center gap-3 px-4 py-3">
        <View className="flex-1">
          <Text className="text-[15px] font-medium text-foreground" numberOfLines={1}>{alert.projectName}</Text>
          <Text className="text-[13px] text-muted-foreground" numberOfLines={1}>{usage}</Text>
        </View>
        <Badge label={`${label} · ${alert.budgetPercentage} %`} tone={alertTone(alert.severity)} />
      </View>
    </Pressable>
  );
}

function HealthSection({ rows }: { rows: readonly ProjectHealth[] }) {
  const router = useRouter();
  if (rows.length === 0) {
    return (
      <EmptyState
        icon={Gauge}
        title={translate('project_health.empty_title')}
        description={translate('project_health.empty_body')}
        action={{ label: translate('project_health.empty_action'), onPress: () => router.push('/projects') }}
        compact
      />
    );
  }
  return (
    <View>
      <SectionHeader title={translate('project_health.health_title')} />
      <Card className="p-0" testID="project-health-list">
        {rows.map((row, index) => (
          <HealthRow
            key={row.id}
            project={row}
            last={index === rows.length - 1}
            onPress={() => router.push(projectHref(row.id))}
          />
        ))}
      </Card>
    </View>
  );
}

function HealthRow({ project, last, onPress }: { project: ProjectHealth; last: boolean; onPress: () => void }) {
  const client = clientLine(project);
  // Timer uden "t" — enheden står i overskriftens forklaring, ellers bliver
  // "4,5 t af 10 t · 45 %" for langt til 360 px.
  const usage = budgetUsageLine(project, h => formatHours(h, { unit: false }));
  const percent = usageText(project);
  return (
    <ListRow
      title={project.name}
      subtitle={[client, usage].filter(Boolean).join(' · ')}
      right={(
        <View className="items-end">
          <Text className="text-[15px] font-medium text-foreground" style={{ fontVariant: ['tabular-nums'] }}>{percent}</Text>
          {percent === '—'
            ? <Text className="text-[11px] text-muted-foreground">{translate('project_health.no_budget')}</Text>
            : <BudgetBar project={project} />}
        </View>
      )}
      onPress={onPress}
      last={last}
      testID={`project-health-row-${project.id}`}
    />
  );
}

function BudgetBar({ project }: { project: ProjectHealth }) {
  const fill = project.healthStatus === 'red'
    ? 'bg-danger-500'
    : project.healthStatus === 'yellow' ? 'bg-warning-500' : 'bg-primary-600';
  return (
    <View className="mt-1 h-1 w-14 overflow-hidden rounded-sm bg-muted">
      <View className={twMerge('h-full rounded-sm', fill)} style={{ width: `${Math.round(barFraction(project) * 100)}%` }} />
    </View>
  );
}
