import { count, eq, isNotNull } from "drizzle-orm";
import {
  type AluntaSubscription,
  alunta,
  resolveAluntaPlanTier,
} from "@/lib/alunta";
import { syncSeatsToUsage } from "@/lib/billing/auto-seats";
import { canAutoExpandTier } from "@/lib/billing/auto-seats-rules";
import { isBillingEnabled } from "@/lib/billing/billing-enabled";
import {
  expectedSeatsForSubscription,
  isLiveAluntaStatus,
} from "@/lib/billing/seats";
import { isAluntaSeatsPlan } from "@/lib/config";
import { withCronLogging } from "@/lib/cron/log-cron-run";
import { db } from "@/lib/db";
import { members, subscriptions } from "@/lib/db/schema";
import { grantEnterpriseForTierSafe } from "@/lib/modules/plan-grants";
import { notifyAdmin } from "@/lib/notifications/admin";
import { isStoreManaged } from "@/lib/store-billing/state";

// Seat-reconciliation (#149): maxSeats opdateres kun af Alunta-webhooks —
// fejler en webhook, divergerer seats stille (gratis over-seats eller
// uretmæssig blokering). Dagligt cron afstemmer mod Alunta (sandhedskilde,
// auto-korrigerer) og mod faktisk medlemstal (alarm ved over-seat).
// Schedule: dagligt 07:20 (cron-sidecar).

export const GET = withCronLogging("seat-reconciliation", async (_request) => {
  // Uden betalingsudbyder (selvhost) findes ingen planer eller prøveperioder
  if (!isBillingEnabled()) {
    return {
      itemsProcessed: 0,
      itemsSucceeded: 0,
      metadata: { skipped: "billing-disabled" },
    };
  }

  // Kun org-koblede Alunta-abonnementer — manuelle subs (admin-tildelte,
  // founding members) har intet aluntaSubscriptionId og afstemmes ikke.
  const subs = await db.query.subscriptions.findMany({
    where: isNotNull(subscriptions.aluntaSubscriptionId),
    columns: {
      id: true,
      organizationId: true,
      userId: true,
      aluntaSubscriptionId: true,
      aluntaCustomerId: true,
      status: true,
      planTier: true,
      maxSeats: true,
      seatCount: true,
      storeProvider: true,
      storeStatus: true,
    },
  });

  // Rækker købt i appen springes over: deres (gamle) Alunta-link må aldrig
  // overskrive den tier og de pladser butikken har betalt for.
  const active = subs.filter(
    (s) =>
      s.organizationId &&
      (s.status === "active" || s.status === "trialing") &&
      !isStoreManaged(s),
  );

  let checked = 0;
  let corrected = 0;
  let overSeat = 0;
  let failed = 0;

  for (const sub of active) {
    try {
      // Pladser følger forbrug (8/9-2026): for Team/Business med seats-add-on
      // sættes Aluntas quantity til faktisk brugte ekstra pladser (skruer også
      // NED når medlemmer er fjernet eller invitationer udløbet), før
      // Alunta-sandheds-tjekket nedenfor — så de to er enige.
      if (sub.organizationId && canAutoExpandTier(sub)) {
        const synced = await syncSeatsToUsage(sub.organizationId, {
          reason: "daglig afstemning",
        });
        if (synced.ok && synced.changed) corrected++;
      }

      const { data: aluntaSub } = await alunta.subscriptions.get(
        sub.aluntaSubscriptionId as string,
      );
      checked++;

      const planTier = resolveAluntaPlanTier(aluntaSub.plan?.uuid);

      // Forventede pladser = inkluderede + SUM af live seats-add-on-subs'
      // quantity, med basens metadata.seat_count som kapacitets-gulv (#424
      // fund 3). Vigtigt: IKKE basens frosne metadata alene — den kender ikke
      // senere add-on-køb; og IKKE base-`quantity` (altid 1 på flat_rate).
      // Fuldt pagineret union af org- og user-nøglede kunder (fund 4) — en
      // enkelt side ville tavst kunne overse add-on-subs.
      // Union af external_customer_id OG customer_uuid: kunde As seats-add-on
      // (oprettet manuelt i Alunta) har external_customer_id=null på selve
      // subscriptionen, så det tidligere opslag gav [] og cronen "rettede"
      // 5 pladser ned til 2 (8/9-2026).
      const allSubs: AluntaSubscription[] =
        await alunta.subscriptions.listAllForCustomer(
          [sub.organizationId, sub.userId],
          sub.aluntaCustomerId,
        );
      const liveSeatsQuantities = allSubs
        .filter(
          (s) =>
            isAluntaSeatsPlan(s.plan?.uuid) && isLiveAluntaStatus(s.status),
        )
        .map((s) => (typeof s.quantity === "number" ? s.quantity : 0));

      const metaSeatCountRaw = aluntaSub.metadata?.seat_count;
      const metaSeatCount =
        typeof metaSeatCountRaw === "string"
          ? Number.parseInt(metaSeatCountRaw, 10)
          : metaSeatCountRaw;

      const expectedSeats = expectedSeatsForSubscription({
        tier: planTier,
        // Basens metadata gælder kun som gulv når den linkede sub faktisk er
        // en base-plan — for legacy-rækker linket til en seats-sub tæller
        // dens quantity allerede med i liveSeatsQuantities.
        baseMetaSeatCount: isAluntaSeatsPlan(aluntaSub.plan?.uuid)
          ? null
          : typeof metaSeatCount === "number"
            ? metaSeatCount
            : null,
        liveSeatsQuantities,
      });

      const [{ value: memberCount }] = await db
        .select({ value: count() })
        .from(members)
        .where(eq(members.organizationId, sub.organizationId as string));

      // 1) maxSeats afviger fra Alunta → auto-korrigér (Alunta = sandhed)
      if (sub.maxSeats !== expectedSeats || sub.planTier !== planTier) {
        await db
          .update(subscriptions)
          .set({ maxSeats: expectedSeats, seatCount: expectedSeats, planTier })
          .where(eq(subscriptions.id, sub.id));
        // Tier rettet til Virksomhed → enterprise-modulet (best-effort).
        if (sub.planTier !== planTier) {
          await grantEnterpriseForTierSafe(
            db,
            sub.organizationId,
            planTier,
            "cron.seat-reconciliation",
          );
        }
        corrected++;
        await notifyAdmin("seat_drift", {
          reason: `Auto-korrigeret for org ${sub.organizationId}: maxSeats ${sub.maxSeats} → ${expectedSeats}, tier ${sub.planTier} → ${planTier} (Alunta ${sub.aluntaSubscriptionId}). Sandsynligvis en mistet webhook. Tjek admin/webhooks.`,
        });
      }

      // 2) Flere medlemmer end (korrigerede) pladser → alarm, ingen auto-
      //    handling (medlemsfjernelse er en menneskebeslutning)
      if (memberCount > expectedSeats) {
        overSeat++;
        await notifyAdmin("seat_drift", {
          reason: `Over-seat for org ${sub.organizationId}: ${memberCount} medlemmer > ${expectedSeats} pladser (${planTier}). Nye accepts blokeres allerede; eksisterende medlemmer er over grænsen.`,
        });
      }

      // 3) Statusdivergens: Alunta siger cancelled/expired, lokalt aktiv
      const aluntaInactive = ["cancelled", "canceled", "expired"].includes(
        aluntaSub.status?.toLowerCase?.() ?? "",
      );
      if (aluntaInactive && sub.status === "active") {
        await notifyAdmin("seat_drift", {
          reason: `Status-divergens for org ${sub.organizationId}: Alunta-status "${aluntaSub.status}" men lokalt "active" (${sub.aluntaSubscriptionId}). Webhook mistet? Brug finance.replayWebhookDelivery.`,
        });
      }
    } catch (err) {
      failed++;
      console.error(
        `[Seat Reconciliation] ${sub.id} fejlede:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  return {
    itemsProcessed: checked + failed,
    itemsSucceeded: checked,
    itemsFailed: failed,
    metadata: {
      corrected,
      overSeat,
      skippedInactive: subs.length - active.length,
    },
  };
});
