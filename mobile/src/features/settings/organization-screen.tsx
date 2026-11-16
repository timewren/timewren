import { useQuery } from '@tanstack/react-query';
import { Building2, Check } from 'lucide-react-native';
import * as React from 'react';
import { View } from 'react-native';
import { useUniwind } from 'uniwind';
import { Avatar, Card, colors, EmptyState, ErrorState, ListRow, ListSkeleton, Screen, SectionHeader, Text } from '~/components/ui';
import { useCapabilities } from '~/features/capabilities/use-capabilities';
import { RoleBadge } from '~/features/team/components/members-list';
import { errorMessage, queryClient, trpc } from '~/lib/api';
import { authClient } from '~/lib/auth/client';
import { translate } from '~/lib/i18n';
import { showMessage, useAnnounceLoaded } from '~/lib/notify';

type OrgSummary = { id: string; name: string; slug?: string | null };

// better-auth's organization-klient er typet via $Infer, som brækker af expo-pluginens cast
// (se lib/auth/client.ts). Endpoints kaldes derfor direkte via $fetch — samme ruter som web.
async function listOrganizations(): Promise<OrgSummary[]> {
  const { data, error } = await authClient.$fetch<OrgSummary[]>('/organization/list');
  if (error)
    throw new Error(error.message ?? 'organization.list failed');
  return (data ?? []).map(o => ({ id: o.id, name: o.name, slug: o.slug }));
}

async function setActiveOrganization(organizationId: string): Promise<void> {
  const { error } = await authClient.$fetch('/organization/set-active', { method: 'POST', body: { organizationId } });
  if (error)
    throw new Error(error.message ?? 'setActive failed');
}

/** Aktiv organisation, medlemmer og skift mellem organisationer man er med i. */
export function OrganizationScreen() {
  const caps = useCapabilities();
  const orgs = useQuery({ queryKey: ['auth', 'organizations'], queryFn: listOrganizations });
  useAnnounceLoaded(orgs, translate('common.loaded'));
  const [switching, setSwitching] = React.useState<string | null>(null);
  const { theme } = useUniwind();

  const switchTo = async (org: OrgSummary) => {
    setSwitching(org.id);
    try {
      await setActiveOrganization(org.id);
      // Alt er org-scoped: ryd hele cachen så ingen skærm viser den gamle orgs data.
      queryClient.clear();
      showMessage({ message: translate('settings.organization.switched', { name: org.name }), type: 'success' });
    }
    catch {
      showMessage({ message: translate('settings.organization.switch_error'), type: 'danger' });
    }
    finally {
      setSwitching(null);
    }
  };

  const list = orgs.data ?? [];

  return (
    <Screen title={translate('settings.organization.title')} back>
      {!caps.hasOrg && caps.isLoading === false
        ? <EmptyState icon={Building2} title={translate('settings.organization.none')} description={translate('settings.organization.solo_hint')} compact />
        : (
            <View>
              <SectionHeader title={translate('settings.organization.current')} className="mt-0" />
              <Card className="p-0">
                <ListRow title={caps.orgName ?? '–'} right={<RoleBadge role={caps.role} />} last />
              </Card>
              <MembersSection />
            </View>
          )}
      {list.length > 1 || orgs.isLoading
        ? (
            <View>
              <SectionHeader title={translate('settings.organization.switch')} />
              {orgs.isLoading
                ? <ListSkeleton rows={2} />
                : orgs.isError
                  ? <ErrorState onRetry={() => void orgs.refetch()} />
                  : (
                      <Card className="p-0">
                        {list.map((org, i) => {
                          const active = caps.orgName === org.name;
                          return (
                            <ListRow
                              key={org.id}
                              title={org.name}
                              subtitle={active ? translate('settings.organization.active') : undefined}
                              right={active ? <Check size={18} color={colors.primary[theme === 'dark' ? 400 : 600]} /> : undefined}
                              onPress={active || switching !== null ? undefined : () => void switchTo(org)}
                              chevron={!active}
                              last={i === list.length - 1}
                              testID={`org-${org.id}`}
                            />
                          );
                        })}
                      </Card>
                    )}
            </View>
          )
        : null}
    </Screen>
  );
}

function MembersSection() {
  const members = trpc.organization.getMembers.useQuery();
  const list = members.data ?? [];
  // Som i `HistorySection`: et kald der fejler skal ikke svare "vi er kun
  // dig" ved at forsvinde.
  if (!members.isError && list.length === 0)
    return null;
  return (
    <View>
      <SectionHeader title={`${translate('settings.organization.members')}${members.isError ? '' : ` (${list.length})`}`} />
      <Card className="p-0">
        {members.isError
          ? <ErrorState message={errorMessage(members.error)} onRetry={() => void members.refetch()} />
          : list.map((m, i) => (
              <ListRow
                key={m.userId}
                title={m.name}
                subtitle={m.email}
                left={<Avatar name={m.name} image={m.image} size={32} />}
                right={<RoleBadge role={m.role} />}
                last={i === list.length - 1}
              />
            ))}
      </Card>
      {list.length === 1 ? <Text className="mt-2 text-xs text-muted-foreground">{translate('settings.organization.solo_hint')}</Text> : null}
    </View>
  );
}
