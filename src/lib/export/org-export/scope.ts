/**
 * WHERE-betingelser for organisations-eksporten. Rene funktioner uden
 * databaseforbindelse, så scopingen kan testes med `.toSQL()`-lignende
 * rendering (se scope.test.ts).
 */
import { eq, getTableColumns, type SQL, sql } from "drizzle-orm";
import type { AnyPgColumn, PgTable } from "drizzle-orm/pg-core";
import { members, organizations, users } from "@/lib/db/schema";
import { ORG_EXPORT_TABLES, type OrgExportTable } from "./registry";

export interface OrgExportScopeInput {
  /** Organisationen der eksporteres. null = solo-bruger uden organisation. */
  orgId: string | null;
  /** Brugeren, der bad om eksporten (bruges kun, når orgId er null). */
  userId: string;
}

const BY_KEY = new Map(ORG_EXPORT_TABLES.map((e) => [e.key, e]));

function column(table: PgTable, key: string): AnyPgColumn | undefined {
  return (getTableColumns(table) as Record<string, AnyPgColumn>)[key];
}

/**
 * Betingelsen for én tabel, eller null hvis tabellen ikke har rækker i dette
 * scope (fx org-tabeller uden user_id for en solo-bruger uden organisation).
 */
export function scopeCondition(
  entry: OrgExportTable,
  scope: OrgExportScopeInput,
): SQL | null {
  switch (entry.scope.kind) {
    case "organization":
      return scope.orgId ? eq(organizations.id, scope.orgId) : null;

    case "orgUsers":
      return scope.orgId
        ? sql`${users.id} in (select ${members.userId} from ${members} where ${members.organizationId} = ${scope.orgId})`
        : eq(users.id, scope.userId);

    case "org": {
      if (scope.orgId) {
        const orgCol = column(entry.table, "organizationId");
        if (!orgCol) {
          throw new Error(`${entry.key} mangler organizationId`);
        }
        return eq(orgCol, scope.orgId);
      }
      const userCol = column(entry.table, "userId");
      return userCol ? eq(userCol, scope.userId) : null;
    }

    case "parent": {
      const parent = BY_KEY.get(entry.scope.parent);
      if (!parent) throw new Error(`Ukendt forælder ${entry.scope.parent}`);
      const parentCond = scopeCondition(parent, scope);
      if (!parentCond) return null;
      const parentId = column(parent.table, "id");
      if (!parentId) throw new Error(`${parent.key} mangler id`);
      return sql`${entry.scope.column} in (select ${parentId} from ${parent.table} where ${parentCond})`;
    }
  }
}
