/**
 * Henter alle rækker til organisations-eksporten og fjerner hemmelige
 * kolonner. Filer (vedhæftninger, logoer, billeder) samles i files.ts.
 */
import { getTableColumns } from "drizzle-orm";
import type { AnyPgColumn, PgTable } from "drizzle-orm/pg-core";
import type { db as dbType } from "@/lib/db";
import {
  ORG_EXPORT_TABLES,
  type OrgExportTable,
  REDACTED_COLUMNS,
  USER_EXPORT_COLUMNS,
} from "./registry";
import { type OrgExportScopeInput, scopeCondition } from "./scope";

export type ExportRow = Record<string, unknown>;

/** Det, ZIP-byggeren og README'en bruger fra en eksporteret tabel. */
export interface ExportEntry {
  key: string;
  table: PgTable;
  /** Filnavn i ZIP'en uden endelse. */
  file: string;
  /** Dansk navn til README og brugerflade. */
  label: string;
}

export interface CollectedTable {
  entry: ExportEntry;
  /** JS-nøgler i den rækkefølge, de står i tabellen (efter redaktion). */
  columns: string[];
  /** JS-nøgler for decimal-kolonner (til dansk decimalkomma i CSV). */
  numericColumns: Set<string>;
  rows: ExportRow[];
}

/** Kolonner der må eksporteres for en tabel: alt undtagen hemmeligheder. */
export function exportableColumns(entry: OrgExportTable): {
  columns: string[];
  numericColumns: Set<string>;
} {
  const all = getTableColumns(entry.table) as Record<string, AnyPgColumn>;
  const allowUsers = new Set<string>(USER_EXPORT_COLUMNS);
  const columns: string[] = [];
  const numericColumns = new Set<string>();
  for (const [jsKey, col] of Object.entries(all)) {
    if (REDACTED_COLUMNS.has(col.name)) continue;
    if (entry.scope.kind === "orgUsers" && !allowUsers.has(jsKey)) continue;
    columns.push(jsKey);
    if (col.columnType === "PgNumeric") numericColumns.add(jsKey);
  }
  return { columns, numericColumns };
}

export async function collectOrgExport(
  db: typeof dbType,
  scope: OrgExportScopeInput,
): Promise<CollectedTable[]> {
  const out: CollectedTable[] = [];
  for (const entry of ORG_EXPORT_TABLES) {
    const { columns, numericColumns } = exportableColumns(entry);
    const cond = scopeCondition(entry, scope);
    let rows: ExportRow[] = [];
    if (cond) {
      const all = getTableColumns(entry.table) as Record<string, AnyPgColumn>;
      const selection = Object.fromEntries(columns.map((k) => [k, all[k]]));
      // Sekventielt, så en stor org ikke åbner 100 forbindelser på én gang.
      rows = (await db
        .select(selection)
        .from(entry.table)
        .where(cond)) as ExportRow[];
    }
    out.push({ entry, columns, numericColumns, rows });
  }
  return out;
}
