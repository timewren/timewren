import { useRouter } from 'expo-router';
import { CalendarClock } from 'lucide-react-native';
import * as React from 'react';
import { View } from 'react-native';
import { Card, EmptyState, ListRow, SectionHeader, Text } from '~/components/ui';
import { useCapabilities } from '~/features/capabilities/use-capabilities';
import { isVatDeadline } from '~/features/cashflow/cashflow-logic';
import { trpc } from '~/lib/api';
import { formatDateShort } from '~/lib/format';
import { translate } from '~/lib/i18n';
import { SectionState } from './section-state';

const LOOK_AHEAD_DAYS = 60;

/** Kommende danske frister (moms, A-skat, årsrapport …) ud fra virksomhedsprofilen. */
export function Deadlines() {
  const router = useRouter();
  const caps = useCapabilities();
  const query = trpc.user.getUpcomingDeadlines.useQuery({ lookAheadDays: LOOK_AHEAD_DAYS });
  const deadlines = (query.data?.deadlines ?? []).slice(0, 5);
  // `user.updateCompanyInfo` er `orgAdminProcedure`, så kun ejere/admin kan
  // sætte profilen. En medarbejder skal ikke trykke på en knap, der giver 403.
  const canEdit = !caps.hasOrg || caps.isAdmin;
  // En moms-frist viser her kun datoen. Skærmen bag den har beløbet, så rækken
  // skal være trykbart — ellers måtte brugeren lede efter det andet sted.
  const showVatAmount = caps.isEnabled('invoicing');
  const openAmounts = React.useCallback(() => router.push('/cashflow'), [router]);

  return (
    <View>
      <SectionHeader title={translate('overview.deadlines')} />
      <SectionState isLoading={query.isLoading} isError={query.isError} error={query.error} onRetry={() => void query.refetch()} tiles={1}>
        {query.data?.needsSetup
          ? (
              <Card
                onPress={canEdit ? () => router.push('/settings/company') : undefined}
                testID={canEdit ? 'deadlines-setup' : undefined}
              >
                <Text className="text-sm text-muted-foreground">
                  {translate(canEdit ? 'overview.deadlines_setup' : 'overview.deadlines_setup_admin')}
                </Text>
              </Card>
            )
          : deadlines.length === 0
            ? (
                <Card>
                  <EmptyState icon={CalendarClock} title={translate('overview.deadlines_empty', { days: LOOK_AHEAD_DAYS })} compact />
                </Card>
              )
            : (
                <Card className="p-0">
                  {deadlines.map((d, i) => (
                    <ListRow
                      key={d.id}
                      title={d.title}
                      subtitle={d.description}
                      right={formatDateShort(d.date)}
                      onPress={showVatAmount && isVatDeadline(d.id) ? openAmounts : undefined}
                      testID={showVatAmount && isVatDeadline(d.id) ? `deadline-vat-${d.id}` : undefined}
                      last={i === deadlines.length - 1}
                    />
                  ))}
                </Card>
              )}
      </SectionState>
    </View>
  );
}
