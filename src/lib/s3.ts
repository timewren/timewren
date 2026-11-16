import { S3Client } from "@aws-sdk/client-s3";
import { appUrlEnv } from "@/lib/runtime-env";
import { getStorageDriver, localStorageRoot } from "@/lib/storage/config";
import { LocalStorageClient } from "@/lib/storage/local";

const driver = getStorageDriver();

if (driver === "none") {
  console.warn(
    "S3_ENDPOINT not set (og STORAGE_DRIVER ikke local) — file uploads will not work",
  );
}

/**
 * S3-klienten. Med STORAGE_DRIVER=local er det i stedet et lokalt fillager
 * med samme `send(command)`-flade (se `@/lib/storage/local`).
 */
export const s3: S3Client =
  driver === "local"
    ? (new LocalStorageClient(localStorageRoot()) as unknown as S3Client)
    : new S3Client({
        region: process.env.S3_REGION || "fsn1",
        endpoint: process.env.S3_ENDPOINT || "",
        credentials: {
          accessKeyId: process.env.S3_ACCESS_KEY_ID || "",
          secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || "",
        },
        forcePathStyle: true, // Required for Hetzner Object Storage
      });

export const S3_BUCKET = process.env.S3_BUCKET || "timetrack";

/** Optional prefix for all keys, e.g. "timetrack/" to namespace within a shared bucket */
const S3_PREFIX = process.env.S3_PREFIX || "";

/** Prefix a key with the configured S3_PREFIX */
export function prefixKey(key: string): string {
  return S3_PREFIX ? `${S3_PREFIX}/${key}` : key;
}

/** Build the public URL for an uploaded file */
export function getPublicUrl(key: string): string {
  if (driver === "local") return `${LOCAL_PUBLIC_BASE}${key}`;
  const endpoint = process.env.S3_ENDPOINT || "";
  return `${endpoint}/${S3_BUCKET}/${prefixKey(key)}`;
}

/**
 * Offentlige filer (avatarer, logoer) serveres af appen selv, når lageret er
 * lokalt: `/api/files/public/<mappe>/<bruger>/<fil>`. Ruten tilføjer S3_PREFIX.
 */
export const LOCAL_PUBLIC_BASE = `${(appUrlEnv() || "").replace(/\/+$/, "")}/api/files/public/`;
