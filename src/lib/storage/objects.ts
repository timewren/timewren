/**
 * Små hjælpere til private objekter i den delte S3-bucket.
 *
 * Bucketen er versioneret: et almindeligt DeleteObject lægger kun en delete
 * marker, og data bliver liggende som en noncurrent version. Al sletning af
 * persondata skal derfor gå gennem `deleteAllVersions`.
 *
 * Alle nøgler her er FULDE objektnøgler (inkl. S3_PREFIX) — kalderen anvender
 * `prefixKey()` fra `@/lib/s3`.
 */

import {
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectVersionsCommand,
} from "@aws-sdk/client-s3";
import { S3_BUCKET, s3 } from "@/lib/s3";

/** Hård øvre grænse, så en fejlende server aldrig kan holde løkken i live. */
const MAX_LIST_PAGES = 1000;

export type DeleteTarget =
  /** Præcis denne nøgle — andre nøgler med samme præfiks røres ikke. */
  | { key: string }
  /** Alle nøgler under præfikset. Skal ende på "/" (user1/ matcher ikke user10/). */
  | { prefix: string };

/**
 * Sletter ALLE versioner (og delete markers) af en nøgle eller et præfiks.
 * Returnerer antal slettede versioner. Fejl kastes videre, så kalderen kan
 * logge dem — en tavs delvis sletning er netop det, der skal undgås.
 */
export async function deleteAllVersions(target: DeleteTarget): Promise<number> {
  const exactKey = "key" in target ? target.key : null;
  const prefix = "key" in target ? target.key : target.prefix;

  if (!prefix) {
    throw new Error(
      "deleteAllVersions kræver en ikke-tom nøgle eller et præfiks",
    );
  }
  if (exactKey === null && !prefix.endsWith("/")) {
    throw new Error("Et sletnings-præfiks skal ende på /");
  }

  const matches = (candidate: string) =>
    exactKey !== null ? candidate === exactKey : candidate.startsWith(prefix);

  let deleted = 0;
  let keyMarker: string | undefined;
  let versionIdMarker: string | undefined;

  for (let page = 0; page < MAX_LIST_PAGES; page++) {
    const listing = await s3.send(
      new ListObjectVersionsCommand({
        Bucket: S3_BUCKET,
        Prefix: prefix,
        KeyMarker: keyMarker,
        VersionIdMarker: versionIdMarker,
      }),
    );

    // Prefix=nøgle matcher også nøgler som "<nøgle>.bak": filtrér eksakt.
    const entries = [
      ...(listing.Versions ?? []),
      ...(listing.DeleteMarkers ?? []),
    ];
    const objects = entries
      .filter((entry) => entry.Key && matches(entry.Key))
      .map((entry) => ({
        Key: entry.Key as string,
        ...(entry.VersionId ? { VersionId: entry.VersionId } : {}),
      }));
    // Én DeleteObjects pr. side (højst 1000 versioner). Fejl pr. nøgle kommer
    // i `Errors` i stedet for som exception, så de skal tjekkes eksplicit.
    if (objects.length > 0) {
      const result = await s3.send(
        new DeleteObjectsCommand({
          Bucket: S3_BUCKET,
          Delete: { Objects: objects, Quiet: true },
        }),
      );
      const errors = result.Errors ?? [];
      if (errors.length > 0) {
        throw new Error(
          `DeleteObjects fejlede for ${errors.length} af ${objects.length} versioner (${errors[0]?.Code ?? "ukendt"})`,
        );
      }
      deleted += objects.length;
    }

    if (!listing.IsTruncated) return deleted;
    keyMarker = listing.NextKeyMarker;
    versionIdMarker = listing.NextVersionIdMarker;
    if (!keyMarker) return deleted;
  }

  throw new Error(
    `deleteAllVersions afbrudt efter ${MAX_LIST_PAGES} sider (${prefix})`,
  );
}

export interface ObjectInfo {
  contentType?: string;
  contentLength?: number;
  /** S3 user-metadata (nøgler er små bogstaver, uden x-amz-meta-). */
  metadata: Record<string, string>;
}

function isNotFound(err: unknown): boolean {
  const e = err as {
    name?: string;
    $metadata?: { httpStatusCode?: number };
  } | null;
  return (
    e?.name === "NotFound" ||
    e?.name === "NoSuchKey" ||
    e?.$metadata?.httpStatusCode === 404
  );
}

/** Metadata for et objekt, eller null hvis det ikke findes. */
export async function headObject(key: string): Promise<ObjectInfo | null> {
  try {
    const res = await s3.send(
      new HeadObjectCommand({ Bucket: S3_BUCKET, Key: key }),
    );
    return {
      contentType: res.ContentType,
      contentLength: res.ContentLength,
      metadata: res.Metadata ?? {},
    };
  } catch (err) {
    if (isNotFound(err)) return null;
    throw err;
  }
}

export interface ObjectStream extends ObjectInfo {
  stream: ReadableStream<Uint8Array>;
}

/** Objektet som web-stream (ingen buffering i hukommelsen), eller null. */
export async function getObjectStream(
  key: string,
): Promise<ObjectStream | null> {
  try {
    const res = await s3.send(
      new GetObjectCommand({ Bucket: S3_BUCKET, Key: key }),
    );
    if (!res.Body) return null;
    return {
      stream: res.Body.transformToWebStream() as ReadableStream<Uint8Array>,
      contentType: res.ContentType,
      contentLength: res.ContentLength,
      metadata: res.Metadata ?? {},
    };
  } catch (err) {
    if (isNotFound(err)) return null;
    throw err;
  }
}
