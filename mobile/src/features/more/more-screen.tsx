import type { MenuSection } from './menu';
import type { TxKeyPath } from '~/lib/i18n';
import { useFocusEffect, useRouter } from 'expo-router';
import { Search } from 'lucide-react-native';
import * as React from 'react';
import { Alert, View } from 'react-native';
import { Avatar, Button, Card, IconButton, ListRow, Screen, SectionHeader, Text } from '~/components/ui';
import { antalDaLogUdsletter, uafsluttetTidNu } from '~/features/auth/logout-guard';
import { signOut } from '~/features/auth/use-auth-store';
import { useStoreBillingConfig } from '~/features/billing/store-billing-api';
import { isCallLoggingEnabled } from '~/features/calls/call-settings';
import { isDefaultOrgName, useCapabilities } from '~/features/capabilities/use-capabilities';
import { isTimeWren } from '~/features/server/server-config';
import { RoleBadge } from '~/features/team/components/members-list';
import { roleLabel } from '~/features/team/role-logic';
import { trpc } from '~/lib/api';
import { translate } from '~/lib/i18n';
import { href } from './links';
import { buildMoreMenu, showSubscription } from './menu';

/** Mere-fanen er hub'en: profilkort, grupperede menuer og log ud. */
export function MoreScreen() {
  const router = useRouter();
  const caps = useCapabilities();
  const user = trpc.user.getProfile.useQuery().data;
  // Lokal indstilling: læses igen hver gang fanen vises, så et skift i Opkald slår igennem.
  const [callLogging, setCallLogging] = React.useState(isCallLoggingEnabled);
  useFocusEffect(React.useCallback(() => setCallLogging(isCallLoggingEnabled()), []));
  const billingEnabled = trpc.subscription.billingEnabled.useQuery().data?.enabled;
  const storeBillingEnabled = useStoreBillingConfig().data?.enabled;
  const subscription = showSubscription(isTimeWren, { billingEnabled, storeBillingEnabled });
  const sections = React.useMemo(() => buildMoreMenu(caps, { callLogging, subscription }), [caps, callLogging, subscription]);

  const confirmSignOut = () => {
    // Log ud rydder timeren og offline-køen, så en kørende timer og usendte
    // registreringer forsvinder. Det er nødvendigt for delte enheder, men
    // brugeren skal høre det, før han trykker — tid han ikke kan få tilbage.
    const usendt = antalDaLogUdsletter(uafsluttetTidNu());
    const harUafsluttet = usendt > 0;
    Alert.alert(
      translate(harUafsluttet ? 'more.logout_unsent_title' : 'more.logout_confirm_title'),
      harUafsluttet
        ? translate('more.logout_unsent_body', { count: usendt })
        : translate('more.logout_confirm_body'),
      [
        { text: translate('more.cancel'), style: 'cancel' },
        { text: translate('more.logout'), style: 'destructive', onPress: () => void signOut() },
      ],
    );
  };

  return (
    <Screen
      title={translate('more.title')}
      right={<IconButton icon={Search} label={translate('more.search')} onPress={() => router.push(href('/search'))} testID="more-search" />}
    >
      <Card
        onPress={() => router.push(href('/settings/profile'))}
        testID="more-profile"
        className="flex-row items-center gap-3"
        a11yLabel={[
          user?.name,
          caps.hasOrg ? [caps.orgName && !isDefaultOrgName(caps.orgName) ? caps.orgName : null, roleLabel(caps.role)].filter(Boolean).join(', ') : null,
          user?.email,
        ].filter(Boolean).join(', ')}
      >
        <Avatar name={user?.name} image={user?.image} size={48} />
        <View className="flex-1">
          <Text className="text-base font-semibold text-foreground" numberOfLines={1}>{user?.name ?? '–'}</Text>
          {caps.hasOrg
            ? (
                <View className="flex-row items-center gap-2">
                  {caps.orgName && !isDefaultOrgName(caps.orgName)
                    ? <Text className="text-sm text-muted-foreground" numberOfLines={1}>{caps.orgName}</Text>
                    : null}
                  <RoleBadge role={caps.role} />
                </View>
              )
            : null}
          <Text className="text-xs text-muted-foreground" numberOfLines={1}>{user?.email ?? ''}</Text>
        </View>
      </Card>

      {sections.map(section => <MenuGroup key={section.key} section={section} />)}

      <View className="mt-8">
        <Button
          label={translate('more.logout')}
          variant="destructive"
          onPress={confirmSignOut}
          testID="more-logout"
        />
      </View>
    </Screen>
  );
}

function MenuGroup({ section }: { section: MenuSection }) {
  const router = useRouter();
  return (
    <View>
      <SectionHeader title={translate(`more.${section.key}` as TxKeyPath)} />
      <Card className="p-0">
        {section.items.map((item, i) => (
          <ListRow
            key={item.key}
            title={translate(`more.${item.labelKey}` as TxKeyPath)}
            onPress={() => router.push(href(item.href))}
            last={i === section.items.length - 1}
            testID={`more-${item.key}`}
          />
        ))}
      </Card>
    </View>
  );
}
