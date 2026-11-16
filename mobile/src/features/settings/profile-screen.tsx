import type { RouterOutputs } from '~/api/app-router';
import { useRouter } from 'expo-router';
import * as React from 'react';
import { View } from 'react-native';
import { Button, Card, ErrorState, Input, ListSkeleton, Screen, Text } from '~/components/ui';
import { useCapabilities } from '~/features/capabilities/use-capabilities';
import { errorMessage, trpc } from '~/lib/api';
import { translate } from '~/lib/i18n';
import { showMessage, useAnnounceLoaded } from '~/lib/notify';
import { displayDecimal, normalizeDecimal } from './normalize-decimal';

type Profile = NonNullable<RouterOutputs['user']['getProfile']>;

export function ProfileScreen() {
  const query = trpc.user.getProfile.useQuery();
  useAnnounceLoaded(query, translate('common.loaded'));
  return (
    <Screen title={translate('settings.profile.title')} back>
      {query.isLoading
        ? <ListSkeleton rows={2} />
        : query.isError || !query.data
          ? <ErrorState message={errorMessage(query.error)} onRetry={() => void query.refetch()} />
          : <ProfileForm profile={query.data} />}
    </Screen>
  );
}

function ProfileForm({ profile }: { profile: Profile }) {
  const router = useRouter();
  const utils = trpc.useUtils();
  const caps = useCapabilities();
  // Timepris er irrelevant for enterprise-ansatte (de fakturerer ikke selv).
  const showRate = !caps.isEnterprise;
  const [name, setName] = React.useState(profile.name ?? '');
  const [rate, setRate] = React.useState(() => displayDecimal(profile.defaultHourlyRate));
  const [goal, setGoal] = React.useState(() => displayDecimal(profile.weeklyHourGoal));
  const nameError = name.trim().length < 2 ? translate('settings.profile.name_error') : undefined;

  const update = trpc.user.updateProfile.useMutation({
    onSuccess: async () => {
      await Promise.all([utils.user.invalidate(), utils.time.invalidate(), utils.mobile.invalidate()]);
      showMessage({ message: translate('settings.profile.saved'), type: 'success' });
    },
    onError: error => showMessage({ message: errorMessage(error), type: 'danger' }),
  });

  const save = () => {
    if (nameError)
      return;
    update.mutate({
      name: name.trim(),
      defaultHourlyRate: normalizeDecimal(rate),
      weeklyHourGoal: normalizeDecimal(goal),
    });
  };

  return (
    <View className="gap-4">
      <Card className="gap-3">
        <Input
          label={translate('settings.profile.name')}
          value={name}
          onChangeText={setName}
          error={nameError}
          autoCapitalize="words"
          testID="profile-name"
        />
        <Input label={translate('settings.profile.email')} value={profile.email} editable={false} />
        <Text className="-mt-2 text-xs text-muted-foreground">{translate('settings.profile.email_hint')}</Text>
      </Card>
      <Card className="gap-3">
        {showRate
          ? (
              <Input
                label={translate('settings.profile.hourly_rate')}
                value={rate}
                onChangeText={setRate}
                keyboardType="decimal-pad"
                testID="profile-rate"
              />
            )
          : null}
        <Input
          label={translate('settings.profile.weekly_goal')}
          value={goal}
          onChangeText={setGoal}
          keyboardType="decimal-pad"
          testID="profile-goal"
        />
        <Input label={translate('settings.profile.timezone')} value={profile.timezone ?? 'Europe/Copenhagen'} editable={false} />
      </Card>
      <Button label={translate('settings.profile.save')} onPress={save} loading={update.isPending} disabled={!!nameError} testID="profile-save" />
      <Button
        variant="ghost"
        label={translate('settings.profile.delete_account')}
        textClassName="text-danger-600 dark:text-danger-400"
        onPress={() => router.push('/settings/delete-account')}
        testID="profile-delete-account"
      />
    </View>
  );
}
