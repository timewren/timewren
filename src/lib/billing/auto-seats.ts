import { and, eq } from "drizzle-orm";
import { type AluntaSubscription, alunta } from "@/lib/alunta";
import {
  canAutoExpandTier,
  pickSeatsSubToExpand,
  seatsSyncPlan,
} from "@/lib/billing/auto-seats-rules";
import { countSeatUsage } from "@/lib/billing/seat-usage";
import { db } from "@/lib/db";
import { subscriptions } from "@/lib/db/schema";
import { notifyAdmin } from "@/lib/notifications/admin";

/**
 * Pladser følger FAKTISK brug (Mads 8/9-2026): en Team-/Business-kunde
 * betaler i Alunta kun for de ekstra pladser der er i brug (medlemmer +
 * afventende invitationer ud over de inkluderede) — aldrig for tomme
 * pladser. TimeTrack er sandheden for forbruget; Alunta følger med op ved
 * invitation og ned ved medlemsfjernelse/daglig afstemning.
 */

export type SeatsSyncResult =
  | {
      ok: true;
      seatsUsed: number;
      quantity: number;
      maxSeats: number;
      changed: boolean;
    }
  | { ok: false; reason: string };

/**
 * Sæt Aluntas seats-add-on til det faktiske forbrug (+ `reserve` pladser der
 * er ved at blive taget, fx en invitation under oprettelse) og opdatér
 * orgens maxSeats/seatCount til inkluderede + quantity. Fejler blødt.
 */
export async function syncSeatsToUsage(
  orgId: string,
  opts: { reserve?: number; reason: string },
): Promise<SeatsSyncResult> {
  const sub = await db.query.subscriptions.findFirst({
    where: eq(subscriptions.organizationId, orgId),
    columns: {
      id: true,
      userId: true,
      planTier: true,
      status: true,
      maxSeats: true,
      aluntaSubscriptionId: true,
      aluntaCustomerId: true,
    },
  });
  if (!sub) return { ok: false, reason: "intet org-abonnement" };
  if (!canAutoExpandTier(sub)) {
    return {
      ok: false,
      reason: `tier/status tillader ikke (${sub.planTier}/${sub.status})`,
    };
  }

  let seatsSub: AluntaSubscription | null;
  try {
    const all = await alunta.subscriptions.listAllForCustomer(
      [orgId, sub.userId],
      sub.aluntaCustomerId,
    );
    seatsSub = pickSeatsSubToExpand(all);
  } catch (err) {
    return {
      ok: false,
      reason: `Alunta-opslag fejlede: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  if (!seatsSub) return { ok: false, reason: "intet pladsabonnement i Alunta" };

  const tier = sub.planTier ?? "team";
  const usage = await countSeatUsage(db, orgId);
  const seatsUsed = usage.total + (opts.reserve ?? 0);
  const plan = seatsSyncPlan({
    tier,
    seatsUsed,
    currentQuantity: seatsSub.quantity ?? 0,
    currentMaxSeats: sub.maxSeats ?? 0,
  });

  let quantity = plan.targetQuantity;
  let maxSeats = plan.targetMaxSeats;
  if (plan.changeQuantity) {
    try {
      await alunta.subscriptions.updateQuantity(seatsSub.uuid, quantity);
    } catch (err) {
      // Alunta afviser muligvis 0 på et license_based add-on — fald tilbage
      // til 1 (én ubrugt plads) og sig det til admin, i stedet for at
      // blokere invitationen/fjernelsen.
      if (quantity === 0) {
        try {
          await alunta.subscriptions.updateQuantity(seatsSub.uuid, 1);
          quantity = 1;
          maxSeats = seatsSyncPlan({
            tier,
            seatsUsed,
            currentQuantity: 1,
            currentMaxSeats: sub.maxSeats ?? 0,
          }).targetMaxSeats;
          await notifyAdmin("seat_drift", {
            reason: `Alunta afviste quantity 0 på ${seatsSub.uuid} (org ${orgId}) — sat til 1 i stedet. Overvej at annullere add-on'et manuelt.`,
          });
        } catch (err2) {
          return {
            ok: false,
            reason: `Alunta afviste quantity-ændring: ${err2 instanceof Error ? err2.message : String(err2)}`,
          };
        }
      } else {
        return {
          ok: false,
          reason: `Alunta afviste quantity-ændring: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    }
  }

  if (plan.changeQuantity || plan.changeMaxSeats) {
    await db
      .update(subscriptions)
      .set({ maxSeats, seatCount: maxSeats })
      .where(
        and(
          eq(subscriptions.id, sub.id),
          eq(subscriptions.organizationId, orgId),
        ),
      );
  }
  if (plan.changeQuantity) {
    await notifyAdmin("seat_drift", {
      reason: `Pladser fulgte forbrug — org ${orgId}: Alunta quantity ${seatsSub.quantity ?? 0} → ${quantity}, maxSeats ${sub.maxSeats} → ${maxSeats} (${seatsUsed} i brug). Årsag: ${opts.reason}.`,
    });
  }

  return {
    ok: true,
    seatsUsed,
    quantity,
    maxSeats,
    changed: plan.changeQuantity || plan.changeMaxSeats,
  };
}

export type AutoExpandResult =
  | { expanded: true; newMaxSeats: number; newQuantity: number }
  | { expanded: false; reason: string };

/**
 * Bruges af invitations-hooket: reservér én plads til den nye invitation.
 * "expanded" = der er nu kapacitet til den.
 */
export async function tryAutoExpandSeats(
  orgId: string,
): Promise<AutoExpandResult> {
  const r = await syncSeatsToUsage(orgId, {
    reserve: 1,
    reason: "invitation",
  });
  if (!r.ok) return { expanded: false, reason: r.reason };
  if (r.maxSeats < r.seatsUsed) {
    return { expanded: false, reason: "tierens pladsloft er nået" };
  }
  return { expanded: true, newMaxSeats: r.maxSeats, newQuantity: r.quantity };
}
