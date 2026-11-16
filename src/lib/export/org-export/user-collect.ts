/**
 * Henter rækkerne til bruger-eksporten ("Hent dine egne data") og fjerner
 * hemmelige kolonner. Scopingen står i user-scope.ts, valget af tabeller i
 * user-registry.ts.
 */

import { and, eq, getTableColumns, inArray, isNull } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { tr } from "@/i18n/server-text";
import type { db as dbType } from "@/lib/db";
import { members } from "@/lib/db/schema";
import { getRecipientLocale } from "@/lib/email/recipient-locale";
import type { CollectedTable, ExportRow } from "./collect";
import { REDACTED_COLUMNS } from "./registry";
import {
  USER_EXPORT_TABLES,
  USER_REFERENCE_TABLES,
  type UserExportTable,
  type UserReferenceTable,
} from "./user-registry";
import { type UserExportScopeInput, userScopeCondition } from "./user-scope";

export interface UserExportView {
  /**
   * Må brugeren se timepriser, beløb og kostpriser (`adminOnly`)? Kun ejere
   * og administratorer, og brugere uden organisation (det er deres egne).
   * Standard er nej.
   */
  canSeeRates: boolean;
}

/**
 * Kolonner der må eksporteres for en tabel: alt undtagen hemmeligheder, og
 * uden `adminOnly`-kolonner, medmindre brugeren må se dem.
 */
export function userExportableColumns(
  entry: UserExportTable,
  view: UserExportView = { canSeeRates: false },
): {
  columns: string[];
  numericColumns: Set<string>;
} {
  const all = getTableColumns(entry.table) as Record<string, AnyPgColumn>;
  const only = entry.only ? new Set(entry.only) : null;
  const omit = new Set(entry.omit ?? []);
  if (!view.canSeeRates && Array.isArray(entry.adminOnly)) {
    for (const k of entry.adminOnly) omit.add(k);
  }
  const columns: string[] = [];
  const numericColumns = new Set<string>();
  for (const [jsKey, col] of Object.entries(all)) {
    if (REDACTED_COLUMNS.has(col.name)) continue;
    if (only && !only.has(jsKey)) continue;
    if (omit.has(jsKey)) continue;
    columns.push(jsKey);
    if (col.columnType === "PgNumeric") numericColumns.add(jsKey);
  }
  return { columns, numericColumns };
}

/**
 * Sikkerhedsnet inde i selve indsamlingen: en bruger-eksport kan aldrig
 * bygges for en organisation, brugeren ikke er medlem af, uanset hvem der
 * kalder. (Bestilling, jobbet og download tjekker det også.)
 */
export async function assertUserInOrg(
  db: typeof dbType,
  scope: UserExportScopeInput,
): Promise<void> {
  if (!scope.orgId) return;
  const row = await db.query.members.findFirst({
    where: and(
      eq(members.userId, scope.userId),
      eq(members.organizationId, scope.orgId),
    ),
    columns: { id: true },
  });
  if (!row) {
    throw new Error(
      await tr(
        "serverExports",
        "readme.notMemberAnymore",
        undefined,
        await getRecipientLocale({ userId: scope.userId }),
      ),
    );
  }
}

function refIds(
  tables: CollectedTable[],
  keys: string[],
): { ids: string[]; seen: Set<string> } {
  const seen = new Set<string>();
  for (const t of tables) {
    for (const row of t.rows) {
      for (const key of keys) {
        const v = row[key];
        if (typeof v === "string" && v.length > 0) seen.add(v);
      }
    }
  }
  return { ids: [...seen], seen };
}

const ID_CHUNK = 5000;

async function collectReference(
  db: typeof dbType,
  ref: UserReferenceTable,
  ids: string[],
  orgId: string | null,
): Promise<ExportRow[]> {
  if (ids.length === 0) return [];
  const all = getTableColumns(ref.table) as Record<string, AnyPgColumn>;
  const idCol = all.id;
  const orgCol = all.organizationId;
  if (!idCol || !orgCol) {
    throw new Error(`${ref.key} mangler id eller organizationId`);
  }
  const selection = Object.fromEntries(ref.columns.map((k) => [k, all[k]]));
  const rows: ExportRow[] = [];
  for (let i = 0; i < ids.length; i += ID_CHUNK) {
    const chunk = ids.slice(i, i + ID_CHUNK);
    rows.push(
      ...((await db
        .select(selection)
        .from(ref.table)
        .where(
          and(
            orgId ? eq(orgCol, orgId) : isNull(orgCol),
            inArray(idCol, chunk),
          ),
        )) as ExportRow[]),
    );
  }
  return rows;
}

/**
 * Rollen afgøres, når eksporten bygges (ikke ved bestilling), så en
 * medarbejder, der er sat ned fra administrator, ikke får priserne med.
 */
export async function userExportView(
  db: typeof dbType,
  scope: UserExportScopeInput,
): Promise<UserExportView> {
  if (!scope.orgId) return { canSeeRates: true };
  const row = await db.query.members.findFirst({
    where: and(
      eq(members.userId, scope.userId),
      eq(members.organizationId, scope.orgId),
    ),
    columns: { role: true },
  });
  return { canSeeRates: row?.role === "owner" || row?.role === "admin" };
}

export async function collectUserExport(
  db: typeof dbType,
  scope: UserExportScopeInput,
): Promise<CollectedTable[]> {
  await assertUserInOrg(db, scope);
  const view = await userExportView(db, scope);

  const out: CollectedTable[] = [];
  for (const entry of USER_EXPORT_TABLES) {
    const { columns, numericColumns } = userExportableColumns(entry, view);
    const hidden = entry.adminOnly === "all" && !view.canSeeRates;
    const cond = hidden ? null : userScopeCondition(entry, scope);
    let rows: ExportRow[] = [];
    if (cond) {
      const all = getTableColumns(entry.table) as Record<string, AnyPgColumn>;
      const selection = Object.fromEntries(columns.map((k) => [k, all[k]]));
      // Sekventielt, så en stor konto ikke åbner 60 forbindelser på én gang.
      rows = (await db
        .select(selection)
        .from(entry.table)
        .where(cond)) as ExportRow[];
    }
    out.push({ entry, columns, numericColumns, rows });
  }

  // Opslag med id og navn på det, brugerens egne rækker peger på.
  for (const ref of USER_REFERENCE_TABLES) {
    const { ids } = refIds(out, ref.refKeys);
    const rows = await collectReference(db, ref, ids, scope.orgId);
    out.push({
      entry: ref,
      columns: ref.columns,
      numericColumns: new Set(),
      rows,
    });
  }
  return out;
}
