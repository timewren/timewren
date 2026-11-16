import { buildTeamsCard, postTeamsCard, TeamsWebhookError } from "../teams";
import { ChannelSkipped, type NotificationChannel } from "./types";

/** Org-kanal: ét Adaptive Card pr. hændelse til org'ens Teams-webhook. */
export const teamsChannel: NotificationChannel = {
  key: "teams",
  scope: "org",
  async send(msg) {
    if (!msg.teamsWebhookUrl) throw new ChannelSkipped("Ingen Teams-webhook");
    await postTeamsCard(
      msg.teamsWebhookUrl,
      buildTeamsCard(msg.rendered, { orgName: msg.orgName }),
    );
  },
  isTransient(error) {
    return error instanceof TeamsWebhookError && error.transient;
  },
};
