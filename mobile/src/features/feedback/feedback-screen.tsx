import Env from 'env';
import { useRouter } from 'expo-router';
import i18n from 'i18next';
import * as React from 'react';
import { Image, Platform, useWindowDimensions, View } from 'react-native';
import { useUniwind } from 'uniwind';
import { Button, Card, Checkbox, Input, Screen, Segmented, Text } from '~/components/ui';
import { useAuthStore } from '~/features/auth/use-auth-store';
import { useLocalStore } from '~/features/local/local-store';
import { useOfflineQueue } from '~/features/offline/queue-store';
import { errorMessage, trpcClient } from '~/lib/api';
import { translate } from '~/lib/i18n';
import { showMessage } from '~/lib/notify';
import { buildContext, isValidOptionalEmail, screenshotDataUrl } from './feedback-logic';
import { feedbackState, getInstallId, setPendingFeedback } from './feedback-store';

type FeedbackType = 'feedback' | 'feature' | 'bug';
const TYPES: readonly FeedbackType[] = ['feedback', 'feature', 'bug'];

type SubmitInput = Parameters<typeof trpcClient.feedback.submit.mutate>[0];
// `feedback.submitAnonymous` (mahope/timetrack#632) — smal type indtil den er på web-main.
type AnonClient = { submitAnonymous: { mutate: (i: SubmitInput & { installId: string; contactEmail?: string }) => Promise<unknown> } };

/** Læs (og ryd) det skærmbillede og den rute, boblen gemte lige før skærmen åbnede. */
function usePending() {
  const [pending] = React.useState(() => {
    const { screenshot, route } = feedbackState();
    setPendingFeedback(null, '/');
    return { screenshot, route };
  });
  return pending;
}

function useSend() {
  const signedIn = useAuthStore.use.status() === 'signIn';
  const online = useOfflineQueue.use.isOnline();
  const entries = useLocalStore.use.entries().length;
  const projects = useLocalStore.use.projects().length;
  const { width, height } = useWindowDimensions();
  const { theme } = useUniwind();
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const send = async (input: Omit<SubmitInput, 'context'> & { route: string; contactEmail: string }) => {
    const context = buildContext({
      route: input.route,
      width,
      height,
      platform: Platform.OS,
      osVersion: Platform.Version,
      appVersion: Env.EXPO_PUBLIC_VERSION,
      language: i18n.language,
      timezone: new Intl.DateTimeFormat().resolvedOptions().timeZone,
      colorScheme: theme === 'dark' ? 'dark' : 'light',
      online,
      console: feedbackState().console,
      notes: signedIn ? [] : [`uden konto: ${entries} poster, ${projects} projekter`],
    });
    const payload = { type: input.type, message: input.message, screenshotDataUrl: input.screenshotDataUrl, context };
    setBusy(true);
    setError(null);
    try {
      if (signedIn)
        await trpcClient.feedback.submit.mutate(payload);
      else
        await (trpcClient.feedback as unknown as AnonClient).submitAnonymous.mutate({ ...payload, installId: getInstallId(), contactEmail: input.contactEmail.trim() || undefined });
      return true;
    }
    catch (e) {
      // Vises på selve skærmen: en toast kan ligge bag den modale skærm
      setError(`${translate('settings.feedback.error')} ${errorMessage(e)}`);
      return false;
    }
    finally {
      setBusy(false);
    }
  };
  return { send, busy, signedIn, error };
}

/** Feedback med og uden konto: type, tekst, valgfrit skærmbillede og (uden konto) valgfri mail til svar. */
export function FeedbackScreen() {
  const router = useRouter();
  const pending = usePending();
  const { send, busy, signedIn, error } = useSend();
  const [type, setType] = React.useState<FeedbackType>('feedback');
  const [message, setMessage] = React.useState('');
  const [email, setEmail] = React.useState('');
  const shot = screenshotDataUrl(pending.screenshot);
  const [attach, setAttach] = React.useState(shot !== null);
  const options = React.useMemo(() => TYPES.map(value => ({ value, label: translate(`settings.feedback.type_${value}`) })), []);
  const emailOk = isValidOptionalEmail(email);
  const canSend = message.trim().length > 0 && emailOk && !busy;

  const submit = async () => {
    const ok = await send({ type, message: message.trim(), screenshotDataUrl: attach && shot ? shot : undefined, route: pending.route, contactEmail: email });
    if (ok) {
      showMessage({ message: translate('settings.feedback.sent'), type: 'success' });
      router.back();
    }
  };

  return (
    <Screen title={translate('settings.feedback.title')} back>
      <View className="gap-4">
        <Segmented options={options} value={type} onChange={setType} testID="feedback-type" />
        <Card>
          <Input
            label={translate('settings.feedback.message')}
            placeholder={translate('settings.feedback.placeholder')}
            value={message}
            onChangeText={setMessage}
            multiline
            numberOfLines={6}
            textAlignVertical="top"
            // className på Input erstatter hele feltets styling (også tekstfarven) — brug style
            style={{ minHeight: 128 }}
            testID="feedback-message"
          />
          {signedIn
            ? null
            : (
                <Input
                  label={translate('settings.feedback.contact_email')}
                  placeholder={translate('settings.feedback.contact_hint')}
                  value={email}
                  onChangeText={setEmail}
                  autoCapitalize="none"
                  keyboardType="email-address"
                  error={emailOk ? undefined : translate('settings.feedback.contact_invalid')}
                  testID="feedback-email"
                />
              )}
        </Card>
        {shot
          ? (
              <Card className="flex-row items-center gap-3">
                <Image source={{ uri: shot }} style={{ width: 54, height: 108, borderRadius: 6 }} resizeMode="cover" accessibilityIgnoresInvertColors />
                <View className="flex-1">
                  <Checkbox checked={attach} onChange={setAttach} label={translate('settings.feedback.attach_screenshot')} accessibilityLabel={translate('settings.feedback.attach_screenshot')} testID="feedback-attach" />
                </View>
              </Card>
            )
          : null}
        <Text className="text-xs text-muted-foreground" tx="settings.feedback.context_hint" />
        {error ? <Text className="text-sm text-danger-600" testID="feedback-error">{error}</Text> : null}
        <Button label={translate('settings.feedback.send')} onPress={submit} loading={busy} disabled={!canSend} testID="feedback-send" />
      </View>
    </Screen>
  );
}
