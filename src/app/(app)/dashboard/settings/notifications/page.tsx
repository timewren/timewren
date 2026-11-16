"use client";

import {
  AlertCircle,
  Bell,
  BellOff,
  CheckCircle2,
  Clock,
  Mail,
  MessageSquare,
  Moon,
  RefreshCw,
  Repeat,
  Send,
  Shield,
  Ticket,
  Trash2,
  TrendingUp,
  Users,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useId, useState } from "react";
import { toast } from "sonner";
import { useBrand } from "@/components/BrandContext";
import { PageHeader } from "@/components/dashboard-nav";
import { ActiveDaysSelector } from "@/components/settings/ActiveDaysSelector";
import { NotificationToggle } from "@/components/settings/NotificationToggle";
import { OrgNotificationPreferences } from "@/components/settings/OrgNotificationPreferences";
import { ConfirmDialog } from "@/components/ui";
import { AutoSaveStatus } from "@/components/ui/AutoSaveStatus";
import { LoadingScreen } from "@/components/ui/LoadingScreen";
import { switchThumb, switchTrack } from "@/components/ui/switch-styles";
import { useAutoSave } from "@/hooks/useAutoSave";
import { useBadge } from "@/hooks/useBadge";
import { usePeriodicSync } from "@/hooks/usePeriodicSync";
import { usePushNotifications } from "@/hooks/usePushNotifications";
import { toIntlLocale } from "@/i18n/format-locale";
import { useSession } from "@/lib/auth-client";
import {
  normalizeUnbilledReminderFrequency,
  UNBILLED_REMINDER_FREQUENCIES,
  UNBILLED_REMINDER_FREQUENCY_LABELS,
} from "@/lib/notifications/unbilled-reminder";
import { trpc } from "@/providers/trpc-provider";

type IdleForm = { idleThreshold: number; autoPauseAfter: number | null };

export default function NotificationsSettingsPage() {
  // Hostens brand (TimeWren på timewren.com), ikke build-brandet.
  const brand = useBrand();
  const fid = useId();
  const t = useTranslations("settingsNotifications");
  const locale = useLocale();
  const { data: session, isPending } = useSession();
  const utils = trpc.useUtils();

  // Discord webhook state
  const [discordWebhookUrl, setDiscordWebhookUrl] = useState("");
  const [discordWebhookName, setDiscordWebhookName] = useState("");
  const [showRemoveDiscordConfirm, setShowRemoveDiscordConfirm] =
    useState(false);
  const [showDisablePushConfirm, setShowDisablePushConfirm] = useState(false);

  // PWA state — idle threshold lives on the server (timer_states) and is
  // shared with the browser extension.
  const { data: idleSettings } = trpc.timerSync.getIdleSettings.useQuery();
  const updateIdleThresholdMutation =
    trpc.timerSync.updateIdleThreshold.useMutation({
      onSuccess: () => {
        utils.timerSync.getIdleSettings.invalidate();
      },
    });
  // Gemmer selv: skyderen efter en pause (og når den slippes), valget straks
  const idleForm = useAutoSave<IdleForm>({
    // null = ingen hård auto-pause. Default 2 timer.
    defaults: { idleThreshold: 5, autoPauseAfter: 120 },
    server: idleSettings
      ? {
          idleThreshold: idleSettings.idleThresholdMinutes || 5,
          autoPauseAfter: idleSettings.autoPauseAfterMinutes,
        }
      : undefined,
    errorTitle: t("couldNotSaveTheSetting"),
    save: (_patch, v) =>
      updateIdleThresholdMutation.mutateAsync({
        thresholdMinutes: v.idleThreshold,
        autoPauseAfterMinutes: v.autoPauseAfter,
      }),
  });
  const { idleThreshold, autoPauseAfter } = idleForm.values;
  const pushNotifications = usePushNotifications();
  const periodicSync = usePeriodicSync({
    tag: "weekly-report",
    minInterval: 7 * 24 * 60 * 60 * 1000,
    autoRegister: false,
  });
  const badge = useBadge();

  // Queries
  const { data: channels, isLoading: channelsLoading } =
    trpc.notifications.getChannels.useQuery();

  // Use user.* endpoint for full email prefs field set
  const { data: emailPrefs, isLoading: emailPrefsLoading } =
    trpc.user.getEmailPreferences.useQuery();

  // User profile for prepaid alert recipient setting
  const { data: userProfile } = trpc.user.getProfile.useQuery();

  const { data: pushConfig } = trpc.notifications.getPushConfig.useQuery();

  // Mutations
  const addDiscordMutation = trpc.notifications.addDiscordWebhook.useMutation({
    onSuccess: () => {
      toast.success(t("discordWebhookAdded"));
      setDiscordWebhookUrl("");
      setDiscordWebhookName("");
      utils.notifications.getChannels.invalidate();
    },
    onError: (error) => {
      toast.error(error.message || t("failAddDiscord"));
    },
  });

  const removeDiscordMutation =
    trpc.notifications.removeDiscordWebhook.useMutation({
      onSuccess: () => {
        toast.success(t("discordWebhookRemoved"));
        utils.notifications.getChannels.invalidate();
      },
      onError: (error) => {
        toast.error(error.message || t("failRemoveDiscord"));
      },
    });

  const testDiscordMutation = trpc.notifications.testDiscordWebhook.useMutation(
    {
      onSuccess: () => {
        toast.success(t("testNotificationSentToDiscord"));
        utils.notifications.getChannels.invalidate();
      },
      onError: (error) => {
        toast.error(error.message || t("failDiscordTest"));
      },
    },
  );

  const subscribePushMutation = trpc.notifications.subscribePush.useMutation({
    onSuccess: () => {
      toast.success(t("pushNotificationsEnabled"));
      utils.notifications.getChannels.invalidate();
    },
    onError: (error) => {
      toast.error(error.message || t("failEnablePush"));
    },
  });

  const unsubscribePushMutation =
    trpc.notifications.unsubscribePush.useMutation({
      onSuccess: () => {
        toast.success(t("pushNotificationsDisabled"));
        utils.notifications.getChannels.invalidate();
      },
      onError: (error) => {
        toast.error(error.message || t("failDisablePush"));
      },
    });

  const testPushMutation = trpc.notifications.testPush.useMutation({
    onSuccess: () => {
      toast.success(t("testPushNotificationSent"));
      utils.notifications.getChannels.invalidate();
    },
    onError: (error) => {
      toast.error(error.message || t("failPushTest"));
    },
  });

  // Use user.* endpoint for full field set
  const updateEmailPrefsMutation = trpc.user.updateEmailPreferences.useMutation(
    {
      onSuccess: () => {
        utils.user.getEmailPreferences.invalidate();
        toast.success(t("emailPreferencesUpdated"));
      },
      onError: (error) => {
        toast.error(error.message || t("failEmailPrefs"));
      },
    },
  );

  const updateAlertRecipientMutation =
    trpc.user.updatePrepaidAlertRecipient.useMutation({
      onSuccess: () => {
        utils.user.getProfile.invalidate();
        toast.success(t("prepaidPackageRecipientUpdated"));
      },
      onError: (error) => {
        toast.error(error.message || t("failRecipient"));
      },
    });

  const updateChannelPrefsMutation =
    trpc.notifications.updateChannelPreferences.useMutation({
      onSuccess: () => {
        utils.notifications.getChannels.invalidate();
      },
      onError: (error) => {
        toast.error(error.message || t("failChannelPrefs"));
      },
    });

  if (isPending || channelsLoading || emailPrefsLoading) {
    return <LoadingScreen message={t("loadingNotificationSettings")} />;
  }

  if (!session) {
    return null;
  }

  const discordChannel = channels?.find((ch) => ch.channelType === "discord");
  const pushChannel = channels?.find((ch) => ch.channelType === "browser_push");

  const handleAddDiscord = async () => {
    if (!discordWebhookUrl || !discordWebhookName) {
      toast.error(t("enterAWebhookUrlAnd"));
      return;
    }
    await addDiscordMutation.mutateAsync({
      webhookUrl: discordWebhookUrl,
      name: discordWebhookName,
    });
  };

  const handleSubscribePush = async () => {
    if (!pushConfig?.configured || !pushConfig.publicKey) {
      toast.error(t("pushNotificationsAreNotConfigured"));
      return;
    }

    if (!("Notification" in window)) {
      toast.error(t("yourBrowserDoesNotSupport"));
      return;
    }

    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      toast.error(t("youMustAllowNotifications"));
      return;
    }

    if (!("serviceWorker" in navigator)) {
      toast.error(t("yourBrowserDoesNotSupport2"));
      return;
    }

    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: pushConfig.publicKey,
      });

      await subscribePushMutation.mutateAsync({
        subscription: subscription.toJSON() as {
          endpoint: string;
          keys: { p256dh: string; auth: string };
        },
      });
    } catch (error) {
      console.error("Push subscription error:", error);
      toast.error(t("couldNotEnablePushNotifications"));
    }
  };

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      {/* Header */}
      <PageHeader
        title={t("notifications")}
        description={t("pageDescription", { brand: brand.name })}
      />

      {/* Organisationens hændelser (E10, #468) — kun for org-medlemmer */}
      <OrgNotificationPreferences />

      {/* Email Notifications */}
      <div
        id="email-notifikationer"
        className="rounded-xl border border-gray-200/80 dark:border-gray-800 bg-white dark:bg-gray-900 p-6"
      >
        <div className="flex items-start gap-4 mb-6">
          <div className="h-12 w-12 rounded-lg bg-brand-500 flex items-center justify-center shrink-0">
            <Mail className="h-6 w-6 text-white" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-gray-900 dark:text-white">
              {t("emailNotifications")}
            </h2>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              {t("emailsFrom", { brand: brand.name })}
            </p>
          </div>
        </div>

        <div className="space-y-4">
          {/* Reports Section */}
          <div>
            <div className="mb-4 flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-gray-500 dark:text-gray-400" />
              <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 uppercase tracking-wide">
                {t("reports")}
              </h3>
            </div>
            <div className="space-y-3 pl-6">
              <NotificationToggle
                label={t("weeklyReport")}
                description={t("overviewOfTheWeekS")}
                checked={emailPrefs?.weeklyReport ?? true}
                onChange={(checked) =>
                  updateEmailPrefsMutation.mutate({ weeklyReport: checked })
                }
                disabled={updateEmailPrefsMutation.isPending}
              />
              <NotificationToggle
                label={t("monthlyReport")}
                description={t("monthlyStatisticsWithTheYear")}
                checked={emailPrefs?.monthlyReport ?? true}
                onChange={(checked) =>
                  updateEmailPrefsMutation.mutate({ monthlyReport: checked })
                }
                disabled={updateEmailPrefsMutation.isPending}
              />
              <NotificationToggle
                label={t("uninvoicedReminder")}
                description={t("reminderAboutBillableHoursThat")}
                checked={emailPrefs?.unbilledReminder ?? true}
                onChange={(checked) =>
                  updateEmailPrefsMutation.mutate({
                    unbilledReminder: checked,
                  })
                }
                disabled={updateEmailPrefsMutation.isPending}
              />
              {(emailPrefs?.unbilledReminder ?? true) && (
                <div className="ml-4 flex items-center gap-2">
                  <label
                    htmlFor="unbilled-reminder-frequency"
                    className="text-sm text-gray-600 dark:text-gray-400"
                  >
                    {t("howOften")}
                  </label>
                  <select
                    id="unbilled-reminder-frequency"
                    value={normalizeUnbilledReminderFrequency(
                      emailPrefs?.unbilledReminderFrequency,
                    )}
                    onChange={(e) =>
                      updateEmailPrefsMutation.mutate({
                        unbilledReminderFrequency:
                          normalizeUnbilledReminderFrequency(e.target.value),
                      })
                    }
                    disabled={updateEmailPrefsMutation.isPending}
                    className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-1.5 text-sm text-gray-900 dark:text-white focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20 disabled:opacity-50"
                  >
                    {UNBILLED_REMINDER_FREQUENCIES.map((freq) => (
                      <option key={freq} value={freq}>
                        {UNBILLED_REMINDER_FREQUENCY_LABELS[freq]}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <NotificationToggle
                label={t("dailySummaryEndOfDay")}
                description={t("dailySummaryOfLoggedTime")}
                checked={emailPrefs?.endOfDayEnabled ?? false}
                onChange={(checked) =>
                  updateEmailPrefsMutation.mutate({
                    endOfDayEnabled: checked,
                  })
                }
                disabled={updateEmailPrefsMutation.isPending}
              />
              {emailPrefs?.endOfDayEnabled && (
                <div className="ml-4 flex items-center gap-2">
                  <label
                    htmlFor={`${fid}-f1`}
                    className="text-sm text-gray-600 dark:text-gray-400"
                  >
                    {t("time")}
                  </label>
                  <input
                    id={`${fid}-f1`}
                    type="time"
                    value={emailPrefs?.endOfDayTime ?? "17:00"}
                    onChange={(e) =>
                      updateEmailPrefsMutation.mutate({
                        endOfDayTime: e.target.value,
                      })
                    }
                    className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-1.5 text-sm text-gray-900 dark:text-white focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20"
                  />
                </div>
              )}
            </div>
          </div>

          {/* Security Section */}
          <div>
            <div className="mb-4 flex items-center gap-2">
              <Shield className="h-4 w-4 text-gray-500 dark:text-gray-400" />
              <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 uppercase tracking-wide">
                {t("security")}
              </h3>
            </div>
            <div className="space-y-3 pl-6">
              <NotificationToggle
                label={t("passwordChanged")}
                description={t("notificationWhenYourPasswordIs")}
                checked={emailPrefs?.passwordChanged ?? true}
                onChange={(checked) =>
                  updateEmailPrefsMutation.mutate({
                    passwordChanged: checked,
                  })
                }
                disabled={updateEmailPrefsMutation.isPending}
              />
              <NotificationToggle
                label={t("newSignIn")}
                description={t("notificationWhenYouSignIn")}
                checked={emailPrefs?.newLoginAlert ?? true}
                onChange={(checked) =>
                  updateEmailPrefsMutation.mutate({ newLoginAlert: checked })
                }
                disabled={updateEmailPrefsMutation.isPending}
              />
            </div>
          </div>

          {/* Engagement Section */}
          <div>
            <div className="mb-4 flex items-center gap-2">
              <Mail className="h-4 w-4 text-gray-500 dark:text-gray-400" />
              <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 uppercase tracking-wide">
                {t("engagement")}
              </h3>
            </div>
            <div className="space-y-3 pl-6">
              <NotificationToggle
                label={t("onboardingMilestones")}
                description={t("celebrateYourFirstClientsProjects")}
                checked={emailPrefs?.onboardingMilestones ?? true}
                onChange={(checked) =>
                  updateEmailPrefsMutation.mutate({
                    onboardingMilestones: checked,
                  })
                }
                disabled={updateEmailPrefsMutation.isPending}
              />
              <NotificationToggle
                label={t("inactivityReminder")}
                description={t("aGentleReminderAfter14")}
                checked={emailPrefs?.inactivityReminder ?? true}
                onChange={(checked) =>
                  updateEmailPrefsMutation.mutate({
                    inactivityReminder: checked,
                  })
                }
                disabled={updateEmailPrefsMutation.isPending}
              />
              <NotificationToggle
                label={t("personalOnboardingEmails")}
                description={t("onboardingDesc", { brand: brand.name })}
                checked={emailPrefs?.dripEmails ?? true}
                onChange={(checked) =>
                  updateEmailPrefsMutation.mutate({ dripEmails: checked })
                }
                disabled={updateEmailPrefsMutation.isPending}
              />
              <NotificationToggle
                label={t("tipsAndTricks")}
                description={t("tipsDesc", { brand: brand.name })}
                checked={emailPrefs?.tipsAndTricks ?? false}
                onChange={(checked) =>
                  updateEmailPrefsMutation.mutate({ tipsAndTricks: checked })
                }
                disabled={updateEmailPrefsMutation.isPending}
              />
            </div>
          </div>

          {/* Client Notifications Section */}
          <div>
            <div className="mb-4 flex items-center gap-2">
              <Users className="h-4 w-4 text-gray-500 dark:text-gray-400" />
              <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 uppercase tracking-wide">
                {t("notificationsToClients")}
              </h3>
            </div>
            <div className="space-y-3 pl-6">
              <NotificationToggle
                label={t("invoiceSent")}
                description={t("confirmationWhenInvoicesAreSent")}
                checked={emailPrefs?.clientInvoices ?? true}
                onChange={(checked) =>
                  updateEmailPrefsMutation.mutate({ clientInvoices: checked })
                }
                disabled={updateEmailPrefsMutation.isPending}
              />
              <NotificationToggle
                label={t("prepaidPackageAlerts")}
                description={t("notificationWhenAPrepaidPackage")}
                checked={emailPrefs?.clientPrepaidAlerts ?? false}
                onChange={(checked) =>
                  updateEmailPrefsMutation.mutate({
                    clientPrepaidAlerts: checked,
                  })
                }
                disabled={updateEmailPrefsMutation.isPending}
              />
            </div>
          </div>

          {/* Klippekort Alert Recipient */}
          <div>
            <div className="mb-4 flex items-center gap-2">
              <Ticket className="h-4 w-4 text-brand-500 dark:text-brand-400" />
              <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 uppercase tracking-wide">
                {t("prepaidPackageRecipient")}
              </h3>
            </div>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-3 pl-6">
              {t("whoShouldReceiveAlertsAbout")}
            </p>
            <div className="space-y-2 pl-6">
              {(
                [
                  { value: "owner", label: t("onlyMe") },
                  { value: "client", label: t("onlyTheClient") },
                  { value: "both", label: t("both") },
                ] as const
              ).map((option) => (
                <label
                  key={option.value}
                  className="flex items-center gap-3 cursor-pointer"
                >
                  <input
                    type="radio"
                    name="prepaidAlertRecipient"
                    value={option.value}
                    checked={
                      (userProfile?.prepaidAlertRecipient ?? "owner") ===
                      option.value
                    }
                    onChange={() =>
                      updateAlertRecipientMutation.mutate({
                        prepaidAlertRecipient: option.value,
                      })
                    }
                    disabled={updateAlertRecipientMutation.isPending}
                    className="h-4 w-4 border-gray-300 text-brand-600 dark:text-brand-400 focus:ring-brand-500"
                  />
                  <span className="text-sm text-gray-700 dark:text-gray-300">
                    {option.label}
                  </span>
                </label>
              ))}
            </div>
          </div>
        </div>

        {/* Quiet Hours */}
        <div
          id="stille-timer"
          className="mt-6 pt-6 border-t border-gray-200 dark:border-gray-700"
        >
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="font-medium text-gray-900 dark:text-white">
                {t("quietHours")}
              </h3>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                {t("doNotReceiveEmailNotifications")}
              </p>
            </div>
            <button
              type="button"
              onClick={() =>
                updateEmailPrefsMutation.mutate({
                  quietHoursEnabled: !emailPrefs?.quietHoursEnabled,
                })
              }
              role="switch"
              aria-checked={!!emailPrefs?.quietHoursEnabled}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tt-fokus ${switchTrack(!!emailPrefs?.quietHoursEnabled)}`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full transition-transform ${switchThumb(!!emailPrefs?.quietHoursEnabled)} ${
                  emailPrefs?.quietHoursEnabled
                    ? "translate-x-6"
                    : "translate-x-1"
                }`}
              />
            </button>
          </div>

          {emailPrefs?.quietHoursEnabled && (
            <div className="flex items-center gap-4">
              <div>
                <label
                  htmlFor={`${fid}-f2`}
                  className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1.5"
                >
                  {t("from")}
                </label>
                <input
                  id={`${fid}-f2`}
                  type="time"
                  value={emailPrefs?.quietHoursStart || "22:00"}
                  onChange={(e) =>
                    updateEmailPrefsMutation.mutate({
                      quietHoursStart: e.target.value,
                    })
                  }
                  className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-1.5 text-sm text-gray-900 dark:text-white focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20"
                />
              </div>
              <div>
                <label
                  htmlFor={`${fid}-f3`}
                  className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1.5"
                >
                  {t("to")}
                </label>
                <input
                  id={`${fid}-f3`}
                  type="time"
                  value={emailPrefs?.quietHoursEnd || "08:00"}
                  onChange={(e) =>
                    updateEmailPrefsMutation.mutate({
                      quietHoursEnd: e.target.value,
                    })
                  }
                  className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-1.5 text-sm text-gray-900 dark:text-white focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20"
                />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Discord Webhook */}
      <div
        id="discord"
        className="rounded-xl border border-gray-200/80 dark:border-gray-800 bg-white dark:bg-gray-900 p-6"
      >
        <div className="flex items-start gap-4 mb-6">
          <div className="h-12 w-12 rounded-lg bg-indigo-500 flex items-center justify-center shrink-0">
            <MessageSquare className="h-6 w-6 text-white" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-gray-900 dark:text-white">
              Discord
            </h2>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              {t("receiveNotificationsDirectlyInYour")}
            </p>
          </div>
        </div>

        {discordChannel?.discordConnected ? (
          <div className="space-y-4">
            {/* Active days */}
            <div className="rounded-lg border border-gray-200 dark:border-gray-800 p-4">
              <h4 className="text-sm font-medium text-gray-900 dark:text-white mb-1">
                {t("activeDays")}
              </h4>
              <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
                {t("chooseWhichWeekdaysDiscordShould")}
              </p>
              <ActiveDaysSelector
                value={discordChannel.activeDays}
                onChange={(activeDays) =>
                  updateChannelPrefsMutation.mutate({
                    channelId: discordChannel.id,
                    activeDays,
                  })
                }
                disabled={updateChannelPrefsMutation.isPending}
              />
            </div>
            <div className="flex items-center justify-between p-4 rounded-lg bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800">
              <div className="flex items-center gap-3">
                <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400" />
                <div>
                  <p className="font-medium text-green-800 dark:text-green-200">
                    {t("connectedTo", {
                      name: discordChannel.discordWebhookName ?? "",
                    })}
                  </p>
                  {discordChannel.lastTestedAt && (
                    <p className="text-xs text-green-700 dark:text-green-300">
                      {t("lastTested", {
                        date: new Date(
                          discordChannel.lastTestedAt,
                        ).toLocaleString(toIntlLocale(locale)),
                      })}
                      {discordChannel.lastTestStatus === "success" && " ✓"}
                    </p>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => testDiscordMutation.mutate()}
                  disabled={testDiscordMutation.isPending}
                  className="inline-flex items-center gap-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-1.5 text-sm text-gray-900 dark:text-white focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20 font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-600"
                >
                  {testDiscordMutation.isPending ? (
                    <RefreshCw className="h-4 w-4 animate-spin" />
                  ) : (
                    <Send className="h-4 w-4" />
                  )}
                  {t("test")}
                </button>
                <button
                  type="button"
                  onClick={() => setShowRemoveDiscordConfirm(true)}
                  className="p-2 rounded-lg text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* Discord notification preferences */}
            <div className="space-y-3 pt-4">
              <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300">
                {t("reportsOverviews")}
              </h4>
              <NotificationToggle
                label={t("dailySummary")}
                description={t("receiveADailySummaryOf")}
                checked={discordChannel.sendDailyDigest ?? false}
                onChange={(checked) =>
                  updateChannelPrefsMutation.mutate({
                    channelId: discordChannel.id,
                    sendDailyDigest: checked,
                  })
                }
              />
              <NotificationToggle
                label={t("weeklyReport")}
                description={t("receiveAWeeklySummaryEvery")}
                checked={discordChannel.sendWeeklyReview ?? false}
                onChange={(checked) =>
                  updateChannelPrefsMutation.mutate({
                    channelId: discordChannel.id,
                    sendWeeklyReview: checked,
                  })
                }
              />
            </div>

            <div className="space-y-3 pt-4 border-t border-gray-200 dark:border-gray-700 mt-4">
              <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300">
                {t("timerNotifications")}
              </h4>
              <NotificationToggle
                label={t("timerStarted")}
                description={t("getNotifiedWhenYourTimer")}
                checked={discordChannel.sendTimerStart ?? false}
                onChange={(checked) =>
                  updateChannelPrefsMutation.mutate({
                    channelId: discordChannel.id,
                    sendTimerStart: checked,
                  })
                }
              />
              <NotificationToggle
                label={t("timerStopped")}
                description={t("getNotifiedWhenYourTimer2")}
                checked={discordChannel.sendTimerStop ?? false}
                onChange={(checked) =>
                  updateChannelPrefsMutation.mutate({
                    channelId: discordChannel.id,
                    sendTimerStop: checked,
                  })
                }
              />
              <NotificationToggle
                label={t("inactivityWarning")}
                description={t("getNotifiedIfTheTimer")}
                checked={discordChannel.sendIdleWarning ?? false}
                onChange={(checked) =>
                  updateChannelPrefsMutation.mutate({
                    channelId: discordChannel.id,
                    sendIdleWarning: checked,
                  })
                }
              />
              <NotificationToggle
                label={t("dailyOverview")}
                description={t("dailySummaryOfLoggedTime2")}
                checked={discordChannel.sendEndOfDay ?? false}
                onChange={(checked) =>
                  updateChannelPrefsMutation.mutate({
                    channelId: discordChannel.id,
                    sendEndOfDay: checked,
                  })
                }
              />
            </div>

            <div className="space-y-3 pt-4 border-t border-gray-200 dark:border-gray-700 mt-4">
              <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300">
                {t("remindersAlerts")}
              </h4>
              <NotificationToggle
                label={t("deadlineReminders")}
                description={t("getNotifiedBeforeADeadline")}
                checked={discordChannel.sendDeadlineReminders ?? true}
                onChange={(checked) =>
                  updateChannelPrefsMutation.mutate({
                    channelId: discordChannel.id,
                    sendDeadlineReminders: checked,
                  })
                }
              />
              <NotificationToggle
                label={t("overdueDeadline")}
                description={t("getNotifiedWhenADeadline")}
                checked={discordChannel.sendOverdueAlerts ?? true}
                onChange={(checked) =>
                  updateChannelPrefsMutation.mutate({
                    channelId: discordChannel.id,
                    sendOverdueAlerts: checked,
                  })
                }
              />
              <NotificationToggle
                label={t("uninvoicedReminder")}
                description={t("reminderAboutUninvoicedHours")}
                checked={discordChannel.sendUnbilledReminders ?? true}
                onChange={(checked) =>
                  updateChannelPrefsMutation.mutate({
                    channelId: discordChannel.id,
                    sendUnbilledReminders: checked,
                  })
                }
              />
              <NotificationToggle
                label={t("aiSuggestions")}
                description={t("receiveSmartSuggestionsForManaging")}
                checked={discordChannel.sendAiSuggestions ?? false}
                onChange={(checked) =>
                  updateChannelPrefsMutation.mutate({
                    channelId: discordChannel.id,
                    sendAiSuggestions: checked,
                  })
                }
              />
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label
                  htmlFor={`${fid}-f4`}
                  className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1.5"
                >
                  {t("webhookUrl")}
                </label>
                <input
                  id={`${fid}-f4`}
                  type="url"
                  value={discordWebhookUrl}
                  onChange={(e) => setDiscordWebhookUrl(e.target.value)}
                  placeholder="https://discord.com/api/webhooks/..."
                  className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-1.5 text-sm text-gray-900 dark:text-white focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20"
                />
              </div>
              <div>
                <label
                  htmlFor={`${fid}-f5`}
                  className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1.5"
                >
                  {t("name")}
                </label>
                <input
                  id={`${fid}-f5`}
                  type="text"
                  value={discordWebhookName}
                  onChange={(e) => setDiscordWebhookName(e.target.value)}
                  placeholder={t("eGTimetrackAlerts")}
                  className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-1.5 text-sm text-gray-900 dark:text-white focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20"
                />
              </div>
            </div>
            <button
              type="button"
              onClick={handleAddDiscord}
              disabled={addDiscordMutation.isPending}
              className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {addDiscordMutation.isPending ? (
                <RefreshCw className="h-4 w-4 animate-spin" />
              ) : (
                <MessageSquare className="h-4 w-4" />
              )}
              {t("connectDiscord")}
            </button>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {t("youCanCreateAWebhook")}
            </p>
          </div>
        )}
      </div>

      {/* Browser Push Notifications */}
      <div
        id="push"
        className="rounded-xl border border-gray-200/80 dark:border-gray-800 bg-white dark:bg-gray-900 p-6"
      >
        <div className="flex items-start gap-4 mb-6">
          <div className="h-12 w-12 rounded-lg bg-amber-500 flex items-center justify-center shrink-0">
            <Bell className="h-6 w-6 text-white" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-gray-900 dark:text-white">
              {t("browserPushNotifications")}
            </h2>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              {t("receiveNotificationsDirectlyInYour2")}
            </p>
          </div>
        </div>

        {!pushConfig?.configured ? (
          <div className="p-4 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
            <div className="flex items-start gap-3">
              <AlertCircle className="h-5 w-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
                  {t("pushNotificationsAreNotConfigured2")}
                </p>
                <p className="text-sm text-amber-700 dark:text-amber-300 mt-1">
                  {t("contactAnAdministratorToEnable")}
                </p>
              </div>
            </div>
          </div>
        ) : pushChannel?.pushConnected ? (
          <div className="space-y-4">
            <div className="flex items-center justify-between p-4 rounded-lg bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800">
              <div className="flex items-center gap-3">
                <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400" />
                <div>
                  <p className="font-medium text-green-800 dark:text-green-200">
                    {t("pushNotificationsEnabled2")}
                  </p>
                  {pushChannel.lastTestedAt && (
                    <p className="text-xs text-green-700 dark:text-green-300">
                      {t("lastTested", {
                        date: new Date(pushChannel.lastTestedAt).toLocaleString(
                          toIntlLocale(locale),
                        ),
                      })}
                    </p>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => testPushMutation.mutate()}
                  disabled={testPushMutation.isPending}
                  className="inline-flex items-center gap-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-1.5 text-sm text-gray-900 dark:text-white focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20 font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-600"
                >
                  {testPushMutation.isPending ? (
                    <RefreshCw className="h-4 w-4 animate-spin" />
                  ) : (
                    <Send className="h-4 w-4" />
                  )}
                  {t("test")}
                </button>
                <button
                  type="button"
                  onClick={() => setShowDisablePushConfirm(true)}
                  className="p-2 rounded-lg text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20"
                >
                  <BellOff className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* Active days */}
            <div className="rounded-lg border border-gray-200 dark:border-gray-800 p-4">
              <h4 className="text-sm font-medium text-gray-900 dark:text-white mb-1">
                {t("activeDays")}
              </h4>
              <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
                {t("chooseWhichWeekdaysYouWant")}
              </p>
              <ActiveDaysSelector
                value={pushChannel.activeDays}
                onChange={(activeDays) =>
                  updateChannelPrefsMutation.mutate({
                    channelId: pushChannel.id,
                    activeDays,
                  })
                }
                disabled={updateChannelPrefsMutation.isPending}
              />
            </div>

            {/* Push notification preferences */}
            <div className="space-y-3 pt-4">
              <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300">
                {t("whichNotificationsDoYouWant")}
              </h4>
              <NotificationToggle
                label={t("deadlineReminders")}
                checked={pushChannel.sendDeadlineReminders ?? true}
                onChange={(checked) =>
                  updateChannelPrefsMutation.mutate({
                    channelId: pushChannel.id,
                    sendDeadlineReminders: checked,
                  })
                }
              />
              <NotificationToggle
                label={t("overdueDeadline")}
                checked={pushChannel.sendOverdueAlerts ?? true}
                onChange={(checked) =>
                  updateChannelPrefsMutation.mutate({
                    channelId: pushChannel.id,
                    sendOverdueAlerts: checked,
                  })
                }
              />
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-gray-600 dark:text-gray-400">
              {t("pushEnableText", { brand: brand.name })}
            </p>
            <button
              type="button"
              onClick={handleSubscribePush}
              disabled={subscribePushMutation.isPending}
              className="inline-flex items-center gap-2 rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50"
            >
              {subscribePushMutation.isPending ? (
                <RefreshCw className="h-4 w-4 animate-spin" />
              ) : (
                <Bell className="h-4 w-4" />
              )}
              {t("enablePush")}
            </button>
          </div>
        )}
      </div>

      {/* PWA Settings */}
      <div
        id="pwa"
        className="rounded-xl border border-gray-200/80 dark:border-gray-800 bg-white dark:bg-gray-900 p-6"
      >
        <div className="flex items-start gap-4 mb-6">
          <div className="h-12 w-12 rounded-lg bg-purple-500 flex items-center justify-center shrink-0">
            <Moon className="h-6 w-6 text-white" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-gray-900 dark:text-white">
              {t("pwaSettings")}
            </h2>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              {t("progressiveWebAppFeaturesFor")}
            </p>
          </div>
        </div>

        <div className="space-y-6">
          {/* Idle Detection */}
          <div className="flex items-start gap-4">
            <div className="flex-shrink-0 rounded-lg bg-purple-100 dark:bg-purple-900/30 p-3">
              <Moon className="h-5 w-5 text-purple-600 dark:text-purple-400" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="mb-1 flex items-start justify-between gap-3">
                <h3 className="font-medium text-gray-900 dark:text-white">
                  {t("idleDetection")}
                </h3>
                <AutoSaveStatus
                  status={idleForm.status}
                  onRetry={idleForm.retry}
                />
              </div>
              <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
                {t("theTimerDoesNotPause")}
              </p>
              <div className="space-y-4">
                <div>
                  <label
                    htmlFor="idle-threshold"
                    className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2"
                  >
                    {t("idleAskAfter", { minutes: idleThreshold })}
                  </label>
                  <input
                    type="range"
                    id="idle-threshold"
                    disabled={!idleSettings}
                    min="1"
                    max="30"
                    step="1"
                    value={idleThreshold}
                    onChange={(e) =>
                      idleForm.set(
                        "idleThreshold",
                        Number.parseInt(e.target.value, 10),
                        "debounce",
                      )
                    }
                    onPointerUp={idleForm.flush}
                    onKeyUp={idleForm.flush}
                    onBlur={idleForm.flush}
                    className="w-full h-2 bg-gray-100 dark:bg-gray-800 rounded-lg appearance-none cursor-pointer accent-brand-600"
                  />
                  <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400 mt-1">
                    <span>{t("n1Min")}</span>
                    <span>{t("n15Min")}</span>
                    <span>{t("n30Min")}</span>
                  </div>
                </div>
                <div>
                  <label
                    htmlFor="auto-pause-after"
                    className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2"
                  >
                    {t("autoPause")}
                  </label>
                  <select
                    id="auto-pause-after"
                    disabled={!idleSettings}
                    value={
                      autoPauseAfter === null ? "off" : String(autoPauseAfter)
                    }
                    onChange={(e) =>
                      idleForm.set(
                        "autoPauseAfter",
                        e.target.value === "off"
                          ? null
                          : Number.parseInt(e.target.value, 10),
                        "now",
                      )
                    }
                    className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-white"
                  >
                    <option value="60">{t("after1Hour")}</option>
                    <option value="120">{t("after2Hours")}</option>
                    <option value="180">{t("after3Hours")}</option>
                    <option value="240">{t("after4Hours")}</option>
                    <option value="off">{t("never")}</option>
                  </select>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                    {t("aSafetyNetForA")}
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Periodic Sync */}
          <div
            id="ugerapporter"
            className="flex items-start gap-4 pt-6 border-t border-gray-200 dark:border-gray-700"
          >
            <div className="flex-shrink-0 rounded-lg bg-green-100 dark:bg-green-900/30 p-3">
              <Repeat className="h-5 w-5 text-green-600 dark:text-green-400" />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="font-medium text-gray-900 dark:text-white mb-1">
                {t("automaticWeeklyReports")}
              </h3>
              <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
                {t("automaticallyReceiveAWeeklyReport")}
              </p>
              {!periodicSync.isSupported && (
                <div className="rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 p-3 mb-4">
                  <p className="text-sm text-amber-800 dark:text-amber-400">
                    {t("automaticReportsRequireTheApp")}
                  </p>
                </div>
              )}
              <button
                type="button"
                onClick={periodicSync.toggle}
                disabled={
                  !periodicSync.isSupported || periodicSync.isRequesting
                }
                className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                  periodicSync.isRegistered
                    ? "bg-red-600 text-white hover:bg-red-700 disabled:bg-red-400"
                    : "bg-green-600 text-white hover:bg-green-700 disabled:bg-green-400"
                }`}
              >
                {periodicSync.isRequesting
                  ? t("processing")
                  : periodicSync.isRegistered
                    ? t("disableReports")
                    : t("enableReports")}
              </button>
            </div>
          </div>

          {/* Badge Counter */}
          <div className="flex items-start gap-4 pt-6 border-t border-gray-200 dark:border-gray-700">
            <div className="flex-shrink-0 rounded-lg bg-red-100 dark:bg-red-900/30 p-3">
              <Shield className="h-5 w-5 text-red-600 dark:text-red-400" />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="font-medium text-gray-900 dark:text-white mb-1">
                {t("appBadgeCounter")}
              </h3>
              <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
                {t("showTheNumberOfHours")}
              </p>
              {!badge.isSupported && (
                <div className="rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 p-3 mb-4">
                  <p className="text-sm text-amber-800 dark:text-amber-400">
                    {t("theBadgeCounterIsOnly")}
                  </p>
                </div>
              )}
              {badge.isSupported && (
                <div className="flex items-center gap-4">
                  <div className="text-sm text-gray-600 dark:text-gray-400">
                    {t("enabledAutomaticallyWhenATimer")}
                  </div>
                  {badge.count > 0 && (
                    <div className="rounded-full bg-red-600 px-3 py-1 text-sm font-medium text-white">
                      {badge.count} min
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* System Status */}
          <div className="flex items-start gap-4 pt-6 border-t border-gray-200 dark:border-gray-700">
            <div className="flex-shrink-0 rounded-lg bg-gray-100 dark:bg-gray-800 p-3">
              <Clock className="h-5 w-5 text-gray-600 dark:text-gray-400" />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="font-medium text-gray-900 dark:text-white mb-4">
                {t("systemStatus")}
              </h3>
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-600 dark:text-gray-400">
                    Service Worker
                  </span>
                  <span className="font-medium text-green-600 dark:text-green-400">
                    {t("active")}
                  </span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-600 dark:text-gray-400">
                    {t("pushNotifications")}
                  </span>
                  <span
                    className={`font-medium ${
                      pushNotifications.isSupported
                        ? "text-green-600 dark:text-green-400"
                        : "text-gray-400"
                    }`}
                  >
                    {pushNotifications.isSupported
                      ? t("supported")
                      : t("notSupported")}
                  </span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-600 dark:text-gray-400">
                    Badge API
                  </span>
                  <span
                    className={`font-medium ${
                      badge.isSupported
                        ? "text-green-600 dark:text-green-400"
                        : "text-gray-400"
                    }`}
                  >
                    {badge.isSupported ? t("supported") : t("notSupported")}
                  </span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-600 dark:text-gray-400">
                    {t("periodicSync")}
                  </span>
                  <span
                    className={`font-medium ${
                      periodicSync.isSupported
                        ? "text-green-600 dark:text-green-400"
                        : "text-gray-400"
                    }`}
                  >
                    {periodicSync.isSupported
                      ? t("supported")
                      : t("notSupported")}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Help Section */}
      <div className="rounded-lg border border-brand-200 dark:border-brand-600 bg-brand-50 dark:bg-tt-gran-lys p-6">
        <div className="flex items-start gap-4">
          <AlertCircle className="h-6 w-6 shrink-0 text-brand-600 dark:text-brand-400" />
          <div>
            <h3 className="font-semibold text-gray-900 dark:text-white">
              {t("aboutNotifications")}
            </h3>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
              {t("aboutText", { brand: brand.name })}
            </p>
            <ul className="mt-3 text-sm text-gray-600 dark:text-gray-400 space-y-2 list-disc list-inside">
              <li>
                <strong>{t("email")}</strong> {t("reportsAndSummariesAreSent")}
              </li>
              <li>
                <strong>Discord:</strong> {t("realTimeNotificationsToYour")}
              </li>
              <li>
                <strong>Push:</strong> {t("instantNotificationsInYourBrowser")}
              </li>
              <li>
                <strong>PWA:</strong>{" "}
                {t("offlineFeaturesAndDesktopIntegration")}
              </li>
            </ul>
          </div>
        </div>
      </div>

      <ConfirmDialog
        isOpen={showRemoveDiscordConfirm}
        onClose={() => setShowRemoveDiscordConfirm(false)}
        onConfirm={() => {
          removeDiscordMutation.mutate();
          setShowRemoveDiscordConfirm(false);
        }}
        title={t("removeDiscordWebhook")}
        description={t("areYouSureYouWant")}
        confirmLabel={t("remove")}
        variant="danger"
        isLoading={removeDiscordMutation.isPending}
      />

      <ConfirmDialog
        isOpen={showDisablePushConfirm}
        onClose={() => setShowDisablePushConfirm(false)}
        onConfirm={() => {
          unsubscribePushMutation.mutate();
          setShowDisablePushConfirm(false);
        }}
        title={t("disablePushNotifications")}
        description={t("areYouSureYouWant2")}
        confirmLabel={t("disable")}
        variant="danger"
        isLoading={unsubscribePushMutation.isPending}
      />
    </div>
  );
}
