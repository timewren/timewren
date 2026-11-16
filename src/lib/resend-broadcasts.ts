/**
 * Resend Broadcasts service
 * Create and send newsletters/announcements to audiences or segments.
 */

import { getEmailDomain } from "@/lib/config";
import { getResend } from "@/lib/resend";

const AUDIENCE_ID = process.env.RESEND_AUDIENCE_ID;

function getAudienceId(): string {
  if (!AUDIENCE_ID) {
    throw new Error("RESEND_AUDIENCE_ID is not configured.");
  }
  return AUDIENCE_ID;
}

export interface BroadcastData {
  name: string;
  subject: string;
  html: string;
  audienceId?: string;
  from?: string;
}

/**
 * Create a broadcast (draft state).
 */
export async function createBroadcast(data: BroadcastData) {
  const resend = getResend();
  const audienceId = data.audienceId || getAudienceId();

  const response = await resend.broadcasts.create({
    name: data.name,
    audienceId,
    from:
      data.from ||
      process.env.RESEND_FROM_EMAIL ||
      `noreply@${getEmailDomain()}`,
    subject: data.subject,
    html: data.html,
  });

  if (response.error) {
    throw new Error(
      `Failed to create broadcast: ${JSON.stringify(response.error)}`,
    );
  }

  return response.data;
}

/**
 * Send a previously created broadcast.
 */
export async function sendBroadcast(broadcastId: string) {
  const resend = getResend();

  const response = await resend.broadcasts.send(broadcastId);

  if (response.error) {
    throw new Error(
      `Failed to send broadcast: ${JSON.stringify(response.error)}`,
    );
  }

  return response.data;
}

/**
 * List all broadcasts.
 */
export async function listBroadcasts() {
  const resend = getResend();

  const response = await resend.broadcasts.list();

  if (response.error) {
    throw new Error(
      `Failed to list broadcasts: ${JSON.stringify(response.error)}`,
    );
  }

  return response.data;
}

/**
 * Get a specific broadcast by ID.
 */
export async function getBroadcast(broadcastId: string) {
  const resend = getResend();

  const response = await resend.broadcasts.get(broadcastId);

  if (response.error) {
    throw new Error(
      `Failed to get broadcast: ${JSON.stringify(response.error)}`,
    );
  }

  return response.data;
}

/**
 * Remove/delete a broadcast.
 */
export async function removeBroadcast(broadcastId: string) {
  const resend = getResend();

  const response = await resend.broadcasts.remove(broadcastId);

  if (response.error) {
    throw new Error(
      `Failed to remove broadcast: ${JSON.stringify(response.error)}`,
    );
  }

  return response.data;
}
