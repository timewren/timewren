import { prefixKey, S3_BUCKET } from "@/lib/s3";

/**
 * Gamle rækker: email-attachments/<8 hex>/<12 hex>-<filnavn>, hvor filnavnet
 * kan være tomt (en vedhæftning uden navn giver "<12 hex>-").
 * Nye rækker: email-attachments/<8 hex>/<12 hex> (uden filnavn).
 */
const EMAIL_ATTACHMENT_KEY_RE =
  /^email-attachments\/[0-9a-f]{8}\/[0-9a-f]{12}(?:-[A-Za-z0-9._-]{0,120})?$/;

const LOGICAL_DIR = "email-attachments/";

export type AttachmentLocation =
  /** `key` er den FULDE objektnøgle (inkl. S3_PREFIX). */
  { kind: "s3"; key: string } | { kind: "local" } | { kind: "invalid" };

/**
 * Hvor ligger en vedhæftning, ud fra `emailThreads.attachments[].storagePath`?
 *
 * S3 genkendes kun i to præcise former, og nøglen skal matche mønstret ovenfor:
 * - den logiske nøgle `email-attachments/...` (nye rækker), eller
 * - den URL `getPublicUrl()` gav ældre rækker:
 *   `${S3_ENDPOINT}/${S3_BUCKET}/${S3_PREFIX}/email-attachments/...`.
 * En URL eller nøgle uden for præfikset er ugyldig. Alt andet er en lokal
 * sti, der håndteres af den eksisterende sti-kontrol.
 */
export function locateEmailAttachment(storagePath: string): AttachmentLocation {
  let logicalKey: string;

  if (/^https?:\/\//i.test(storagePath)) {
    let pathname: string;
    try {
      pathname = new URL(storagePath).pathname;
    } catch {
      return { kind: "invalid" };
    }
    let fullKey = pathname.replace(/^\/+/, "");
    if (fullKey.startsWith(`${S3_BUCKET}/`)) {
      fullKey = fullKey.slice(S3_BUCKET.length + 1);
    }
    const dir = prefixKey(LOGICAL_DIR);
    if (!fullKey.startsWith(dir)) return { kind: "invalid" };
    logicalKey = `${LOGICAL_DIR}${fullKey.slice(dir.length)}`;
  } else if (storagePath.startsWith(LOGICAL_DIR)) {
    logicalKey = storagePath;
  } else {
    return { kind: "local" };
  }

  if (!EMAIL_ATTACHMENT_KEY_RE.test(logicalKey)) return { kind: "invalid" };
  return { kind: "s3", key: prefixKey(logicalKey) };
}
