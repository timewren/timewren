import { db } from "@/lib/db";
import { notificationInbox } from "@/lib/db/schema";
import { ChannelSkipped, type NotificationChannel } from "./types";

/** In-app-indbakke: én række pr. modtager, læses via enterprise.listInbox. */
export const inAppChannel: NotificationChannel = {
  key: "in_app",
  scope: "user",
  async send(msg) {
    if (!msg.recipient) throw new ChannelSkipped("Ingen modtager");
    await db.insert(notificationInbox).values({
      organizationId: msg.orgId,
      userId: msg.recipient.userId,
      event: msg.event,
      title: msg.rendered.title.slice(0, 255),
      body: msg.rendered.body,
      url: msg.rendered.url,
    });
  },
};
