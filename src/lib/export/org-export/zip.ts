/**
 * Skriver ZIP-filen til organisations-eksporten som en strøm:
 *   filer/...          vedhæftninger, logoer og billeder
 *   filer/oversigt.csv hvilke filer der er med, og hvilke der ikke kunne hentes
 *   README.txt         forklaring på dansk
 *   data.json          alle tabeller, komplet og maskinlæsbart
 *   csv/<tabel>.csv    én læsevenlig fil pr. tabel (semikolon, UTF-8)
 *
 * Filerne kommer først, fordi README og data.json skal vide, hvor mange filer
 * der kom med, og det ved vi først, når de er hentet. Filerne hentes og skrives
 * én ad gangen, så arkivet aldrig ligger samlet i hukommelsen.
 */

import { strToU8, Zip, ZipDeflate, ZipPassThrough } from "fflate";
import { getTx } from "@/i18n/server-text";
import type { db as dbType } from "@/lib/db";
import { escapeCsv } from "@/lib/utils/spreadsheet";
import { type CollectedTable, collectOrgExport } from "./collect";
import {
  defaultReader,
  type ExportFile,
  extractFiles,
  type FileManifestRow,
  type FileOwner,
  type ObjectReader,
} from "./files";
import { buildReadme, buildUserReadme } from "./readme";
import type { OrgExportScopeInput } from "./scope";
import type { ExportOutput } from "./storage";
import { collectUserExport } from "./user-collect";
import type { UserExportScopeInput } from "./user-scope";

const BOM = "﻿";

const CPH = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Europe/Copenhagen",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

/** Rækker pr. tekststump i CSV og data.json. */
const ROWS_PER_PART = 500;
/** Bytes pr. skub ind i komprimeringen, så der kan gives plads undervejs. */
const PUSH_BYTES = 256 * 1024;

function csvCell(value: unknown, numeric: boolean): string {
  let s: string;
  if (value === null || value === undefined) s = "";
  else if (value instanceof Date)
    s = Number.isNaN(value.getTime()) ? "" : CPH.format(value);
  else if (typeof value === "boolean") s = value ? "Ja" : "Nej";
  else if (typeof value === "object") s = JSON.stringify(value);
  else s = String(value);
  const isNumeric = numeric && /^-?\d+(\.\d+)?$/.test(s);
  if (isNumeric) s = s.replace(".", ",");
  return escapeCsv(s, { numeric: isNumeric || typeof value === "number" });
}

function* csvParts(t: CollectedTable): Generator<string> {
  yield BOM + t.columns.map((c) => csvCell(c, false)).join(";");
  for (let i = 0; i < t.rows.length; i += ROWS_PER_PART) {
    yield t.rows
      .slice(i, i + ROWS_PER_PART)
      .map(
        (row) =>
          `\r\n${t.columns.map((c) => csvCell(row[c], t.numericColumns.has(c))).join(";")}`,
      )
      .join("");
  }
}

export function tableToCsv(t: CollectedTable): string {
  return [...csvParts(t)].join("");
}

function manifestCsv(rows: FileManifestRow[]): string {
  const lines = ["kilde;sti;status"];
  for (const r of rows) {
    lines.push(
      [r.kilde, r.sti, r.status].map((v) => csvCell(v, false)).join(";"),
    );
  }
  return BOM + lines.join("\r\n");
}

export interface OrgExportMeta {
  organizationId: string | null;
  organizationName: string | null;
  requestedByUserId: string;
  exportedAt: Date;
  /** "user" = brugerens egne data (default er hele organisationen). */
  kind?: "org" | "user";
  /** Sproget til README og filoversigt (modtagerens). Uden: dansk. */
  locale?: string | null;
}

const indent = (text: string, pad: string) => text.replace(/\n/g, `\n${pad}`);

/**
 * data.json i stumper. Sammensat til præcis det, `JSON.stringify(json, null, 2)`
 * giver for { metadata, tables }, men uden at hele eksporten bliver én streng.
 */
function* dataJsonParts(
  tables: CollectedTable[],
  fileCount: number,
  meta: OrgExportMeta,
): Generator<string> {
  const metadata = {
    exportedAt: meta.exportedAt.toISOString(),
    organizationId: meta.organizationId,
    organizationName: meta.organizationName,
    requestedByUserId: meta.requestedByUserId,
    format:
      meta.kind === "user" ? "timetrack-user-export" : "timetrack-org-export",
    version: 1,
    rowCounts: Object.fromEntries(
      tables.map((t) => [t.entry.file, t.rows.length]),
    ),
    fileCount,
  };
  yield `{\n  "metadata": ${indent(JSON.stringify(metadata, null, 2), "  ")},\n  "tables": {`;
  for (const [i, t] of tables.entries()) {
    const head = `${i > 0 ? "," : ""}\n    ${JSON.stringify(t.entry.file)}: `;
    if (t.rows.length === 0) {
      yield `${head}[]`;
      continue;
    }
    yield `${head}[`;
    for (let r = 0; r < t.rows.length; r += ROWS_PER_PART) {
      yield t.rows
        .slice(r, r + ROWS_PER_PART)
        .map(
          (row, j) =>
            `${r + j > 0 ? "," : ""}\n      ${indent(JSON.stringify(row, null, 2), "      ")}`,
        )
        .join("");
    }
    yield "\n    ]";
  }
  yield tables.length > 0 ? "\n  }\n}" : "}\n}";
}

/**
 * Skriver en ZIP til `out`, fil for fil. fflate leverer bidderne synkront;
 * efter hvert skub afleveres de til `out`, som kan holde skribenten tilbage,
 * til modtageren har plads.
 */
class ZipStream {
  private pending: Uint8Array[] = [];
  private failure: Error | null = null;
  private readonly zip: Zip;
  byteLength = 0;

  constructor(private readonly out: ExportOutput) {
    this.zip = new Zip((err, chunk) => {
      if (err) this.failure = err;
      else this.pending.push(chunk);
    });
  }

  private async drain(): Promise<void> {
    if (this.failure) throw this.failure;
    const chunks = this.pending;
    this.pending = [];
    for (const chunk of chunks) {
      this.byteLength += chunk.byteLength;
      await this.out.write(chunk);
    }
  }

  /** Allerede komprimeret indhold (billeder, PDF): gemmes uden komprimering. */
  async addStored(path: string, data: Uint8Array): Promise<void> {
    const file = new ZipPassThrough(path);
    this.zip.add(file);
    file.push(data, true);
    await this.drain();
  }

  /** Tekst, komprimeret og skrevet stump for stump. */
  async addText(path: string, parts: Iterable<string>): Promise<void> {
    const file = new ZipDeflate(path, { level: 6 });
    this.zip.add(file);
    for (const part of parts) {
      const bytes = strToU8(part);
      for (let i = 0; i < bytes.length; i += PUSH_BYTES) {
        file.push(bytes.subarray(i, i + PUSH_BYTES), false);
        await this.drain();
      }
    }
    file.push(new Uint8Array(0), true);
    await this.drain();
  }

  async finish(): Promise<void> {
    this.zip.end();
    await this.drain();
  }
}

/**
 * Skriver hele eksporten til `out`: henter filerne én ad gangen, skriver dem
 * ind i ZIP'en med det samme, og tilføjer derefter oversigt, README, data.json
 * og CSV. Spidsbelastningen i hukommelsen er de indsamlede rækker, én fil
 * (højst MAX_FILE_BYTES) og én tabels tekststump ad gangen.
 */
export async function writeExportZip(
  out: ExportOutput,
  tables: CollectedTable[],
  owner: FileOwner,
  reader: ObjectReader,
  meta: OrgExportMeta,
): Promise<{ fileCount: number; byteLength: number }> {
  const zip = new ZipStream(out);
  const { manifest, fileCount } = await extractFiles(
    tables,
    owner,
    reader,
    // Filer er typisk allerede komprimeret (billeder, PDF).
    (file: ExportFile) => zip.addStored(file.path, file.data),
    meta.locale,
  );
  const t = await getTx("serverExports", meta.locale);
  const readme = meta.kind === "user" ? buildUserReadme : buildReadme;
  await zip.addText("README.txt", [
    readme(tables, fileCount, manifest, meta, t),
  ]);
  await zip.addText("data.json", dataJsonParts(tables, fileCount, meta));
  for (const t of tables) {
    await zip.addText(`csv/${t.entry.file}.csv`, csvParts(t));
  }
  if (manifest.length > 0) {
    await zip.addText("filer/oversigt.csv", [manifestCsv(manifest)]);
  }
  await zip.finish();
  return { fileCount, byteLength: zip.byteLength };
}

/**
 * Ejeren af filerne i en org-eksport. Logoer må kun komme med, hvis de er
 * uploadet af et medlem af organisationen (medlemsrækkerne er allerede scopet
 * til orgId), eller af brugeren selv uden organisation.
 */
export function orgFileOwner(
  tables: CollectedTable[],
  scope: OrgExportScopeInput,
): FileOwner {
  const uploaderIds = new Set<string>();
  if (scope.orgId) {
    const members = tables.find((t) => t.entry.key === "members")?.rows ?? [];
    for (const m of members) {
      if (m.organizationId === scope.orgId && typeof m.userId === "string") {
        uploaderIds.add(m.userId);
      }
    }
  } else {
    uploaderIds.add(scope.userId);
  }
  return { orgId: scope.orgId, userId: scope.userId, mode: "org", uploaderIds };
}

export interface ExportZipResult {
  rowCount: number;
  fileCount: number;
  byteLength: number;
}

/** Hele kæden: hent data, hent filer, skriv ZIP'en til `out`. */
export async function generateOrgExportZip(
  db: typeof dbType,
  scope: OrgExportScopeInput,
  out: ExportOutput,
  reader: ObjectReader = defaultReader,
  locale?: string | null,
): Promise<ExportZipResult> {
  const tables = await collectOrgExport(db, scope);
  const orgRow = tables.find((t) => t.entry.key === "organizations")?.rows[0];
  const { fileCount, byteLength } = await writeExportZip(
    out,
    tables,
    orgFileOwner(tables, scope),
    reader,
    {
      organizationId: scope.orgId,
      organizationName:
        typeof orgRow?.name === "string" ? (orgRow.name as string) : null,
      requestedByUserId: scope.userId,
      exportedAt: new Date(),
      locale,
    },
  );
  return {
    rowCount: tables.reduce((n, t) => n + t.rows.length, 0),
    fileCount,
    byteLength,
  };
}

/** Ejeren af filerne i en bruger-eksport: kun brugeren selv. */
export function userFileOwner(scope: UserExportScopeInput): FileOwner {
  return {
    orgId: scope.orgId,
    userId: scope.userId,
    mode: "user",
    uploaderIds: new Set([scope.userId]),
  };
}

/**
 * Bruger-eksporten: brugerens egne data i den aktive organisation. Samme
 * filregel som org-eksporten (se extractFiles): aldrig filer ud fra URL'er i
 * tekst, og fra lageret kun objekter, som brugeren selv har uploadet i den
 * aktive organisation.
 */
export async function generateUserExportZip(
  db: typeof dbType,
  scope: UserExportScopeInput,
  out: ExportOutput,
  reader: ObjectReader = defaultReader,
  locale?: string | null,
): Promise<ExportZipResult> {
  const tables = await collectUserExport(db, scope);
  const orgRow = tables.find((t) => t.entry.key === "organizations")?.rows[0];
  const { fileCount, byteLength } = await writeExportZip(
    out,
    tables,
    userFileOwner(scope),
    reader,
    {
      organizationId: scope.orgId,
      organizationName:
        typeof orgRow?.name === "string" ? (orgRow.name as string) : null,
      requestedByUserId: scope.userId,
      exportedAt: new Date(),
      kind: "user",
      locale,
    },
  );
  return {
    rowCount: tables.reduce((n, t) => n + t.rows.length, 0),
    fileCount,
    byteLength,
  };
}
