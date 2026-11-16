/**
 * Filer i eksporten: vedhæftninger gemt i databasen og filer i TimeTracks
 * objektlager (logoer, billeder vedhæftet opgaver, mail-vedhæftninger).
 *
 * Sikkerhedsreglen (#843): objektlageret læses med TimeTracks egne nøgler, og
 * bucketen rummer også private filer fra andre organisationer (fx andres
 * færdige eksporter og mail-vedhæftninger). Derfor hentes et objekt KUN når
 * 1. referencen står i en af de kolonner, der er listet i FILE_COLUMNS (aldrig
 *    ud fra URL'er eller stier i fritekst som noter, beskrivelser og
 *    kommentarer), og rækken allerede er scopet til eksporten via databasen,
 * 2. objektnøglen har præcis den form, uploaden giver, under den forventede
 *    mappe, og
 * 3. nøglen eller objektets metadata binder filen til organisationen (eller
 *    til brugeren i bruger-eksporten).
 * Alt andet står kun i filer/oversigt.csv som "Ikke med".
 */

import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getTx } from "@/i18n/server-text";
import { locateEmailAttachment } from "@/lib/email/attachment-location";
import { LOCAL_PUBLIC_BASE, prefixKey, S3_BUCKET, s3 } from "@/lib/s3";
import { getStorageDriver } from "@/lib/storage/config";
import { headObject } from "@/lib/storage/objects";
import {
  ORG_ID_META,
  taskImageKeyFromUrl,
  UPLOADED_BY_META,
} from "@/lib/upload/s3";
import type { CollectedTable, ExportRow } from "./collect";

export const MAX_FILE_BYTES = 50 * 1024 * 1024; // 50 MB pr. fil
export const MAX_TOTAL_FILE_BYTES = 1024 * 1024 * 1024; // 1 GB i alt
const FETCH_TIMEOUT_MS = 30_000;

export interface ExportFile {
  /** Sti i ZIP'en. */
  path: string;
  data: Uint8Array;
}

export interface FileManifestRow {
  kilde: string;
  sti: string;
  status: string;
}

/**
 * Læser objekter i TimeTracks bucket. Får kun FULDE nøgler (inkl. S3_PREFIX),
 * som allerede har bestået valideringen nedenfor.
 */
export interface ObjectReader {
  head(key: string): Promise<{ metadata: Record<string, string> } | null>;
  get(key: string): Promise<Uint8Array>;
}

/** Hvem eksporten er til. Afgør hvilke objekter der hører til den. */
export interface FileOwner {
  /** Organisationen. null = bruger uden organisation. */
  orgId: string | null;
  /** Brugeren, der bad om eksporten. */
  userId: string;
  /** "org" = hele organisationen, "user" = kun brugerens egne data. */
  mode: "org" | "user";
  /**
   * Brugere, hvis offentlige uploads (logoer, favicons) må komme med. I
   * org-eksporten organisationens medlemmer, ellers kun brugeren selv.
   */
  uploaderIds: ReadonlySet<string>;
}

type FileKind = "publicUpload" | "taskImage" | "emailAttachment";

interface FileColumn {
  /** Nøglen i registret (fx "companyProfiles"). */
  table: string;
  /** JS-nøglen for kolonnen. */
  column: string;
  kind: FileKind;
}

/**
 * De ENESTE kolonner, der kan få en fil fra objektlageret med. Værdierne kan
 * være skrevet af brugere (fx logoUrl og storageUrl kommer fra klienten), så
 * de valideres stadig hver for sig. emailThreads.attachments skrives kun af
 * mailsynkroniseringen (src/lib/workers/email-sync-worker.ts).
 */
export const FILE_COLUMNS: readonly FileColumn[] = [
  { table: "organizations", column: "logo", kind: "publicUpload" },
  { table: "companyProfiles", column: "logoUrl", kind: "publicUpload" },
  { table: "invoiceTemplates", column: "logoUrl", kind: "publicUpload" },
  { table: "portalBranding", column: "logoUrl", kind: "publicUpload" },
  { table: "portalBranding", column: "faviconUrl", kind: "publicUpload" },
  { table: "taskAttachments", column: "storageUrl", kind: "taskImage" },
  { table: "emailThreads", column: "attachments", kind: "emailAttachment" },
];

/** Mapperne fra /api/upload. Nøglen er <mappe>/<bruger-id>/<tidsstempel>.webp. */
const PUBLIC_UPLOAD_KEY_RE =
  /^(?:logos|favicons|profile|uploads)\/([A-Za-z0-9_-]{1,64})\/\d{1,16}\.webp$/;

/**
 * Den logiske nøgle (uden S3_PREFIX) og uploaderens id for en URL, som
 * `getPublicUrl()` gav ved upload. null for alt andet.
 */
export function publicUploadKey(
  value: string,
): { key: string; uploaderId: string } | null {
  const endpoint = process.env.S3_ENDPOINT?.trim().replace(/\/+$/, "");
  const base =
    getStorageDriver() === "local"
      ? LOCAL_PUBLIC_BASE
      : endpoint
        ? `${endpoint}/${S3_BUCKET}/${prefixKey("")}`
        : null;
  if (!base) return null;
  if (!value.startsWith(base)) return null;
  const key = value.slice(base.length);
  const m = PUBLIC_UPLOAD_KEY_RE.exec(key);
  return m ? { key, uploaderId: m[1] } : null;
}

/** Gør et filnavn sikkert i en ZIP: ingen mapper, ingen "..", ingen styretegn. */
export function safeName(name: string, max = 120): string {
  // Kun ASCII i stierne: ikke alle udpakkere læser UTF-8-filnavne i ZIP.
  const cleaned = name
    .replace(/æ/g, "ae")
    .replace(/Æ/g, "Ae")
    .replace(/ø/g, "oe")
    .replace(/Ø/g, "Oe")
    .replace(/å/g, "aa")
    .replace(/Å/g, "Aa")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/^[._]+/, "")
    .replace(/_+/g, "_");
  const trimmed = cleaned.slice(-max);
  return trimmed.length > 0 ? trimmed : "fil";
}

export const defaultReader: ObjectReader = {
  head: headObject,
  async get(key) {
    const res = await s3.send(
      new GetObjectCommand({ Bucket: S3_BUCKET, Key: key }),
      { abortSignal: AbortSignal.timeout(FETCH_TIMEOUT_MS) },
    );
    if ((res.ContentLength ?? 0) > MAX_FILE_BYTES)
      throw new FileReadError("tooBig");
    if (!res.Body) throw new FileReadError("empty");
    const buf = await res.Body.transformToByteArray();
    if (buf.byteLength > MAX_FILE_BYTES) throw new FileReadError("tooBig");
    return buf;
  },
};

function isBytes(v: unknown): v is Uint8Array {
  return v instanceof Uint8Array;
}

/** Teknisk årsag fra læseren; teksten i oversigten kommer fra kataloget (brugerens sprog). */
export class FileReadError extends Error {
  constructor(public readonly reason: "tooBig" | "empty" | "missing") {
    super(reason);
    this.name = "FileReadError";
  }
}

const READ_REASON_KEYS = {
  tooBig: "readme.reasonTooBig",
  empty: "readme.reasonEmpty",
  missing: "readme.reasonMissing",
} as const;

interface Candidate {
  kilde: string;
  /** Fuld objektnøgle (inkl. S3_PREFIX). */
  key: string;
  path: string;
  /** Ekstra krav til objektets metadata (opgavebilleder). */
  metaCheck?: (meta: Record<string, string>) => boolean;
}

function taskImageAllowed(owner: FileOwner) {
  return (meta: Record<string, string>): boolean => {
    const objectOrg = meta[ORG_ID_META] || null;
    const uploader = meta[UPLOADED_BY_META] || null;
    const byUser = uploader === owner.userId;
    if (owner.orgId) {
      if (objectOrg !== owner.orgId) return false;
      return owner.mode === "org" || byUser;
    }
    // Uden organisation: kun brugerens egne billeder.
    return byUser;
  };
}

/**
 * Modtager hver fil, så snart den er hentet (fx for at skrive den ind i ZIP'en).
 * Filen holdes ikke tilbage bagefter, så der højst er én fil i hukommelsen ad
 * gangen. Kaster sinken, afbrydes hele udtrækket (fejlen sluges ikke som en
 * "Ikke hentet"-linje i oversigten).
 */
export type FileSink = (file: ExportFile) => void | Promise<void>;

/**
 * Trækker filer ud af de indsamlede rækker, én ad gangen. Muterer rækkerne:
 * binært indhold erstattes af stien i ZIP'en, så JSON og CSV peger på filen.
 *
 * Med `sink` afleveres hver fil dér og returneres ikke (`files` er tom); uden
 * `sink` samles filerne i `files`. `fileCount` er antallet af filer i begge
 * tilfælde.
 */
export async function extractFiles(
  tables: CollectedTable[],
  owner: FileOwner,
  reader: ObjectReader = defaultReader,
  sink?: FileSink,
  locale?: string | null,
): Promise<{
  files: ExportFile[];
  manifest: FileManifestRow[];
  fileCount: number;
}> {
  const tx = await getTx("serverExports", locale);
  const NOT_OWN = tx("readme.statusNotOwn");
  const NOT_STORAGE = tx("readme.statusNotStorage");
  const files: ExportFile[] = [];
  const manifest: FileManifestRow[] = [];
  let fileCount = 0;
  let sinkFailure: { error: unknown } | null = null;
  const usedPaths = new Set<string>();
  let total = 0;

  const uniquePath = (path: string): string => {
    if (!usedPaths.has(path)) {
      usedPaths.add(path);
      return path;
    }
    let i = 2;
    const dot = path.lastIndexOf(".");
    const base = dot > path.lastIndexOf("/") ? path.slice(0, dot) : path;
    const ext = dot > path.lastIndexOf("/") ? path.slice(dot) : "";
    while (usedPaths.has(`${base}-${i}${ext}`)) i++;
    const p = `${base}-${i}${ext}`;
    usedPaths.add(p);
    return p;
  };

  const add = async (
    kilde: string,
    path: string,
    data: Uint8Array,
  ): Promise<string> => {
    if (total + data.byteLength > MAX_TOTAL_FILE_BYTES) {
      manifest.push({
        kilde,
        sti: "",
        status: tx("readme.statusTotalLimit"),
      });
      return "";
    }
    const p = uniquePath(path);
    total += data.byteLength;
    fileCount++;
    if (sink) {
      try {
        await sink({ path: p, data });
      } catch (error) {
        sinkFailure = { error };
        throw error;
      }
    } else {
      files.push({ path: p, data });
    }
    manifest.push({ kilde, sti: p, status: "Med" });
    return p;
  };

  // 1. Binært indhold i rækkerne (fx opgave-vedhæftninger gemt i databasen)
  for (const t of tables) {
    for (const row of t.rows) {
      for (const [key, value] of Object.entries(row)) {
        if (!isBytes(value)) continue;
        const name =
          typeof row.filename === "string" ? row.filename : `${key}.bin`;
        const id = typeof row.id === "string" ? row.id : "uden-id";
        const path = `filer/${t.entry.file}/${safeName(id, 40)}-${safeName(name)}`;
        if (value.byteLength > MAX_FILE_BYTES) {
          manifest.push({
            kilde: `${t.entry.file}/${id}`,
            sti: "",
            status: tx("readme.statusTooBig"),
          });
          row[key] = null;
          continue;
        }
        const stored = await add(`${t.entry.file}/${id}`, path, value);
        row[key] = stored ? { filIEksporten: stored } : null;
      }
    }
  }

  // 2. Objekter i lageret, kun fra FILE_COLUMNS og kun når de hører til.
  const candidates: Candidate[] = [];
  const reject = (kilde: string, status: string) =>
    manifest.push({ kilde, sti: "", status });

  for (const t of tables) {
    const cols = FILE_COLUMNS.filter((c) => c.table === t.entry.key);
    if (cols.length === 0) continue;
    for (const row of t.rows) {
      const id = typeof row.id === "string" ? row.id : "uden-id";
      for (const col of cols) {
        const value = row[col.column];
        const kilde = `${t.entry.file}/${id}/${col.column}`;
        const dir = `filer/${t.entry.file}/${safeName(id, 40)}`;

        if (col.kind === "publicUpload") {
          if (typeof value !== "string" || value.trim() === "") continue;
          const parsed = publicUploadKey(value.trim());
          if (!parsed) {
            reject(kilde, NOT_STORAGE);
            continue;
          }
          if (!owner.uploaderIds.has(parsed.uploaderId)) {
            reject(kilde, NOT_OWN);
            continue;
          }
          candidates.push({
            kilde,
            key: prefixKey(parsed.key),
            path: `${dir}-${safeName(col.column)}.webp`,
          });
        } else if (col.kind === "taskImage") {
          if (typeof value !== "string" || value.trim() === "") continue;
          const key = taskImageKeyFromUrl(value.trim());
          if (!key) {
            reject(kilde, NOT_STORAGE);
            continue;
          }
          const name =
            typeof row.filename === "string"
              ? row.filename
              : key.slice(key.lastIndexOf("/") + 1);
          candidates.push({
            kilde,
            key: prefixKey(key),
            path: `${dir}-${safeName(name)}`,
            metaCheck: taskImageAllowed(owner),
          });
        } else {
          if (!Array.isArray(value)) continue;
          value.forEach((att, i) => {
            const a = att as { filename?: unknown; storagePath?: unknown };
            if (typeof a?.storagePath !== "string" || !a.storagePath) return;
            const k = `${kilde}/${i}`;
            const loc = locateEmailAttachment(a.storagePath);
            if (loc.kind !== "s3") {
              reject(k, NOT_STORAGE);
              return;
            }
            const name =
              typeof a.filename === "string" && a.filename
                ? a.filename
                : `vedhaeftning-${i + 1}`;
            candidates.push({
              kilde: k,
              key: loc.key,
              path: `${dir}-${safeName(name)}`,
            });
          });
        }
      }
    }
  }

  for (const c of candidates) {
    try {
      if (c.metaCheck) {
        const head = await reader.head(c.key);
        if (!head) throw new FileReadError("missing");
        if (!c.metaCheck(head.metadata)) {
          reject(c.kilde, NOT_OWN);
          continue;
        }
      }
      const data = await reader.get(c.key);
      await add(c.kilde, c.path, data);
    } catch (err) {
      if (sinkFailure) throw (sinkFailure as { error: unknown }).error;
      reject(
        c.kilde,
        tx("readme.statusNotFetched", {
          reason:
            err instanceof FileReadError
              ? tx(READ_REASON_KEYS[err.reason])
              : err instanceof Error
                ? err.message
                : tx("readme.reasonError"),
        }),
      );
    }
  }

  return { files, manifest, fileCount };
}

export type { ExportRow };
