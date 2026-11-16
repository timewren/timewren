/**
 * Opgave- og kommentarbilleder (task-image) i den delte S3-bucket.
 *
 * Billederne er PRIVATE: de uploades uden ACL, nøglen indeholder kun en uuid
 * (aldrig filnavnet), og klienten får en app-URL til den autentificerede rute
 * `/api/files/task-image/...` i stedet for en offentlig S3-URL.
 *
 * Modulet bruger den delte klient fra `@/lib/s3` (S3_ACCESS_KEY_ID,
 * S3_ENDPOINT som fuld URL, S3_BUCKET, S3_PREFIX) som alle andre uploads.
 */

import { PutObjectCommand } from "@aws-sdk/client-s3";
import { prefixKey, S3_BUCKET, s3 } from "@/lib/s3";
import { deleteAllVersions, headObject } from "@/lib/storage/objects";

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

/**
 * Logisk nøgle (uden S3_PREFIX): uploads/images/YYYY/MM/<uuid>.<ext>.
 * Den eneste form, der nogensinde læses, serveres eller slettes.
 */
export const TASK_IMAGE_KEY_RE = new RegExp(
  `^uploads/images/\\d{4}/(?:0[1-9]|1[0-2])/${UUID}\\.(?:jpg|png|webp|gif)$`,
);

const TASK_IMAGE_KEY_DIR = "uploads/images/";
export const TASK_IMAGE_URL_PREFIX = "/api/files/task-image/";

/** S3 user-metadata, der gør ejerskab læsbart uden DB-opslag. */
export const UPLOADED_BY_META = "uploaded-by";
export const ORG_ID_META = "org-id";

export function newTaskImageKey(now: Date = new Date()): string {
  const month = String(now.getMonth() + 1).padStart(2, "0");
  return `${TASK_IMAGE_KEY_DIR}${now.getFullYear()}/${month}/${crypto.randomUUID()}.jpg`;
}

/** App-URL (relativ) til en gyldig logisk nøgle. */
export function taskImageUrl(key: string): string {
  if (!TASK_IMAGE_KEY_RE.test(key)) {
    throw new Error("Ugyldig task-image-nøgle");
  }
  return `${TASK_IMAGE_URL_PREFIX}${key.slice(TASK_IMAGE_KEY_DIR.length)}`;
}

/**
 * Logisk nøgle ud fra stien efter `/api/files/task-image/`, delt i segmenter.
 * Returnerer null for alt der ikke er præcis en gyldig nøgle — også
 * `..`, tomme segmenter og kodede skråstreger.
 */
export function taskImageKeyFromSegments(segments: string[]): string | null {
  if (segments.length === 0) return null;
  for (const segment of segments) {
    if (
      segment === "" ||
      segment === "." ||
      segment === ".." ||
      /[\\/%]/.test(segment)
    ) {
      return null;
    }
  }
  const key = `${TASK_IMAGE_KEY_DIR}${segments.join("/")}`;
  return TASK_IMAGE_KEY_RE.test(key) ? key : null;
}

/**
 * Logisk nøgle ud fra en gemt URL (taskAttachments.storageUrl, billeder i
 * kommentarer). KUN vores egen app-URL accepteres. Det er bevidst: URL'er
 * kommer fra klienter (et kommentar-billede kan pege på hvad som helst), og
 * de må aldrig kunne udpege andre objekter i bucketen — hverken til læsning
 * eller sletning.
 */
export function taskImageKeyFromUrl(url: unknown): string | null {
  if (typeof url !== "string" || !url.startsWith(TASK_IMAGE_URL_PREFIX)) {
    return null;
  }
  const key = `${TASK_IMAGE_KEY_DIR}${url.slice(TASK_IMAGE_URL_PREFIX.length)}`;
  return TASK_IMAGE_KEY_RE.test(key) ? key : null;
}

/**
 * Uploader et billede privat (ingen ACL) og returnerer app-URL'en.
 * `key` er den logiske nøgle fra `newTaskImageKey()`.
 */
export async function uploadToS3(
  buffer: Buffer,
  key: string,
  contentType: string,
  metadata: Record<string, string> = {},
): Promise<string> {
  const url = taskImageUrl(key);
  await s3.send(
    new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: prefixKey(key),
      Body: buffer,
      ContentType: contentType,
      Metadata: metadata,
      CacheControl: "private, no-store",
    }),
  );
  return url;
}

/**
 * Sletter alle versioner af en FULD objektnøgle (inkl. S3_PREFIX).
 * Bucketen er versioneret, så et almindeligt DeleteObject ville kun lægge en
 * delete marker og efterlade indholdet.
 */
export async function deleteFromS3(key: string): Promise<void> {
  await deleteAllVersions({ key });
}

/**
 * Sletter et opgave-/kommentarbillede ud fra den URL, der står i indholdet.
 * Sletter kun hvis URL'en er en gyldig app-URL OG uploaderen er `userId`, så
 * en bruger ikke kan slette en kollegas billede ved at lægge dets URL ind i
 * sin egen kommentar og slette den. Returnerer true hvis noget blev slettet.
 */
export async function deleteTaskImageByUrl(
  url: unknown,
  userId: string,
): Promise<boolean> {
  const key = taskImageKeyFromUrl(url);
  if (!key) return false;

  const objectKey = prefixKey(key);
  const info = await headObject(objectKey);
  if (!info || info.metadata[UPLOADED_BY_META] !== userId) return false;

  await deleteFromS3(objectKey);
  return true;
}
