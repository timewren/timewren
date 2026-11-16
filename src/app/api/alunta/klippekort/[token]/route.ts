import { and, eq, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";
import { toIntlLocale } from "@/i18n/format-locale";
import { tr } from "@/i18n/server-text";
import { db } from "@/lib/db";
import {
  aluntaKlippekortTokens,
  aluntaPlanMappings,
  clients,
  emailPreferences,
  prepaidPackages,
  users,
  webhookEvents,
} from "@/lib/db/schema";
import { sendAluntaKlippekortCreatedEmail } from "@/lib/email/alunta-klippekort";
import { getRecipientLocale } from "@/lib/email/recipient-locale";
import { tokenLookup } from "@/lib/security/token-hash";
import {
  addDaysToDateStr,
  addMonthsToDateStr,
  COPENHAGEN_TZ,
  copenhagenToday,
  entryDateFromStr,
  monthStartDateStr,
} from "@/lib/time/copenhagen";
import { captureRouteError } from "@/lib/utils/sentry";

// ── Types ───────────────────────────────────────────────────────────

interface AluntaKlippekortPayload {
  event: string;
  timestamp: string;
  data: {
    plan?: { uuid: string; name: string };
    customer?: { reg_number?: string; name?: string; uuid?: string };
    subscription?: {
      uuid: string;
      status: string;
      plan?: { uuid: string; name: string };
    };
    invoice?: { uuid: string; status: string };
    [key: string]: unknown;
  };
}

// ── POST handler ────────────────────────────────────────────────────

export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token: tokenValue } = await params;

  try {
    // 1. Validate token
    const tokenRecord = await db.query.aluntaKlippekortTokens.findFirst({
      where: and(
        tokenLookup(aluntaKlippekortTokens.tokenHash, tokenValue),
        eq(aluntaKlippekortTokens.isActive, true),
      ),
    });

    if (!tokenRecord) {
      return NextResponse.json(
        { error: "Invalid or inactive token" },
        { status: 401 },
      );
    }

    // 2. Parse payload
    const payload: AluntaKlippekortPayload = await request.json();
    const eventType = payload.event;

    // Kun eventtypen: payload.data indeholder kundens navn, CVR og mail.
    console.warn(`[Alunta Klippekort] Received event: ${eventType}`);

    // 3. Idempotency — build eventId
    const resourceId =
      payload.data.invoice?.uuid ||
      payload.data.subscription?.uuid ||
      payload.data.customer?.uuid ||
      "";
    const eventId = `alunta-klippekort-${eventType}-${payload.timestamp}-${resourceId}`;

    const existing = await db.query.webhookEvents.findFirst({
      where: eq(webhookEvents.eventId, eventId),
    });
    if (existing) {
      console.warn(`[Alunta Klippekort] Duplicate event ${eventId}, skipping`);
      return NextResponse.json({ received: true, duplicate: true });
    }

    // 4. Event handling
    let processingError: string | null = null;
    try {
      switch (eventType) {
        case "invoice.created":
          await handleInvoiceCreated(payload, tokenRecord);
          break;

        case "subscription.cancelled":
        case "subscription.canceled":
        case "subscription.ended":
          await handleSubscriptionEnded(payload, tokenRecord);
          break;

        default:
          console.warn(
            `[Alunta Klippekort] Unhandled event: ${eventType}, ignoring`,
          );
      }
    } catch (err) {
      processingError = err instanceof Error ? err.message : String(err);
      console.error(`[Alunta Klippekort] Error processing ${eventType}:`, err);
      captureRouteError(err, {
        route: "/api/alunta/klippekort/[token]",
        type: "webhook",
        userId: tokenRecord.userId,
        extra: { eventType, resourceId, tokenId: tokenRecord.id },
      });
    }

    // 5. Record event (source includes tokenId for per-user scoping)
    try {
      await db.insert(webhookEvents).values({
        eventId,
        source: `alunta-klippekort:${tokenRecord.id}`,
        eventType,
        status: processingError ? "error" : "success",
        errorMessage: processingError,
      });
    } catch (insertErr) {
      console.error("[Alunta Klippekort] Failed to record event:", insertErr);
    }

    // 6. Always return 200 to avoid Alunta retrying
    return NextResponse.json({ received: true });
  } catch (error) {
    console.error("[Alunta Klippekort] Error:", error);
    captureRouteError(error, {
      route: "/api/alunta/klippekort/[token]",
      type: "webhook",
    });
    // Still return 200 to avoid Alunta retrying
    return NextResponse.json({ received: true });
  }
}

// ── handleInvoiceCreated ────────────────────────────────────────────

async function handleInvoiceCreated(
  payload: AluntaKlippekortPayload,
  token: typeof aluntaKlippekortTokens.$inferSelect,
) {
  // 1. Extract planUuid
  const planUuid =
    payload.data.subscription?.plan?.uuid || payload.data.plan?.uuid;
  if (!planUuid) {
    console.warn(
      "[Alunta Klippekort] invoice.created missing plan UUID, skipping",
    );
    return;
  }

  // 2. Find mapping
  const mappingConditions = [
    eq(aluntaPlanMappings.aluntaPlanUuid, planUuid),
    eq(aluntaPlanMappings.isActive, true),
    eq(aluntaPlanMappings.tokenId, token.id),
  ];

  const mapping = await db.query.aluntaPlanMappings.findFirst({
    where: and(...mappingConditions),
    with: {
      client: true,
    },
  });

  if (!mapping) {
    console.warn(
      `[Alunta Klippekort] No mapping found for plan ${planUuid}, skipping`,
    );
    return;
  }

  // 3. Idempotency: check if prepaidPackage with this invoice UUID already exists
  const invoiceUuid = payload.data.invoice?.uuid;
  if (invoiceUuid) {
    const existingPackage = await db.query.prepaidPackages.findFirst({
      where: eq(prepaidPackages.aluntaInvoiceUuid, invoiceUuid),
    });
    if (existingPackage) {
      console.warn(
        `[Alunta Klippekort] Package already exists for invoice ${invoiceUuid}, skipping`,
      );
      return;
    }
  }

  // 4. CVR auto-match
  let clientId = mapping.clientId;
  const customerRegNumber = payload.data.customer?.reg_number;
  if (customerRegNumber) {
    const matchedClient = await db.query.clients.findFirst({
      where: and(
        eq(clients.cvrNumber, customerRegNumber),
        token.organizationId
          ? eq(clients.organizationId, token.organizationId)
          : eq(clients.userId, token.userId),
      ),
    });
    if (matchedClient) {
      console.warn(
        `[Alunta Klippekort] CVR match → client ${matchedClient.id}`,
      );
      clientId = matchedClient.id;
    }
  }

  // 5. Renewal behavior + create in a single transaction
  const now = new Date();
  const baseHours = Number(mapping.hoursPerPeriod);
  const hourlyRate = Number(mapping.hourlyRate);
  // Sidste dag i næste danske måned, gemt som UTC-midnat (datokonventionen)
  // uanset processens TZ (#649)
  const thisMonth = monthStartDateStr(copenhagenToday(now));
  const expiryDate = entryDateFromStr(
    addDaysToDateStr(addMonthsToDateStr(thisMonth, 2), -1),
  );
  const monthLabel = now.toLocaleDateString("da-DK", {
    month: "long",
    year: "numeric",
    timeZone: COPENHAGEN_TZ,
  });
  const packageName = `${mapping.aluntaPlanName}, ${monthLabel}`;

  const newPackage = await db.transaction(async (tx) => {
    let bonusHours = 0;

    if (mapping.renewalBehavior !== "parallel") {
      const existingPackages = await tx
        .select()
        .from(prepaidPackages)
        .where(
          and(
            eq(prepaidPackages.aluntaMappingId, mapping.id),
            eq(prepaidPackages.isActive, true),
            eq(prepaidPackages.isArchived, false),
          ),
        );

      if (existingPackages.length > 0) {
        if (mapping.renewalBehavior === "transfer") {
          bonusHours = existingPackages.reduce(
            (sum, pkg) => sum + Number(pkg.remainingHours),
            0,
          );
          console.warn(
            `[Alunta Klippekort] Transferring ${bonusHours} remaining hours from ${existingPackages.length} package(s)`,
          );
        }

        await tx
          .update(prepaidPackages)
          .set({ isActive: false, isArchived: true, updatedAt: now })
          .where(
            inArray(
              prepaidPackages.id,
              existingPackages.map((pkg) => pkg.id),
            ),
          );
      }
    }

    const totalHours = baseHours + bonusHours;
    const totalValue = totalHours * hourlyRate;

    const [created] = await tx
      .insert(prepaidPackages)
      .values({
        userId: token.userId,
        organizationId: token.organizationId,
        clientId,
        name: packageName,
        totalHours: String(totalHours),
        remainingHours: String(totalHours),
        usedHours: "0",
        hourlyRate: String(hourlyRate),
        totalValue: String(totalValue),
        purchaseDate: now,
        expiryDate,
        clipSizeMinutes: mapping.clipSizeMinutes,
        isActive: true,
        aluntaMappingId: mapping.id,
        aluntaInvoiceUuid: invoiceUuid || null,
      })
      .returning();

    return created;
  });

  const hours = Number(newPackage.totalHours);
  console.warn(
    `[Alunta Klippekort] Created package "${packageName}" (${hours}h @ ${hourlyRate} kr/h) for client ${clientId}`,
  );

  // 7. Send email notification
  try {
    const [user, prefs] = await Promise.all([
      db.query.users.findFirst({
        where: eq(users.id, token.userId),
        columns: { email: true, name: true },
      }),
      db.query.emailPreferences.findFirst({
        where: eq(emailPreferences.userId, token.userId),
      }),
    ]);
    const wantsEmail = prefs?.productUpdates !== false;

    if (user?.email && wantsEmail) {
      await sendAluntaKlippekortCreatedEmail({
        to: user.email,
        userName: user.name || "bruger",
        clientName:
          mapping.client?.name ||
          (await tr("serverErrors", "common.unknownClient")),
        hours: String(hours),
        hourlyRate: String(hourlyRate),
        expiryDate: expiryDate.toLocaleDateString(
          toIntlLocale(await getRecipientLocale({ userId: token.userId })),
          { timeZone: "Europe/Copenhagen" },
        ),
        planName: mapping.aluntaPlanName,
        userId: token.userId,
      });
    }
  } catch (emailErr) {
    console.error(
      "[Alunta Klippekort] Failed to send creation email (non-fatal):",
      emailErr,
    );
  }
}

// ── handleSubscriptionEnded ─────────────────────────────────────────

async function handleSubscriptionEnded(
  payload: AluntaKlippekortPayload,
  token: typeof aluntaKlippekortTokens.$inferSelect,
) {
  // 1. Extract planUuid
  const planUuid =
    payload.data.subscription?.plan?.uuid || payload.data.plan?.uuid;
  if (!planUuid) {
    console.warn(
      "[Alunta Klippekort] subscription ended event missing plan UUID, skipping",
    );
    return;
  }

  // 2. Find mapping
  const mapping = await db.query.aluntaPlanMappings.findFirst({
    where: and(
      eq(aluntaPlanMappings.aluntaPlanUuid, planUuid),
      eq(aluntaPlanMappings.tokenId, token.id),
    ),
  });

  if (!mapping) {
    console.warn(
      `[Alunta Klippekort] No mapping found for ended plan ${planUuid}, skipping`,
    );
    return;
  }

  // 3. Deactivate the mapping
  await db
    .update(aluntaPlanMappings)
    .set({
      isActive: false,
      updatedAt: new Date(),
    })
    .where(eq(aluntaPlanMappings.id, mapping.id));

  console.warn(
    `[Alunta Klippekort] Deactivated mapping for plan ${planUuid} (${mapping.aluntaPlanName})`,
  );
}
