import { type SQL, type SQLWrapper, sql } from "drizzle-orm";
import { isOwnerRoleSql } from "@/lib/auth/active-org";
import { members, organizations, subscriptions, users } from "@/lib/db/schema";

// Keep this pattern compatible with both JavaScript and PostgreSQL.
const testAccountPattern = String.raw`(^test[+@]|\+(e2e|smoke|roeg)([-_.][^@]+)?@|@example\.(com|org)$|@[^@]*\.(invalid|demo)$|^demo@timetrack\.dk$|^e2e-[0-9]+-[a-z0-9]+@example\.dk$)`;
const testAccountEmailRegex = new RegExp(testAccountPattern, "i");

export function isTestAccountEmail(email: string): boolean {
  return testAccountEmailRegex.test(email);
}

export function isTestAccountEmailSql(email: SQLWrapper): SQL {
  return sql`coalesce(${email} ~* ${testAccountPattern}, false)`;
}

export function isTestOrganizationSql(organizationId: SQLWrapper): SQL {
  return sql`exists (
    select 1 from ${organizations} as test_org
    where test_org.id = ${organizationId}
      and (
        test_org.is_test_account
        or exists (
          select 1 from ${members} as test_owner
          join ${users} as test_user on test_user.id = test_owner.user_id
          where test_owner.organization_id = test_org.id
            and ${isOwnerRoleSql(sql`test_owner.role`)}
            and ${isTestAccountEmailSql(sql`test_user.email`)}
        )
      )
  )`;
}

export function excludeTestUsers(
  includeTestAccounts?: boolean,
  userId: SQLWrapper = users.id,
  email: SQLWrapper = users.email,
): SQL | undefined {
  if (includeTestAccounts) return undefined;

  // A workspace flag excludes a person from user-level metrics only when
  // they belong exclusively to test workspaces.
  return sql`not (${isTestAccountEmailSql(email)} or (
    exists (select 1 from ${members} as any_member where any_member.user_id = ${userId})
    and not exists (
      select 1 from ${members} as real_member
      where real_member.user_id = ${userId}
        and not ${isTestOrganizationSql(sql`real_member.organization_id`)}
    )
  ))`;
}

export function excludeTestOrganization(
  organizationId: SQLWrapper,
  includeTestAccounts?: boolean,
): SQL | undefined {
  return includeTestAccounts
    ? undefined
    : sql`not ${isTestOrganizationSql(organizationId)}`;
}

export function excludeTestEmail(
  email: SQLWrapper,
  includeTestAccounts?: boolean,
): SQL | undefined {
  return includeTestAccounts
    ? undefined
    : sql`not ${isTestAccountEmailSql(email)}`;
}

/** An explicit workspace takes precedence over the subscriber's other memberships. */
export function excludeTestSubscription(includeTestAccounts?: boolean) {
  if (includeTestAccounts) return undefined;

  return sql`case when ${subscriptions.organizationId} is null
    then ${excludeTestUsers()}
    else ${excludeTestEmail(users.email)} and ${excludeTestOrganization(subscriptions.organizationId)}
  end`;
}
