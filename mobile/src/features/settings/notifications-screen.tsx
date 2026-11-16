import type { RouterInputs } from '~/api/app-router';
import type { TxKeyPath } from '~/lib/i18n';
import * as React from 'react';
import { View } from 'react-native';
import { Badge, Card, ErrorState, ListRow, ListSkeleton, Screen, SectionHeader, Switch, Text } from '~/components/ui';
import { getStoredPushToken, registerForPush, unregisterPush } from '~/features/notifications/push-registration';
import { isDailyReminderEnabled, setDailyReminderEnabled } from '~/features/notifications/reminders';
import { isWeekCloseReminderEnabled, setWeekCloseReminderEnabled } from '~/features/week-review/week-close';
import { errorMessage, trpc } from '~/lib/api';
import { translate } from '~/lib/i18n';
import { showMessage, useAnnounceLoaded } from '~/lib/notify';

type EmailPrefs = RouterInputs['user']['updateEmailPreferences'];
type ToggleKey = keyof Pick<EmailPrefs, 'weeklyReport' | 'monthlyReport' | 'unbilledReminder' | 'newLoginAlert' | 'endOfDayEnabled' | 'inactivityReminder' | 'tipsAndTricks'>;

const EMAIL_TOGGLES: { key: ToggleKey; labelKey: string }[] = [
  { key: 'weeklyReport', labelKey: 'weekly_report' },
  { key: 'monthlyReport', labelKey: 'monthly_report' },
  { key: 'unbilledReminder', labelKey: 'unbilled_reminder' },
  { key: 'endOfDayEnabled', labelKey: 'end_of_day' },
  { key: 'newLoginAlert', labelKey: 'new_login_alert' },
  { key: 'inactivityReminder', labelKey: 'inactivity' },
  { key: 'tipsAndTricks', labelKey: 'tips' },
];

export function NotificationsScreen() {
  return (
    <Screen title={translate('settings.notifications.title')} back>
      <PushSection />
      <RemindersSection />
      <EmailSection />
      <ChannelsSection />
    </Screen>
  );
}

function PushSection() {
  const [enabled, setEnabled] = React.useState(() => getStoredPushToken() !== null);
  const [busy, setBusy] = React.useState(false);

  const toggle = async (next: boolean) => {
    setBusy(true);
    try {
      if (!next) {
        await unregisterPush();
        setEnabled(false);
        return;
      }
      const result = await registerForPush();
      if (result.status === 'registered') {
        setEnabled(true);
        showMessage({ message: translate('settings.notifications.saved'), type: 'success' });
      }
      else if (result.status === 'denied') {
        showMessage({ message: translate('settings.notifications.push_denied'), type: 'warning' });
      }
      else if (result.status === 'simulator' || result.status === 'no_project_id') {
        showMessage({ message: translate('settings.notifications.push_simulator'), type: 'info' });
      }
      else {
        showMessage({ message: `${translate('settings.notifications.push_error')}: ${result.message}`, type: 'danger' });
      }
    }
    finally {
      setBusy(false);
    }
  };

  return (
    <View>
      <SectionHeader title={translate('settings.notifications.push')} className="mt-0" />
      <Card>
        <Switch
          checked={enabled}
          onChange={next => void toggle(next)}
          disabled={busy}
          label={translate('settings.notifications.push_enable')}
          accessibilityLabel={translate('settings.notifications.push_enable')}
          testID="push-toggle"
        />
        <Text className="mt-2 text-xs text-muted-foreground">{translate('settings.notifications.push_hint')}</Text>
      </Card>
    </View>
  );
}

/** Lokale påmindelser (kun på denne telefon) — daglig kl. 17 på hverdage + ugeafslutning søndag aften. */
function RemindersSection() {
  const [daily, setDaily] = React.useState(() => isDailyReminderEnabled());
  const [weekClose, setWeekClose] = React.useState(() => isWeekCloseReminderEnabled());
  const [busy, setBusy] = React.useState(false);

  const toggle = async (next: boolean, apply: (on: boolean) => Promise<void>, done: (on: boolean) => void) => {
    setBusy(true);
    try {
      await apply(next);
      done(next);
    }
    catch {
      showMessage({ message: translate('notifications.reminders_denied'), type: 'warning' });
    }
    finally {
      setBusy(false);
    }
  };

  return (
    <View>
      <SectionHeader title={translate('notifications.reminders')} />
      <Card className="gap-4">
        <View>
          <Switch
            checked={daily}
            onChange={next => void toggle(next, setDailyReminderEnabled, setDaily)}
            disabled={busy}
            label={translate('notifications.reminders_daily')}
            accessibilityLabel={translate('notifications.reminders_daily')}
            testID="daily-reminder-toggle"
          />
          <Text className="mt-1 text-xs text-muted-foreground">{translate('notifications.reminders_daily_hint')}</Text>
        </View>
        <View>
          <Switch
            checked={weekClose}
            onChange={next => void toggle(next, setWeekCloseReminderEnabled, setWeekClose)}
            disabled={busy}
            label={translate('notifications.reminders_week_close')}
            accessibilityLabel={translate('notifications.reminders_week_close')}
            testID="week-close-reminder-toggle"
          />
          <Text className="mt-1 text-xs text-muted-foreground">{translate('notifications.reminders_week_close_hint')}</Text>
        </View>
        <View>
          <Text className="text-base text-foreground">{translate('notifications.reminders_timer')}</Text>
          <Text className="mt-1 text-xs text-muted-foreground">{translate('notifications.reminders_timer_hint')}</Text>
        </View>
      </Card>
    </View>
  );
}

function EmailSection() {
  const utils = trpc.useUtils();
  const prefs = trpc.user.getEmailPreferences.useQuery();
  // Kanal-sektionen er betinget (den renderer `null` indtil den ved noget), så
  // den tæller ikke med — ellers ville skærmen tie til en sektion der måske
  // aldrig vises.
  useAnnounceLoaded(prefs, translate('common.loaded'));
  const update = trpc.user.updateEmailPreferences.useMutation({
    onSuccess: () => void utils.user.getEmailPreferences.invalidate(),
    onError: error => showMessage({ message: errorMessage(error), type: 'danger' }),
  });

  return (
    <View>
      <SectionHeader title={translate('settings.notifications.email')} />
      {prefs.isLoading
        ? <ListSkeleton rows={3} />
        : prefs.isError
          ? <ErrorState message={errorMessage(prefs.error)} onRetry={() => void prefs.refetch()} />
          : (
              <Card className="gap-4">
                {EMAIL_TOGGLES.map(t => (
                  <Switch
                    key={t.key}
                    checked={Boolean(prefs.data?.[t.key])}
                    onChange={value => update.mutate({ [t.key]: value })}
                    label={translate(`settings.notifications.${t.labelKey}` as TxKeyPath)}
                    accessibilityLabel={translate(`settings.notifications.${t.labelKey}` as TxKeyPath)}
                    testID={`email-${t.key}`}
                  />
                ))}
              </Card>
            )}
    </View>
  );
}

function ChannelsSection() {
  const channels = trpc.notifications.getChannels.useQuery();
  const list = channels.data ?? [];
  if (channels.isLoading || (!channels.isError && list.length === 0))
    return null;
  return (
    <View>
      <SectionHeader title={translate('settings.notifications.channels')} />
      <Card className="p-0">
        {channels.isError
          ? <ErrorState message={errorMessage(channels.error)} onRetry={() => void channels.refetch()} />
          : list.map((ch, i) => {
              const connected = ch.discordConnected || ch.slackConnected || ch.pushConnected;
              const title = ch.discordConnected
                ? translate('settings.notifications.channel_discord')
                : ch.slackConnected
                  ? translate('settings.notifications.channel_slack')
                  : translate('settings.notifications.channel_push');
              return (
                <ListRow
                  key={ch.id}
                  title={title}
                  subtitle={ch.discordWebhookName ?? ch.slackChannelName ?? undefined}
                  right={<Badge label={translate(connected && ch.isEnabled ? 'settings.notifications.connected' : 'settings.notifications.disconnected')} tone={connected && ch.isEnabled ? 'success' : 'default'} />}
                  last={i === list.length - 1}
                />
              );
            })}
      </Card>
      <Text className="mt-2 text-xs text-muted-foreground">{translate('settings.notifications.channels_hint')}</Text>
    </View>
  );
}
