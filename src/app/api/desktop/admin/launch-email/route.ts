import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { createElement } from "react";
import { DesktopLaunchEmail } from "@/components/email/DesktopLaunchEmail";
import { auth } from "@/lib/auth";
import { getAppUrl, getPersonalReplyTo } from "@/lib/config";
import { db } from "@/lib/db";
import { desktopWaitlist, users } from "@/lib/db/schema";
import { mailT, normalizeMailLocale } from "@/lib/email/locale";
import { renderEmail } from "@/lib/email/render-email";
import { isMailAvailable } from "@/lib/email/transport";
import { PERSONAL_FROM_EMAIL, resend } from "@/lib/resend";

/**
 * Verify the request is from an admin user.
 */
async function verifyAdmin(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user?.id) return null;

  const user = await db.query.users.findFirst({
    where: eq(users.id, session.user.id),
    columns: { id: true, role: true },
  });

  if (user?.role !== "admin") return null;
  return user;
}

/**
 * POST /api/desktop/admin/launch-email
 *
 * Send a "TimeTrack Desktop er klar" email to all waitlist entries.
 *
 * Auth: admin role required.
 * Body: { subject?: string, customMessage?: string }
 * Returns: { sent: number, failed: number }
 */
export async function POST(request: Request) {
  try {
    const admin = await verifyAdmin(request);
    if (!admin) {
      return NextResponse.json({ error: "Ikke autoriseret" }, { status: 403 });
    }

    if (!isMailAvailable()) {
      return NextResponse.json(
        { error: "Mail er ikke konfigureret (RESEND_API_KEY eller SMTP_HOST)" },
        { status: 500 },
      );
    }

    const body = (await request.json().catch(() => ({}))) as {
      subject?: string;
      customMessage?: string;
      locale?: string;
    };

    // Ventelisten har ingen profiler: dansk, medmindre kalderen angiver andet.
    const locale = normalizeMailLocale(body.locale);
    const t = mailT("emailsDrip", locale);
    const subject = body.subject || t("desktopLaunch.defaultSubject");
    const customMessage =
      body.customMessage || t("desktopLaunch.defaultMessage");

    // Fetch all waitlist emails
    const entries = await db.select().from(desktopWaitlist);

    if (entries.length === 0) {
      return NextResponse.json({
        sent: 0,
        failed: 0,
        message: "Ingen tilmeldte paa ventelisten",
      });
    }

    const appUrl = getAppUrl();

    const { html, text } = await renderEmail(
      createElement(DesktopLaunchEmail, {
        heading: subject,
        message: customMessage,
        downloadUrl: `${appUrl}/desktop`,
        locale,
      }),
    );

    let sent = 0;
    let failed = 0;

    // Send in batches of 10 to avoid rate limits
    const batchSize = 10;
    for (let i = 0; i < entries.length; i += batchSize) {
      const batch = entries.slice(i, i + batchSize);

      const results = await Promise.allSettled(
        batch.map((entry) =>
          resend.emails.send({
            from: PERSONAL_FROM_EMAIL,
            replyTo: getPersonalReplyTo(),
            to: entry.email,
            subject,
            html,
            text,
          }),
        ),
      );

      for (const result of results) {
        if (result.status === "fulfilled" && !result.value.error) {
          sent++;
        } else {
          failed++;
          if (result.status === "rejected") {
            console.error("[Desktop Launch Email] Send failed:", result.reason);
          }
        }
      }
    }

    return NextResponse.json({ sent, failed });
  } catch (error) {
    console.error("[Desktop Admin Launch Email] error:", error);
    return NextResponse.json({ error: "Afsendelse fejlede" }, { status: 500 });
  }
}
