import type { OrgStep } from './account-deletion-orgs';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { TriangleAlert } from 'lucide-react-native';
import * as React from 'react';
import { Alert, View } from 'react-native';
import { Button, Card, colors, ErrorState, Input, Screen, Text } from '~/components/ui';
import { signOut, useAuthStore } from '~/features/auth/use-auth-store';
import { useStoreBillingConfig } from '~/features/billing/store-billing-api';
import { openSubscriptionStore } from '~/features/billing/use-store-billing';
import { trpc } from '~/lib/api';
import { appleCodeForAccountDeletion } from '~/lib/auth/apple';
import { translate } from '~/lib/i18n';
import { showMessage } from '~/lib/notify';
import { findSharedOrgs, loadOrgsWithMembers } from './account-deletion-orgs';

/**
 * Et abonnement købt i App Store eller Google Play stopper ikke, når kontoen slettes. Det skal
 * brugeren have at vide, med en vej til butikkens abonnementsside, før kontoen slettes.
 */
function StoreSubscriptionWarning() {
  const current = useStoreBillingConfig().data?.current;
  const source = current?.source;
  if (source !== 'apple' && source !== 'google')
    return null;
  return (
    <Card className="mt-4" testID="delete-account-store-subscription">
      <Text className="font-semibold text-foreground" tx="settings.delete_account.store_title" />
      <Text className="mt-1 text-sm text-foreground" tx={`settings.delete_account.store_body_${source}`} />
      <Button
        className="mt-3 mb-0"
        variant="outline"
        label={translate('billing.manage')}
        onPress={() => void openSubscriptionStore(source, current?.productId ?? null)}
        testID="delete-account-manage-subscription"
      />
    </Card>
  );
}

/** Hvad der sker med organisationer, brugeren deler med andre, når kontoen slettes. */
function OrgConsequences({ steps }: { steps: OrgStep[] }) {
  if (steps.length === 0)
    return null;
  return (
    <Card className="mt-4" testID="delete-account-orgs">
      <Text className="font-semibold text-foreground" tx="settings.delete_account.orgs_title" />
      {steps.map(step => (
        <Text key={step.orgId} className="mt-1 text-sm text-foreground">
          {step.kind === 'leave'
            ? translate('settings.delete_account.org_leave', { name: step.name })
            : translate('settings.delete_account.org_transfer', { name: step.name })}
        </Text>
      ))}
    </Card>
  );
}

function useAccountDeletion() {
  const router = useRouter();
  const session = useAuthStore.use.session();
  const user = (session as { user?: { id?: string; email?: string } } | null)?.user;
  const email = (user?.email ?? '').toLowerCase();
  const orgs = useQuery({ queryKey: ['account-deletion', 'orgs', user?.id], queryFn: loadOrgsWithMembers, enabled: !!user?.id, staleTime: 0 });
  const sharedOrgs = user?.id && orgs.data ? findSharedOrgs(user.id, orgs.data) : [];
  const del = trpc.user.deleteAccount.useMutation();
  // Serveren tjekker butiksabonnementer på tværs af alle brugerens organisationer, ikke kun den aktive.
  const info = trpc.user.getAccountDeletionInfo.useQuery(undefined, { staleTime: 0 });
  const serverBlocks = info.data?.blockingOrgs ?? [];
  const steps: OrgStep[] = [
    ...sharedOrgs
      .filter(org => !serverBlocks.some(blocked => blocked.id === org.id))
      .map(org => ({ kind: 'leave' as const, orgId: org.id, name: org.name })),
    ...serverBlocks.map(org => ({ kind: 'transfer' as const, orgId: org.id, name: org.name })),
  ];
  const canDelete = info.isSuccess && info.data?.canDelete === true && !!orgs.data
    && !orgs.isError && !orgs.isFetching && !info.isFetching;
  const source = useStoreBillingConfig().data?.current.source;
  const storeSubscription = source === 'apple' || source === 'google' || !!info.data?.storeSubscription;
  const [preparing, setPreparing] = React.useState(false);

  // En Alert-handler kan kaldes igen, før React når at deaktivere knappen.
  const startedRef = React.useRef(false);

  async function run(confirmEmail: string) {
    if (!canDelete || startedRef.current)
      return;
    startedRef.current = true;
    setPreparing(true);

    let deleted = false;
    try {
      const appleCode = await appleCodeForAccountDeletion();
      if (appleCode === 'canceled')
        return;
      // Apple-koden bruges kun til dette forsøg. Serveren ejer hele sletteoperationen.
      const apple: { appleAuthorizationCode?: string } = appleCode ? { appleAuthorizationCode: appleCode } : {};
      await del.mutateAsync({ confirmEmail, ...(storeSubscription ? { storeSubscriptionAcknowledged: true } : {}), ...apple });
      deleted = true;
    }
    catch {
      showMessage({ message: translate('settings.delete_account.retry_error'), type: 'danger' });
      // Ejerskabet eller abonnementet kan have ændret sig siden bekræftelsen.
      await Promise.all([orgs.refetch(), info.refetch()]);
    }
    finally {
      if (!deleted) {
        startedRef.current = false;
        setPreparing(false);
      }
    }

    if (deleted) {
      showMessage({ message: translate('settings.delete_account.done'), type: 'success' });
      await signOut();
      // Skærmen ligger over fanerne og skal selv omdirigere efter sletning.
      router.replace('/login');
    }
  }

  return { email, orgs, info, steps, storeSubscription, run, canDelete, busy: preparing };
}

export function DeleteAccountScreen() {
  const d = useAccountDeletion();
  const [confirm, setConfirm] = React.useState('');
  const matches = confirm.trim().toLowerCase() === d.email && d.email.length > 0;

  function ask() {
    Alert.alert(
      translate('settings.delete_account.confirm_title'),
      translate('settings.delete_account.confirm_body'),
      [
        { text: translate('settings.delete_account.cancel'), style: 'cancel' },
        {
          text: translate('settings.delete_account.confirm_cta'),
          style: 'destructive',
          onPress: () => void d.run(confirm.trim().toLowerCase()),
        },
      ],
    );
  }

  return (
    <Screen title={translate('settings.delete_account.title')} back>
      <Card className="border-danger-200 bg-danger-50 dark:border-danger-800 dark:bg-danger-900/30">
        <View className="flex-row items-start gap-3">
          <TriangleAlert size={22} color={colors.danger[600]} />
          <View className="flex-1">
            <Text className="font-semibold text-danger-700 dark:text-danger-200" tx="settings.delete_account.warning_title" />
            <Text className="mt-1 text-sm text-danger-700 dark:text-danger-200" tx={d.storeSubscription ? 'settings.delete_account.warning_body_store' : 'settings.delete_account.warning_body'} />
          </View>
        </View>
      </Card>
      <StoreSubscriptionWarning />
      {d.orgs.isError ? <ErrorState message={translate('settings.delete_account.orgs_error')} onRetry={() => void d.orgs.refetch()} /> : null}
      {d.info.isError ? <ErrorState onRetry={() => void d.info.refetch()} /> : null}
      <OrgConsequences steps={d.steps} />
      <View>
        <Text className="mt-6 text-muted-foreground" tx="settings.delete_account.instruction" />
        <Text className="mt-1 font-medium text-foreground" selectable>{d.email}</Text>
        <View className="mt-4">
          <Input
            label={translate('settings.delete_account.field')}
            value={confirm}
            onChangeText={setConfirm}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            testID="delete-account-email"
          />
        </View>
        <Button
          variant="destructive"
          label={translate('settings.delete_account.cta')}
          onPress={ask}
          disabled={!matches || d.busy || !d.canDelete}
          loading={d.busy}
          testID="delete-account-submit"
        />
      </View>
    </Screen>
  );
}
