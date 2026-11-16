import { pushToUser } from "@/lib/notifications/push";
import { ChannelSkipped, type NotificationChannel } from "./types";

/** Web-push (VAPID) til alle brugerens aktive abonnementer. */
export const pushChannel: NotificationChannel = {
  key: "push",
  scope: "user",
  async send(msg) {
    if (!msg.recipient) throw new ChannelSkipped("Ingen modtager");
    const result = await pushToUser(msg.recipient.userId, {
      title: msg.rendered.title,
      body: msg.rendered.body,
      url: msg.rendered.url,
      tag: `${msg.event}`,
      data: { type: msg.event },
    });
    if (result.subscriptions === 0) {
      throw new ChannelSkipped("Ingen push-abonnementer");
    }
    if (result.sent === 0) {
      throw new Error("Push-tjenesten afviste alle abonnementer");
    }
  },
};
