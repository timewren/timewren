import { type SQL, sql } from "drizzle-orm";
import { organizations, subscriptions } from "@/lib/db/schema";
import { TIMEWREN_STRIPE_BRAND } from "./timewren-stripe";

/**
 * SQL-betingelse for en TimeWren Cloud-række med Stripe-abonnement: Stripe-id
 * OG en organisation med brand timewren. TimeTrack-rækker kan have et
 * historisk Stripe-id fra før Alunta, så Stripe-id alene afgrænser ikke.
 * Bruges af trial-expire og trial-reminder.
 */
export function timewrenStripeRow(): SQL<boolean> {
  return sql<boolean>`(${subscriptions.stripeSubscriptionId} is not null and exists (select 1 from ${organizations} where ${organizations.id} = ${subscriptions.organizationId} and ${organizations.brand} = ${TIMEWREN_STRIPE_BRAND}))`;
}
