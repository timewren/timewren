/**
 * Resend Contacts service
 * Syncs users to Resend Contacts for managed subscriptions and GDPR compliance.
 */

import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { getResend } from "@/lib/resend";

const AUDIENCE_ID = process.env.RESEND_AUDIENCE_ID;

function getAudienceId(): string {
  if (!AUDIENCE_ID) {
    throw new Error(
      "RESEND_AUDIENCE_ID is not configured. Set it in your environment variables.",
    );
  }
  return AUDIENCE_ID;
}

/**
 * Create or update a contact in the Resend audience.
 * Returns the Resend contact ID.
 */
export async function syncUserToResend(user: {
  id: string;
  email: string;
  name: string;
  createdAt?: Date;
  cvrNumber?: string | null;
}): Promise<string | null> {
  try {
    const resend = getResend();
    const audienceId = getAudienceId();

    const response = await resend.contacts.create({
      audienceId,
      email: user.email,
      firstName: user.name.split(" ")[0] || user.name,
      lastName: user.name.split(" ").slice(1).join(" ") || undefined,
      unsubscribed: false,
    });

    if (response.error) {
      console.error("[Resend Contacts] Failed to sync user:", response.error);
      return null;
    }

    const contactId = response.data?.id || null;

    // Store contact ID on user record
    if (contactId) {
      await db
        .update(users)
        .set({ resendContactId: contactId })
        .where(eq(users.id, user.id));
    }

    console.log(
      `[Resend Contacts] Synced user ${user.email} → contact ${contactId}`,
    );
    return contactId;
  } catch (err) {
    console.error("[Resend Contacts] Error syncing user:", err);
    return null;
  }
}

/**
 * Remove a contact from the Resend audience.
 */
export async function removeContactFromResend(
  contactId: string,
): Promise<void> {
  try {
    const resend = getResend();
    const audienceId = getAudienceId();

    await resend.contacts.remove({
      audienceId,
      id: contactId,
    });

    console.log(`[Resend Contacts] Removed contact ${contactId}`);
  } catch (err) {
    console.error("[Resend Contacts] Error removing contact:", err);
  }
}

/**
 * Update a contact's subscription status in Resend.
 */
export async function updateContactSubscription(
  contactId: string,
  unsubscribed: boolean,
): Promise<void> {
  try {
    const resend = getResend();
    const audienceId = getAudienceId();

    await resend.contacts.update({
      audienceId,
      id: contactId,
      unsubscribed,
    });

    console.log(
      `[Resend Contacts] Updated contact ${contactId} unsubscribed=${unsubscribed}`,
    );
  } catch (err) {
    console.error("[Resend Contacts] Error updating contact:", err);
  }
}

/**
 * Get or create the "TimeTrack Users" audience.
 * Useful for initial setup — returns the audience ID.
 */
export async function getOrCreateAudience(): Promise<string | null> {
  try {
    const resend = getResend();

    // Try to list existing audiences
    const listResponse = await resend.audiences.list();
    if (listResponse.data?.data) {
      const existing = listResponse.data.data.find(
        (a) => a.name === "TimeTrack Users",
      );
      if (existing) {
        console.log(
          `[Resend Contacts] Found existing audience: ${existing.id}`,
        );
        return existing.id;
      }
    }

    // Create new audience
    const createResponse = await resend.audiences.create({
      name: "TimeTrack Users",
    });

    if (createResponse.error) {
      console.error(
        "[Resend Contacts] Failed to create audience:",
        createResponse.error,
      );
      return null;
    }

    const audienceId = createResponse.data?.id || null;
    console.log(`[Resend Contacts] Created audience: ${audienceId}`);
    return audienceId;
  } catch (err) {
    console.error("[Resend Contacts] Error with audience:", err);
    return null;
  }
}
