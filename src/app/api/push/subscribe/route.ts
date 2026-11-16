import { and, eq } from "drizzle-orm";
import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { pushSubscriptions } from "@/lib/db/schema";

/**
 * POST /api/push/subscribe
 * Subscribe to push notifications
 */
export async function POST(request: Request) {
  try {
    const session = await auth.api.getSession({
      headers: await headers(),
    });

    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { subscription } = body;

    if (!subscription?.endpoint) {
      return NextResponse.json(
        { error: "Invalid subscription data" },
        { status: 400 },
      );
    }

    // Check if subscription already exists
    const existingSubscription = await db.query.pushSubscriptions.findFirst({
      where: and(
        eq(pushSubscriptions.userId, session.user.id),
        eq(pushSubscriptions.endpoint, subscription.endpoint),
      ),
    });

    if (existingSubscription) {
      // Update existing subscription
      await db
        .update(pushSubscriptions)
        .set({
          p256dhKey: subscription.keys?.p256dh || null,
          authKey: subscription.keys?.auth || null,
          updatedAt: new Date(),
        })
        .where(eq(pushSubscriptions.id, existingSubscription.id));

      return NextResponse.json({
        success: true,
        message: "Subscription updated",
      });
    }

    // Create new subscription
    await db.insert(pushSubscriptions).values({
      userId: session.user.id,
      endpoint: subscription.endpoint,
      p256dhKey: subscription.keys?.p256dh || null,
      authKey: subscription.keys?.auth || null,
    });

    return NextResponse.json({
      success: true,
      message: "Subscription created",
    });
  } catch (error) {
    console.error("[Push] Subscribe error:", error);
    return NextResponse.json({ error: "Failed to subscribe" }, { status: 500 });
  }
}
