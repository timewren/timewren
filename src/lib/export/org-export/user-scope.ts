/**
 * WHERE-betingelser for bruger-eksporten. Rene funktioner uden
 * databaseforbindelse, så scopingen kan testes ved at rendere SQL'en
 * (se user-scope.test.ts).
 *
 * Reglen i én linje: brugerens egne rækker (`column = userId`) i den aktive
 * organisation (`organization_id = orgId`). Uden organisation kun rækker
 * uden organisation (`organization_id IS NULL`), så en bruger, der er gået
 * ud af en organisation, ikke kan trække dens rækker ud.
 */
import {
  and,
  eq,
  getTableColumns,
  isNull,
  or,
  type SQL,
  sql,
} from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { members, organizations, users } from "@/lib/db/schema";
import { USER_EXPORT_TABLES, type UserExportTable } from "./user-registry";

export interface UserExportScopeInput {
  /** Den aktive organisation. null = bruger uden organisation. */
  orgId: string | null;
  /** Brugeren, eksporten er til. Det er altid den, der bestilte den. */
  userId: string;
}

const BY_KEY = new Map(USER_EXPORT_TABLES.map((e) => [e.key, e]));

function column(
  table: UserExportTable["table"],
  key: string,
): AnyPgColumn | undefined {
  return (getTableColumns(table) as Record<string, AnyPgColumn>)[key];
}

function need(table: UserExportTable["table"], key: string): AnyPgColumn {
  const col = column(table, key);
  if (!col) throw new Error(`Kolonnen ${key} findes ikke`);
  return col;
}

/** `organization_id = orgId`, eller `IS NULL` uden organisation. */
function orgPredicate(col: AnyPgColumn, orgId: string | null): SQL {
  return orgId ? eq(col, orgId) : isNull(col);
}

/**
 * Betingelsen for én tabel, eller null hvis tabellen ikke har rækker i dette
 * scope (fx medlemsrækker for en bruger uden organisation).
 */
export function userScopeCondition(
  entry: UserExportTable,
  scope: UserExportScopeInput,
): SQL | null {
  const { orgId, userId } = scope;
  switch (entry.scope.kind) {
    case "profile":
      return eq(users.id, userId);

    case "organization":
      return orgId ? eq(organizations.id, orgId) : null;

    case "own": {
      const orgCol = need(entry.table, "organizationId");
      const ownCols = entry.scope.columns.map((c) =>
        eq(need(entry.table, c), userId),
      );
      const mine = ownCols.length === 1 ? ownCols[0] : or(...ownCols);
      return and(orgPredicate(orgCol, orgId), mine) ?? null;
    }

    case "ownVia": {
      const parent = BY_KEY.get(entry.scope.parent);
      if (!parent) throw new Error(`Ukendt forælder ${entry.scope.parent}`);
      const parentId = need(parent.table, "id");
      const parentOrg = need(parent.table, "organizationId");
      return and(
        eq(need(entry.table, entry.scope.column), userId),
        sql`${entry.scope.parentColumn} in (select ${parentId} from ${parent.table} where ${orgPredicate(parentOrg, orgId)})`,
      ) as SQL;
    }

    case "member": {
      if (!orgId) return null;
      return sql`${need(entry.table, entry.scope.column)} in (select ${members.id} from ${members} where ${members.userId} = ${userId} and ${members.organizationId} = ${orgId})`;
    }

    case "global":
      return eq(need(entry.table, entry.scope.column), userId);

    case "child": {
      const parent = BY_KEY.get(entry.scope.parent);
      if (!parent) throw new Error(`Ukendt forælder ${entry.scope.parent}`);
      const parentCond = userScopeCondition(parent, scope);
      if (!parentCond) return null;
      const parentId = need(parent.table, "id");
      return sql`${entry.scope.column} in (select ${parentId} from ${parent.table} where ${parentCond})`;
    }
  }
}
