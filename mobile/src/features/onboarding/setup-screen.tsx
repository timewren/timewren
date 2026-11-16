import type { TxKeyPath } from '~/lib/i18n';
import { useRouter } from 'expo-router';
import { Building2, Check, Sparkles, UserPlus } from 'lucide-react-native';
import * as React from 'react';
import { KeyboardAvoidingView, Platform } from 'react-native';
import {
  Button,
  colors,
  Input,
  Screen,
  Text,
  View,
} from '~/components/ui';
import { errorMessage, trpc, useInvalidateDirectory } from '~/lib/api';
import { translate } from '~/lib/i18n';
import { showMessage } from '~/lib/notify';

type Step = 'start' | 'company' | 'client' | 'done';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Første-gangs-opsætning i appen (erstatter web's onboarding-modal for nye brugere):
 * 1) gratis prøveperiode (30 dage, uden kort) oprettes automatisk,
 * 2) firmaoplysninger (kan springes over), 3) første kunde (kan springes over),
 * 4) færdig → onboarding.complete. Alt kan gøres igen på web.
 */
export function SetupScreen() {
  const router = useRouter();
  const utils = trpc.useUtils();
  const [step, setStep] = React.useState<Step>('start');
  const sub = trpc.subscription.getDetails.useQuery();
  const createSub = trpc.onboarding.createSubscription.useMutation();
  const complete = trpc.onboarding.complete.useMutation();
  const updateStep = trpc.onboarding.updateStep.useMutation();

  async function start() {
    try {
      if (!sub.data)
        await createSub.mutateAsync({ billingCycle: 'monthly', planTier: 'solo' });
      await utils.subscription.invalidate();
      setStep('company');
    }
    catch (e) {
      showMessage({ message: errorMessage(e), type: 'danger' });
    }
  }

  async function finish() {
    try {
      await complete.mutateAsync();
      // Profilen ligger i cachen fra fane-layoutet; hent den igen FØR vi navigerer,
      // ellers sender layoutet os tilbage hertil med den gamle onboardingCompleted=false.
      // staleTime 0: fetch() genbruger ellers cachen i de 5 min, den regnes for frisk.
      await utils.user.getProfile.fetch(undefined, { staleTime: 0 });
      await utils.mobile.invalidate();
      router.replace('/');
    }
    catch (e) {
      showMessage({ message: errorMessage(e), type: 'danger' });
    }
  }

  const goClient = () => {
    updateStep.mutate({ step: 'first_client' });
    setStep('client');
  };

  return (
    <Screen noHeader contentContainerClassName="flex-grow justify-center px-6 pb-8" scrollProps={{ keyboardShouldPersistTaps: 'handled' }}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {step === 'start' && <StartStep busy={createSub.isPending || sub.isLoading} onNext={start} />}
        {step === 'company' && <CompanyStep onNext={goClient} />}
        {step === 'client' && <ClientStep onNext={() => setStep('done')} />}
        {step === 'done' && <DoneStep busy={complete.isPending} onFinish={finish} />}
      </KeyboardAvoidingView>
    </Screen>
  );
}

function StepHeader({ icon: Icon, titleKey, bodyKey }: { icon: typeof Sparkles; titleKey: TxKeyPath; bodyKey: TxKeyPath }) {
  return (
    <View className="mb-6 items-center">
      <View className="mb-4 size-14 items-center justify-center rounded-2xl bg-primary-100 dark:bg-primary-900">
        <Icon size={26} color={colors.primary[600]} />
      </View>
      <Text className="text-center text-2xl font-bold text-foreground">{translate(titleKey)}</Text>
      <Text className="mt-1 text-center text-muted-foreground">{translate(bodyKey)}</Text>
    </View>
  );
}

function StartStep({ busy, onNext }: { busy: boolean; onNext: () => void }) {
  return (
    <View>
      <StepHeader icon={Sparkles} titleKey="setup.start.title" bodyKey="setup.start.body" />
      <Button label={translate('setup.start.cta')} onPress={onNext} loading={busy} testID="setup-start" />
    </View>
  );
}

function CompanyStep({ onNext }: { onNext: () => void }) {
  const [name, setName] = React.useState('');
  const [email, setEmail] = React.useState('');
  const [cvr, setCvr] = React.useState('');
  const save = trpc.onboarding.saveCompanyProfile.useMutation();
  const valid = name.trim().length >= 2 && EMAIL_RE.test(email.trim());

  async function submit() {
    try {
      await save.mutateAsync({ name: name.trim(), email: email.trim(), cvrNumber: cvr.trim() || undefined });
      onNext();
    }
    catch (e) {
      showMessage({ message: errorMessage(e), type: 'danger' });
    }
  }

  return (
    <View>
      <StepHeader icon={Building2} titleKey="setup.company.title" bodyKey="setup.company.body" />
      <Input label={translate('setup.company.name')} value={name} onChangeText={setName} testID="setup-company-name" />
      <Input label={translate('setup.company.email')} value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" testID="setup-company-email" />
      <Input label={translate('setup.company.cvr')} value={cvr} onChangeText={setCvr} keyboardType="number-pad" testID="setup-company-cvr" />
      <Button label={translate('setup.next')} onPress={submit} loading={save.isPending} disabled={!valid} testID="setup-company-next" />
      <Button variant="ghost" label={translate('setup.skip')} onPress={onNext} testID="setup-company-skip" />
    </View>
  );
}

function ClientStep({ onNext }: { onNext: () => void }) {
  const [name, setName] = React.useState('');
  const invalidateDirectory = useInvalidateDirectory();
  const create = trpc.clients.create.useMutation();

  async function submit() {
    try {
      await create.mutateAsync({ name: name.trim() });
      invalidateDirectory();
      onNext();
    }
    catch (e) {
      showMessage({ message: errorMessage(e), type: 'danger' });
    }
  }

  return (
    <View>
      <StepHeader icon={UserPlus} titleKey="setup.client.title" bodyKey="setup.client.body" />
      <Input label={translate('setup.client.name')} value={name} onChangeText={setName} testID="setup-client-name" />
      <Button label={translate('setup.next')} onPress={submit} loading={create.isPending} disabled={name.trim().length < 2} testID="setup-client-next" />
      <Button variant="ghost" label={translate('setup.skip')} onPress={onNext} testID="setup-client-skip" />
    </View>
  );
}

function DoneStep({ busy, onFinish }: { busy: boolean; onFinish: () => void }) {
  return (
    <View>
      <StepHeader icon={Check} titleKey="setup.done.title" bodyKey="setup.done.body" />
      <Button label={translate('setup.done.cta')} onPress={onFinish} loading={busy} testID="setup-finish" />
    </View>
  );
}
