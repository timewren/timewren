import { sql } from "drizzle-orm";
import { resolvePrimaryOrgId } from "@/lib/auth/active-org";
import { isTestAccountEmail, isTestOrganizationSql } from "@/lib/test-accounts";

export async function isTestEmailRecipient(
  email: string,
  userId?: string,
  organizationId?: string | null,
): Promise<boolean> {
  if (isTestAccountEmail(email)) return true;
  if (!userId && !organizationId) return false;

  try {
    const { db } = await import("@/lib/db");
    const orgId =
      organizationId === undefined && userId
        ? await resolvePrimaryOrgId({ db, userId })
        : organizationId;
    if (!orgId) return false;

    const [row] = await db
      .select({
        isTest: sql<boolean>`${isTestOrganizationSql(sql`${orgId}`)}`.as(
          "is_test",
        ),
      })
      .from(sql`(values (1)) as recipient_check(id)`);
    return row.isTest;
  } catch {
    throw new Error("Unable to classify an email recipient");
  }
}

export async function isTestEmailRecipientOrAllow(
  email: string,
  userId?: string,
  organizationId?: string | null,
): Promise<boolean> {
  try {
    return await isTestEmailRecipient(email, userId, organizationId);
  } catch {
    console.warn(
      "Test recipient lookup failed. Continuing with email delivery",
      {
        userId,
        organizationId,
      },
    );
    return false;
  }
}
