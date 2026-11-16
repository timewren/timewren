import { Building2 } from 'lucide-react-native';
import * as React from 'react';
import { EmptyState, ErrorState } from '~/components/ui/empty-state';
import { Screen } from '~/components/ui/screen';
import { ListSkeleton } from '~/components/ui/skeleton';
import { useCapabilities } from '~/features/capabilities/use-capabilities';
import { translate } from '~/lib/i18n';

type EnterpriseGateProps = {
  title: string;
  back?: boolean;
  children: React.ReactNode;
};

/**
 * Viser kun indholdet når org'en har enterprise-modulet. Ellers en venlig
 * tom tilstand — gated procedures kaldes aldrig blindt (de giver 403).
 */
export function EnterpriseGate({ title, back, children }: EnterpriseGateProps) {
  const caps = useCapabilities();
  if (caps.isLoading) {
    return (
      <Screen title={title} back={back}>
        <ListSkeleton />
      </Screen>
    );
  }
  if (caps.isError) {
    return (
      <Screen title={title} back={back}>
        <ErrorState onRetry={caps.refetch} />
      </Screen>
    );
  }
  if (!caps.isEnterprise) {
    return (
      <Screen title={title} back={back} scroll={false}>
        <EmptyState
          icon={Building2}
          title={translate('enterprise.locked.title')}
          description={translate('enterprise.locked.description')}
        />
      </Screen>
    );
  }
  return <>{children}</>;
}
