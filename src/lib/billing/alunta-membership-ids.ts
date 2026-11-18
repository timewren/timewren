import { and, eq, isNotNull, or, type SQL, sql } from "drizzle-orm";
import { type AluntaSubscription, alunta } from "@/lib/alunta";
import { isOwnerRoleSql } from "@/lib/auth/active-org";
import type { db as Db } from "@/lib/db";
import { members, subscriptions, users } from "@/lib/db/schema";
import {
  isTestAccountEmailSql,
  isTestOrganizationSql,
} from "@/lib/test-accounts";

const hasAluntaLink = or(
  isNotNull(subscriptions.aluntaSubscriptionId),
  isNotNull(subscriptions.aluntaCustomerId),
);

// A membership keyed on the user ID pays for the workspaces the user owns,
// so memberships in other people's workspaces do not count here.
const ownsOnlyTestWorkspaces =
  () => sql<boolean>`(${isTestAccountEmailSql(users.email)} or (
  exists (
    select 1 from ${members} as owned
    where owned.user_id = ${users.id} and ${isOwnerRoleSql(sql`owned.role`)}
  )
  and not exists (
    select 1 from ${members} as owned_real
    where owned_real.user_id = ${users.id}
      and ${isOwnerRoleSql(sql`owned_real.role`)}
      and not ${isTestOrganizationSql(sql`owned_real.organization_id`)}
  )
))`;

/** Whether any Alunta-linked subscription satisfies `matches`. */
export async function hasMatchingAluntaSubscription(
  db: Pick<typeof Db, "select">,
  matches: SQL<boolean>,
): Promise<boolean> {
  const rows = await db
    .select({ matches })
    .from(subscriptions)
    .innerJoin(users, eq(subscriptions.userId, users.id))
    .where(and(hasAluntaLink, matches));
  return rows.length > 0;
}

/**
 * Include historical base memberships and seats add-ons absent from the local row.
 * Pass `memberships` to reuse a list fetched earlier; `null` uses only local IDs.
 */
export async function collectAluntaMembershipIds(
  db: Pick<typeof Db, "select">,
  matches: SQL<boolean>,
  memberships?: readonly AluntaSubscription[] | null,
): Promise<Set<string>> {
  const rows = await db
    .select({
      userId: subscriptions.userId,
      organizationId: subscriptions.organizationId,
      membershipId: subscriptions.aluntaSubscriptionId,
      customerId: subscriptions.aluntaCustomerId,
      matches,
      userMatches: ownsOnlyTestWorkspaces(),
    })
    .from(subscriptions)
    .innerJoin(users, eq(subscriptions.userId, users.id))
    .where(hasAluntaLink);

  const excluded = new Set<string>();
  if (!rows.some((row) => row.matches)) return excluded;

  const knownMemberships = new Set<string>();
  const byExternalId = new Map<string, boolean>();
  const byCustomer = new Map<string, boolean>();
  for (const row of rows) {
    if (row.membershipId) {
      knownMemberships.add(row.membershipId);
      if (row.matches) excluded.add(row.membershipId);
    }
    const setExternal = (externalId: string, value: boolean) =>
      byExternalId.set(
        externalId,
        value && (byExternalId.get(externalId) ?? true),
      );
    setExternal(row.organizationId ?? row.userId, row.matches);
    // Memberships created before workspaces carry the owner's user ID, while
    // the checkout webhook may later have set organizationId on the row.
    if (row.organizationId) {
      setExternal(row.userId, row.matches && row.userMatches);
    }
    // A customer UUID shared by a real and a test subscription is ambiguous.
    if (row.customerId) {
      byCustomer.set(
        row.customerId,
        row.matches && (byCustomer.get(row.customerId) ?? true),
      );
    }
  }

  if (memberships === null) return excluded;
  for (const membership of memberships ??
    (await alunta.subscriptions.listAll())) {
    // The list is unvalidated provider data. Skip IDs that do not fit
    // test_alunta_subscriptions.subscription_id (varchar 255, and PostgreSQL
    // text cannot hold NUL): one failing insert would roll back the whole
    // account deletion.
    const uuid = membership?.uuid;
    if (
      typeof uuid !== "string" ||
      !uuid ||
      uuid.length > 255 ||
      uuid.includes("\u0000") ||
      knownMemberships.has(uuid)
    )
      continue;
    const externalId =
      membership.external_customer_id ||
      membership.customer?.external_customer_id;
    const matchesMembership = externalId
      ? byExternalId.get(externalId)
      : byCustomer.get(membership.customer?.uuid ?? "");
    if (matchesMembership) excluded.add(uuid);
  }
  return excluded;
}
