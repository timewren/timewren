"use client";

import { Bell, Send, Trash2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui";
import { toIntlLocale } from "@/i18n/format-locale";
import {
  NOTIFICATION_CHANNELS,
  NOTIFICATION_GROUPS,
  type NotificationChannelKey,
  type NotificationGroup,
} from "@/lib/notifications/bus/groups";
import { trpc } from "@/providers/trpc-provider";

type Matrix = Record<
  NotificationGroup,
  Record<NotificationChannelKey, boolean>
>;

const DIGEST_OPTIONS: Array<{
  value: "off" | "daily" | "weekly";
  labelKey: "digestOff" | "digestDaily" | "digestWeekly";
}> = [
  { value: "off", labelKey: "digestOff" },
  { value: "daily", labelKey: "digestDaily" },
  { value: "weekly", labelKey: "digestWeekly" },
];

/**
 * Enterprise-indstillinger → Notifikationer (E10, #468): org-defaults pr.
 * kanal × hændelsesgruppe, Microsoft Teams-webhook, leder-digest og eskalering.
 */
export function NotificationSettingsSection() {
  const t = useTranslations("enterpriseSettings.notif");
  const utils = trpc.useUtils();
  const { data, isLoading } =
    trpc.enterprise.getNotificationSettings.useQuery();

  const [matrix, setMatrix] = useState<Matrix | null>(null);
  const [digest, setDigest] = useState<"off" | "daily" | "weekly">("off");
  const [escalationDays, setEscalationDays] = useState("");
  const [webhookUrl, setWebhookUrl] = useState("");

  useEffect(() => {
    if (!data) return;
    setMatrix(data.effectiveDefaults as Matrix);
    setDigest(data.managerDigest);
    setEscalationDays(
      data.escalationDays != null ? String(data.escalationDays) : "",
    );
  }, [data]);

  const invalidate = () =>
    utils.enterprise.getNotificationSettings.invalidate();

  const updateMutation = trpc.enterprise.updateNotificationSettings.useMutation(
    {
      onSuccess: () => {
        invalidate();
        toast.success(t("saved"));
      },
      onError: (e) => toast.error(e.message || t("saveFailed")),
    },
  );
  const setWebhookMutation = trpc.enterprise.setTeamsWebhook.useMutation({
    onSuccess: () => {
      invalidate();
      setWebhookUrl("");
      toast.success(t("webhookSaved"), {
        description: t("webhookSavedHint"),
      });
    },
    onError: (e) => toast.error(e.message || t("webhookSaveFailed")),
  });
  const removeWebhookMutation = trpc.enterprise.removeTeamsWebhook.useMutation({
    onSuccess: () => {
      invalidate();
      toast.success(t("webhookRemoved"));
    },
    onError: (e) => toast.error(e.message || t("webhookRemoveFailed")),
  });
  const testMutation = trpc.enterprise.testTeamsWebhook.useMutation({
    onSuccess: () => toast.success(t("testSent")),
    onError: (e) => toast.error(e.message || t("testFailed")),
  });

  if (isLoading || !data || !matrix) {
    return (
      <section className="rounded-lg border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-800">
        <div className="h-24 animate-pulse rounded bg-gray-100 dark:bg-gray-700" />
      </section>
    );
  }

  const toggle = (
    group: NotificationGroup,
    channel: NotificationChannelKey,
    value: boolean,
  ) => {
    setMatrix((m) =>
      m ? { ...m, [group]: { ...m[group], [channel]: value } } : m,
    );
  };

  const saveMatrix = () => {
    if (!matrix) return;
    updateMutation.mutate({ channelDefaults: matrix });
  };

  const saveDigest = () => {
    const parsed = escalationDays.trim() === "" ? null : Number(escalationDays);
    if (parsed !== null && (!Number.isInteger(parsed) || parsed < 1)) {
      toast.error(t("escalationInvalid"));
      return;
    }
    updateMutation.mutate({ managerDigest: digest, escalationDays: parsed });
  };

  const teamsConfigured = data.teams.configured;

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-800">
      <h3 className="mb-1 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
        <Bell className="h-4 w-4" />
        {t("title")}
      </h3>
      <p className="mb-6 text-sm text-gray-600 dark:text-gray-400">
        {t("intro")}
      </p>

      {/* Kanal-matrix */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-500 dark:border-gray-700 dark:text-gray-400">
              <th className="py-2 pr-4 font-medium">{t("event")}</th>
              {NOTIFICATION_CHANNELS.map((c) => (
                <th key={c} className="px-2 py-2 text-center font-medium">
                  {t(`channel.${c}`)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {NOTIFICATION_GROUPS.map((group) => (
              <tr
                key={group}
                className="border-b border-gray-100 dark:border-gray-700/60"
              >
                <td className="py-3 pr-4">
                  <div className="font-medium text-gray-900 dark:text-white">
                    {t(`group.${group}`)}
                  </div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">
                    {t(`groupDesc.${group}`)}
                  </div>
                </td>
                {NOTIFICATION_CHANNELS.map((channel) => {
                  const disabled = channel === "teams" && !teamsConfigured;
                  return (
                    <td key={channel} className="px-2 py-3 text-center">
                      <input
                        type="checkbox"
                        aria-label={t("groupViaChannel", {
                          group: t(`group.${group}`),
                          channel: t(`channel.${channel}`),
                        })}
                        className="h-4 w-4 rounded border-gray-300 text-brand-600 dark:text-brand-400 focus:ring-brand-500 disabled:opacity-40"
                        checked={matrix[group][channel]}
                        disabled={disabled}
                        title={disabled ? t("addWebhookFirst") : undefined}
                        onChange={(e) =>
                          toggle(group, channel, e.target.checked)
                        }
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
        {t("teamsNote")}
      </p>
      <div className="mt-4">
        <Button
          size="sm"
          onClick={saveMatrix}
          isLoading={updateMutation.isPending}
        >
          {t("saveDefaults")}
        </Button>
      </div>

      {/* Teams */}
      <div className="mt-8 border-t border-gray-200 pt-6 dark:border-gray-700">
        <h4 className="mb-1 text-sm font-semibold text-gray-900 dark:text-white">
          {t("teamsTitle")}
        </h4>
        <p className="mb-4 text-sm text-gray-600 dark:text-gray-400">
          {t("teamsInfo")}
        </p>
        {teamsConfigured ? (
          <div className="flex flex-wrap items-center gap-3">
            <code className="rounded bg-gray-100 px-2 py-1 text-xs text-gray-700 dark:bg-gray-700 dark:text-gray-200">
              {data.teams.maskedUrl}
            </code>
            <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-gray-300 text-brand-600 dark:text-brand-400"
                checked={data.teams.enabled}
                onChange={(e) =>
                  updateMutation.mutate({ teamsEnabled: e.target.checked })
                }
              />
              {t("active")}
            </label>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => testMutation.mutate()}
              isLoading={testMutation.isPending}
            >
              <Send className="mr-1.5 h-4 w-4" />
              {t("sendTest")}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => removeWebhookMutation.mutate()}
              isLoading={removeWebhookMutation.isPending}
            >
              <Trash2 className="mr-1.5 h-4 w-4" />
              {t("remove")}
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              type="url"
              value={webhookUrl}
              onChange={(e) => setWebhookUrl(e.target.value)}
              placeholder="https://….webhook.office.com/… eller https://….logic.azure.com/…"
              className="flex-1 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 dark:border-gray-600 dark:bg-gray-900 dark:text-white"
            />
            <Button
              size="sm"
              onClick={() => setWebhookMutation.mutate({ url: webhookUrl })}
              disabled={!webhookUrl.trim()}
              isLoading={setWebhookMutation.isPending}
            >
              {t("saveWebhook")}
            </Button>
          </div>
        )}
      </div>

      {/* Digest + eskalering */}
      <div className="mt-8 border-t border-gray-200 pt-6 dark:border-gray-700">
        <h4 className="mb-1 text-sm font-semibold text-gray-900 dark:text-white">
          {t("digestTitle")}
        </h4>
        <p className="mb-4 text-sm text-gray-600 dark:text-gray-400">
          {t("digestInfo")}
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-gray-700 dark:text-gray-300">
              {t("digest")}
            </span>
            <select
              value={digest}
              onChange={(e) =>
                setDigest(e.target.value as "off" | "daily" | "weekly")
              }
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-900 dark:text-white"
            >
              {DIGEST_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {t(o.labelKey)}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-gray-700 dark:text-gray-300">
              {t("escalateAfter")}
            </span>
            <input
              type="number"
              min={1}
              max={60}
              value={escalationDays}
              onChange={(e) => setEscalationDays(e.target.value)}
              placeholder={t("noEscalation")}
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 dark:border-gray-600 dark:bg-gray-900 dark:text-white"
            />
          </label>
        </div>
        <div className="mt-4">
          <Button
            size="sm"
            onClick={saveDigest}
            isLoading={updateMutation.isPending}
          >
            {t("saveDigest")}
          </Button>
        </div>
      </div>

      <DeliveryLog />
    </section>
  );
}

function DeliveryLog() {
  const t = useTranslations("enterpriseSettings.notif");
  const intlLocale = toIntlLocale(useLocale());
  const [open, setOpen] = useState(false);
  const { data } = trpc.enterprise.listNotificationDeliveries.useQuery(
    { limit: 30 },
    { enabled: open },
  );
  return (
    <div className="mt-8 border-t border-gray-200 pt-6 dark:border-gray-700">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="text-sm font-medium text-brand-600 hover:underline dark:text-brand-400"
      >
        {open ? t("hideLog") : t("showLog")}
      </button>
      {open && (
        <div className="mt-3 overflow-x-auto">
          {data && data.length === 0 ? (
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {t("noDeliveries")}
            </p>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-gray-500 dark:text-gray-400">
                  <th className="py-1 pr-3 font-medium">{t("colTime")}</th>
                  <th className="py-1 pr-3 font-medium">{t("colEvent")}</th>
                  <th className="py-1 pr-3 font-medium">{t("colChannel")}</th>
                  <th className="py-1 pr-3 font-medium">{t("colRecipient")}</th>
                  <th className="py-1 pr-3 font-medium">{t("colStatus")}</th>
                  <th className="py-1 font-medium">{t("colError")}</th>
                </tr>
              </thead>
              <tbody>
                {(data ?? []).map((d) => (
                  <tr
                    key={d.id}
                    className="border-t border-gray-100 dark:border-gray-700/60"
                  >
                    <td className="py-1 pr-3 whitespace-nowrap text-gray-600 dark:text-gray-300">
                      {new Date(d.createdAt).toLocaleString(intlLocale)}
                    </td>
                    <td className="py-1 pr-3 text-gray-900 dark:text-white">
                      {d.event}
                    </td>
                    <td className="py-1 pr-3">{d.channel}</td>
                    <td className="py-1 pr-3">{d.recipient ?? "–"}</td>
                    <td className="py-1 pr-3">
                      <span
                        className={
                          d.status === "sent"
                            ? "text-green-600 dark:text-green-400"
                            : d.status === "failed"
                              ? "text-red-600 dark:text-red-400"
                              : "text-gray-500"
                        }
                      >
                        {d.status}
                        {d.attempts > 1 ? ` (${d.attempts})` : ""}
                      </span>
                    </td>
                    <td className="py-1 text-gray-500 dark:text-gray-400">
                      {d.error ?? ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
