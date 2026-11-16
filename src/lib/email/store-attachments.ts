import crypto from "node:crypto";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { prefixKey, S3_BUCKET, s3 } from "@/lib/s3";
import { isStorageConfigured } from "@/lib/storage/config";

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

export interface SyncedAttachment {
  filename: string;
  contentType: string;
  size: number;
  content?: Buffer;
}

export interface StoredAttachment {
  filename: string;
  contentType: string;
  size: number;
  /** Logisk S3-nøgle (email-attachments/<hash>/<id>). Kun sat når filen er gemt. */
  storagePath?: string;
}

/**
 * IMAP-sync gemmer som standard KUN vedhæftningernes metadata (filnavn,
 * størrelse, type). Selve filerne er en kopi af brugerens mail, og appen
 * har ikke brug for dem. `EMAIL_SYNC_STORE_ATTACHMENTS=true` slår upload til.
 * Læses ved hvert kald, så flaget kan skiftes uden at modulet genindlæses.
 */
export function shouldStoreEmailAttachments(): boolean {
  return process.env.EMAIL_SYNC_STORE_ATTACHMENTS === "true";
}

function metadataOnly(attachment: SyncedAttachment): StoredAttachment {
  return {
    filename: attachment.filename,
    contentType: attachment.contentType,
    size: attachment.size,
  };
}

export async function storeAttachments(
  attachments: SyncedAttachment[],
  messageId: string,
): Promise<StoredAttachment[]> {
  if (!attachments.length) return [];

  if (!shouldStoreEmailAttachments()) {
    return attachments.map(metadataOnly);
  }

  if (!isStorageConfigured()) {
    console.warn("[EmailSync] S3 not configured — skipping attachment storage");
    return attachments.map(metadataOnly);
  }

  const stored: StoredAttachment[] = [];

  for (const attachment of attachments) {
    if (!attachment.content || attachment.size > MAX_ATTACHMENT_BYTES) {
      stored.push(metadataOnly(attachment));
      continue;
    }

    // Nøglen indeholder aldrig filnavnet; det ligger kun i databasen.
    const fileId = crypto.randomBytes(6).toString("hex");
    const messageHash = crypto
      .createHash("sha1")
      .update(messageId)
      .digest("hex")
      .slice(0, 8);
    const key = `email-attachments/${messageHash}/${fileId}`;

    // Privat objekt (ingen ACL); læses kun via /api/email-attachments.
    // En fejlet upload må ikke vælte hele synkroniseringen: gem kun metadata.
    try {
      await s3.send(
        new PutObjectCommand({
          Bucket: S3_BUCKET,
          Key: prefixKey(key),
          Body: attachment.content,
          ContentType: attachment.contentType || "application/octet-stream",
        }),
      );
    } catch (err) {
      console.warn(
        "[EmailSync] Upload af vedhæftning fejlede, gemmer kun metadata:",
        err instanceof Error ? err.message : err,
      );
      stored.push(metadataOnly(attachment));
      continue;
    }

    stored.push({ ...metadataOnly(attachment), storagePath: key });
  }

  return stored;
}
