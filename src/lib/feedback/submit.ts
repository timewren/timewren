/**
 * Serverlogikken bag feedback — delt mellem tRPC (`feedback.submit`) og
 * HTTP-ruten `/api/feedback`, som bugbottles panel poster til.
 *
 * Rækkefølgen er bevidst: rate-limit → screenshot-validering (hard fail) →
 * S3 (soft fail) → DB-insert (sandheden) → mail og Discord (soft fail).
 */

import { PutObjectCommand } from "@aws-sdk/client-s3";
import { render } from "@react-email/render";
import { eq } from "drizzle-orm";
import { FeedbackEmail } from "@/components/email/FeedbackEmail";
import { getFeedbackRecipient } from "@/lib/config";
import type { db as dbType } from "@/lib/db";
import { feedbackSubmissions, organizations } from "@/lib/db/schema";
import { mailT } from "@/lib/email/locale";
import { getRecipientLocale } from "@/lib/email/recipient-locale";
import type { FeedbackSubmitInput } from "@/lib/feedback/schema";
import { decodeScreenshotDataUrl } from "@/lib/feedback/screenshot";
import { notifyAdmin } from "@/lib/notifications/admin";
import { DEFAULT_FROM_EMAIL, resend } from "@/lib/resend";
import { prefixKey, S3_BUCKET, s3 } from "@/lib/s3";
import {
  ipRateLimitKey,
  rateLimiter,
  userRateLimitKey,
} from "@/lib/utils/rate-limiter";

export type FeedbackErrorCode = "RATE_LIMITED" | "INVALID_SCREENSHOT";

/** Fejl som kalderen skal oversætte til sin egen transport (tRPC-kode/HTTP-status). */
export class FeedbackSubmitError extends Error {
  constructor(
    readonly code: FeedbackErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "FeedbackSubmitError";
  }
}

export type FeedbackUser = {
  id: string;
  name?: string | null;
  email?: string | null;
};

/** Afsender uden konto (mobilappens "uden konto"-tilstand). */
export type AnonymousSender = {
  installId: string;
  contactEmail?: string;
  ip: string;
};

async function checkRateLimits(
  user: FeedbackUser | null,
  anonymous: AnonymousSender | undefined,
): Promise<boolean> {
  if (user) {
    const rl = await rateLimiter.check(
      userRateLimitKey(user.id, "feedback"),
      "feedback",
    );
    return rl.allowed;
  }
  if (!anonymous) return false;
  // Både installation og IP, så en ny installId ikke omgår grænsen
  const [byInstall, byIp] = await Promise.all([
    rateLimiter.check(
      `install:${anonymous.installId}:feedback`,
      "feedbackAnon",
    ),
    rateLimiter.check(
      ipRateLimitKey(anonymous.ip, "feedbackAnon"),
      "feedbackAnon",
    ),
  ]);
  return byInstall.allowed && byIp.allowed;
}

export async function submitFeedback({
  db,
  user,
  orgId,
  input,
  anonymous,
}: {
  db: typeof dbType;
  /** null = anonym afsender (kræver `anonymous`) */
  user: FeedbackUser | null;
  orgId: string | null;
  input: FeedbackSubmitInput;
  anonymous?: AnonymousSender;
}): Promise<{ ok: true; id: string }> {
  const userId = user?.id ?? null;
  // Driftsmailen og Discord-beskeden går til administratoren: hans sprog.
  const adminLocale = await getRecipientLocale({
    email: getFeedbackRecipient(),
  });
  const t = mailT("emailsReports", adminLocale);
  const senderName =
    user?.name ??
    (anonymous ? t("feedback.anonymousSender") : t("feedback.unknownSender"));
  const subjectLabel = t(
    input.type === "bug"
      ? "feedback.subjectBug"
      : input.type === "feature"
        ? "feedback.subjectFeature"
        : "feedback.subjectFeedback",
  );
  const senderEmail = user?.email ?? anonymous?.contactEmail ?? null;

  if (!(await checkRateLimits(user, anonymous))) {
    throw new FeedbackSubmitError(
      "RATE_LIMITED",
      "For mange indsendelser. Prøv igen senere.",
    );
  }

  // Screenshot: validér (hard fail) + upload til privat S3 (soft fail)
  let screenshotBuffer: Buffer | null = null;
  let screenshotKey: string | null = null;
  if (input.screenshotDataUrl) {
    try {
      screenshotBuffer = decodeScreenshotDataUrl(input.screenshotDataUrl);
    } catch (err) {
      throw new FeedbackSubmitError(
        "INVALID_SCREENSHOT",
        err instanceof Error ? err.message : "Ugyldigt screenshot",
      );
    }
    try {
      const key = prefixKey(`feedback/${crypto.randomUUID()}.png`);
      await s3.send(
        new PutObjectCommand({
          Bucket: S3_BUCKET,
          Key: key,
          Body: screenshotBuffer,
          ContentType: "image/png",
          // Ingen ACL — privat objekt; screenshot leveres som mail-vedhæftning
        }),
      );
      screenshotKey = key;
    } catch (err) {
      console.error("[Feedback] S3-upload fejlede:", err);
      // fortsæt — screenshot ryger stadig med i mailen fra bufferen
    }
  }

  // DB-insert = sandheden; alt efter dette er soft-fail
  const [row] = await db
    .insert(feedbackSubmissions)
    .values({
      userId,
      installId: anonymous?.installId ?? null,
      contactEmail: anonymous?.contactEmail ?? null,
      organizationId: orgId ?? null,
      type: input.type,
      message: input.message,
      context: input.context,
      screenshotKey,
    })
    .returning({ id: feedbackSubmissions.id });

  // Berig med org-navn (best effort)
  let orgName: string | undefined;
  if (orgId) {
    try {
      const org = await db.query.organizations.findFirst({
        where: eq(organizations.id, orgId),
        columns: { name: true },
      });
      orgName = org?.name ?? undefined;
    } catch {
      // org-navn er nice-to-have
    }
  }

  // Email til driftsansvarlig (soft fail). Uden FEEDBACK_TO_EMAIL kun Discord.
  const feedbackTo = getFeedbackRecipient();
  if (feedbackTo) {
    try {
      const html = await render(
        FeedbackEmail({
          type: input.type,
          message: input.message,
          userName: senderName,
          userEmail: senderEmail ?? t("feedback.unknownEmail"),
          orgName,
          context: input.context,
          hasScreenshot: !!screenshotBuffer,
          reportId: row.id,
          locale: adminLocale,
        }),
      );
      const response = await resend.emails.send({
        from: DEFAULT_FROM_EMAIL,
        to: feedbackTo,
        replyTo: senderEmail ?? undefined,
        subject: t("feedback.subject", {
          type: subjectLabel,
          sender: senderName,
          extra: senderEmail && !user?.name ? ` (${senderEmail})` : "",
        }),
        html,
        attachments: screenshotBuffer
          ? [{ filename: "screenshot.png", content: screenshotBuffer }]
          : undefined,
      });
      if (response.error) {
        console.error("[Feedback] Resend-fejl:", response.error);
      }
    } catch (err) {
      console.error("[Feedback] Email fejlede:", err);
    }
  }

  // Discord (notifyAdmin kaster aldrig)
  await notifyAdmin("feedback_received", {
    userName: senderName,
    userEmail: senderEmail ?? undefined,
    userId: userId ?? undefined,
    feedbackType: subjectLabel,
    reason: input.message.slice(0, 200),
    locale: adminLocale,
  });

  return { ok: true, id: row.id };
}
