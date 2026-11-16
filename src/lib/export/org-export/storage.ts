/**
 * Færdige organisations-eksporter ligger som private objekter (ingen ACL, som
 * feedback-screenshots) i objektlageret, til linket udløber. Nøglen udledes af
 * anmodningens id, så der ikke skal en ny kolonne til.
 */
import { once } from "node:events";
import { PassThrough } from "node:stream";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { prefixKey, S3_BUCKET, s3 } from "@/lib/s3";
import { getStorageDriver, isStorageConfigured } from "@/lib/storage/config";

export function isExportStorageConfigured(): boolean {
  return isStorageConfigured();
}

export function orgExportKey(requestId: string): string {
  return prefixKey(`data-exports/${requestId}.zip`);
}

/** Der, hvor ZIP'en skrives hen. `write` venter, til modtageren kan tage mere. */
export interface ExportOutput {
  write(chunk: Uint8Array): Promise<void>;
}

const MIB = 1024 * 1024;
// S3 multipart: højst queueSize x partSize (16 MiB) buffer ad gangen, uanset
// hvor stor ZIP'en bliver. 8 MiB x 10.000 dele rummer 80 GB.
const UPLOAD_PART_SIZE = 8 * MIB;
const UPLOAD_QUEUE_SIZE = 2;

/**
 * Streamer ZIP'en til objektlageret som multipart-upload, mens `produce`
 * skriver den. Hele arkivet samles aldrig i hukommelsen. Fejler `produce`
 * eller uploaden, afbrydes uploaden, og de uploadede dele ryddes op.
 */
export async function putOrgExportStream(
  requestId: string,
  produce: (out: ExportOutput) => Promise<unknown>,
): Promise<void> {
  const body = new PassThrough({ highWaterMark: MIB });
  const params = {
    Bucket: S3_BUCKET,
    Key: orgExportKey(requestId),
    Body: body,
    ContentType: "application/zip",
    // Ingen ACL: privat objekt. Hentes kun via den loggede download-rute.
  };
  // Lokalt lager (#963) kender ikke multipart; det streamer Body direkte til
  // en fil, så hele ZIP'en heller ikke dér samles i hukommelsen.
  const upload =
    getStorageDriver() === "local"
      ? null
      : new Upload({
          client: s3,
          params,
          queueSize: UPLOAD_QUEUE_SIZE,
          partSize: UPLOAD_PART_SIZE,
          leavePartsOnError: false,
        });
  const done: Promise<unknown> = upload
    ? upload.done()
    : s3.send(new PutObjectCommand(params));
  // Fejlen afleveres nedenfor; undgå unhandled rejection, hvis produce fejler først.
  done.catch(() => {});

  const out: ExportOutput = {
    async write(chunk) {
      if (!body.write(chunk)) {
        await Promise.race([once(body, "drain"), done]);
      }
    },
  };

  try {
    await produce(out);
    body.end();
    await done;
  } catch (err) {
    body.destroy();
    await upload?.abort().catch(() => {});
    await done.catch(() => {});
    throw err;
  }
}

/** Web-stream af ZIP'en, eller null hvis objektet ikke findes. */
export async function getOrgExportStream(
  requestId: string,
): Promise<{ stream: ReadableStream; size?: number } | null> {
  try {
    const res = await s3.send(
      new GetObjectCommand({ Bucket: S3_BUCKET, Key: orgExportKey(requestId) }),
    );
    if (!res.Body) return null;
    return {
      stream: res.Body.transformToWebStream(),
      size: res.ContentLength,
    };
  } catch (err) {
    const name = (err as { name?: string }).name;
    if (name === "NoSuchKey" || name === "NotFound") return null;
    throw err;
  }
}

export async function deleteOrgExport(requestId: string): Promise<void> {
  await s3.send(
    new DeleteObjectCommand({
      Bucket: S3_BUCKET,
      Key: orgExportKey(requestId),
    }),
  );
}
